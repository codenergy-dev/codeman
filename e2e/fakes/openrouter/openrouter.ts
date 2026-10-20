import { createHash, randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { type FakeRequest, FakeServer, HttpError, json, type Reply } from "../http.ts";
import { remoteCompletions } from "../llm/openai.ts";
import { type Generation, meta, orError, query, SECONDS_UTC } from "./analytics.ts";
import {
  type ChatRequest,
  type Completions,
  fixedText,
  sendJson,
  sendStream,
  type Tokens,
} from "./chat.ts";

/**
 * A fake of OpenRouter for the e2e suite: the management API Codeman calls
 * (src/inference/openrouter.ts), the inference API OpenCode calls with a run's key, and a
 * control API under `/_fake/openrouter`. Shapes follow docs/web/openrouter/.
 *
 * A request is billed when it finishes, but the key's `usage` and analytics see it only after
 * their lags, as OpenRouter's do: the 0-cost bug of
 * docs/plans/2026-10-15-refresh-openrouter-costs-from-any-run.md. A lag of null holds them
 * until the scenario settles. A key's limit is enforced on what it really spent, whatever the
 * lags.
 *
 * Control API, under `/_fake/openrouter`:
 *
 * - `GET /keys`: every key, with its secret, its `usage` as shown and its real `spend`;
 * - `PUT /keys/{hash}/usage` `{ usage }`: sets what a key spent, shown at once;
 * - `PUT /lags` `{ usageMs?, analyticsMs? }`: milliseconds, or null to hold until settled;
 * - `POST /settle` `{ hash? }`: shows now what the lags hold, for one key or all;
 * - `PUT /prices` `{ prompt, completion }`: USD per token;
 * - `PUT /completions` `{ name?, text }`: a fixed reply for the keys named `name`, or for all;
 * - `GET /generations`: every request billed, with its tokens, cost and times.
 */

const API = "/api/v1";
const PAGE_SIZE = 100;

/** USD per token. */
export interface Prices {
  prompt: number;
  completion: number;
}

/** Lags in milliseconds; null holds until `settle`. */
export interface Lags {
  usageMs: number | null;
  analyticsMs: number | null;
}

export interface OpenRouterSetup {
  /** The management key's secret, which the management API requires. */
  managementKey: string;
  /** The account's credits, in USD: 100 by default. */
  credits?: number;
  prices?: Prices;
  lags?: Partial<Lags>;
  /** What answers chat completions by default, and again after each reset: `fixedText()` if absent. */
  completions?: Completions;
}

const DEFAULT_PRICES: Prices = { prompt: 0.000001, completion: 0.000004 };

interface Key {
  hash: string;
  secret: string;
  name: string;
  label: string;
  limit: number | null;
  limitReset: string | null;
  includeByokInLimit: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string | null;
  expiresAt: string | null;
  deleted: boolean;
  /** Added to what its generations cost, so a scenario can set its usage. */
  adjustment: number;
}

/** A key as the control API lists it, with what it really spent and what OpenRouter shows. */
export interface KeyState {
  hash: string;
  key: string;
  name: string;
  label: string;
  limit: number | null;
  disabled: boolean;
  deleted: boolean;
  expires_at: string | null;
  /** What the key's `usage` shows now. */
  usage: number;
  /** What it really spent: what its `usage` shows once billing has caught up. */
  spend: number;
  requests: number;
}

export class OpenRouterFake {
  readonly server: FakeServer;
  readonly #setup: OpenRouterSetup;
  readonly #now: () => number;
  readonly #keys: Key[] = [];
  readonly #generations: Generation[] = [];
  readonly #completions = new Map<string, Completions>();
  #fallback: Completions = fixedText();
  #lags: Lags = { usageMs: 0, analyticsMs: 0 };
  #prices: Prices = DEFAULT_PRICES;

  constructor(setup: OpenRouterSetup, options: { now?: () => number } = {}) {
    this.#setup = setup;
    this.#now = options.now ?? Date.now;
    this.#defaults();
    const server = new FakeServer("openrouter");
    this.server = server;

    server.route("GET", `${API}/keys`, (request) => this.#listKeys(request));
    server.route("POST", `${API}/keys`, (request) => this.#createKey(request));
    server.route("GET", `${API}/keys/{hash}`, (request) => {
      this.#management(request);
      return json({ data: this.#view(this.#managed(request.params.hash)) });
    });
    server.route("PATCH", `${API}/keys/{hash}`, (request) => this.#updateKey(request));
    server.route("DELETE", `${API}/keys/{hash}`, (request) => {
      this.#management(request);
      this.#managed(request.params.hash).deleted = true;
      return json({ deleted: true });
    });
    server.route("GET", `${API}/key`, (request) => this.#currentKey(request));
    server.route("GET", `${API}/credits`, (request) => {
      this.#management(request);
      const usage = this.#keys.reduce((total, key) => total + this.#usage(key), 0);
      return json({ data: { total_credits: this.#credits(), total_usage: usage } });
    });
    server.route("POST", `${API}/analytics/query`, (request) => {
      this.#management(request);
      return json(query(request.json(), this.#generations, this.#now()));
    });
    server.route("GET", `${API}/analytics/meta`, (request) => {
      this.#management(request);
      return json(meta());
    });
    server.route("POST", `${API}/chat/completions`, (request, response) =>
      this.#chat(request, response),
    );

    server.control("GET", "/openrouter/keys", () => json(this.keys()));
    server.control("PUT", "/openrouter/keys/{hash}/usage", (request) => {
      const { usage } = (request.json() ?? {}) as { usage?: unknown };
      if (typeof usage !== "number" || !(usage >= 0)) {
        throw new HttpError(400, { message: "The body is { usage }, in USD." });
      }
      this.setUsage(request.params.hash ?? "", usage);
      return { status: 204 };
    });
    server.control("PUT", "/openrouter/lags", (request) => {
      this.lags(lagsOf(request.json()));
      return { status: 204 };
    });
    server.control("POST", "/openrouter/settle", (request) => {
      const { hash } = (request.body.length > 0 ? request.json() : {}) as { hash?: unknown };
      this.settle(typeof hash === "string" ? hash : undefined);
      return { status: 204 };
    });
    server.control("PUT", "/openrouter/prices", (request) => {
      this.prices(pricesOf(request.json()));
      return { status: 204 };
    });
    server.control("PUT", "/openrouter/completions", (request) => {
      const { name, text } = (request.json() ?? {}) as { name?: unknown; text?: unknown };
      if ((name !== undefined && typeof name !== "string") || typeof text !== "string") {
        throw new HttpError(400, { message: "The body is { text } and an optional key name." });
      }
      this.completions(name, fixedText(text));
      return { status: 204 };
    });
    server.control("GET", "/openrouter/generations", () => json(this.#generations));
    server.onReset(() => {
      this.#keys.length = 0;
      this.#generations.length = 0;
      this.#completions.clear();
      this.#defaults();
    });
  }

  /** Every key, deleted ones included, with what it spent. */
  keys(): KeyState[] {
    return this.#keys.map((key) => ({
      hash: key.hash,
      key: key.secret,
      name: key.name,
      label: key.label,
      limit: key.limit,
      disabled: key.disabled,
      deleted: key.deleted,
      expires_at: key.expiresAt,
      usage: this.#usage(key),
      spend: this.#spend(key),
      requests: this.#generations.filter((g) => g.keyHash === key.hash).length,
    }));
  }

  /** Answers the chat completions of the keys named `name`, or of every other key without one. */
  completions(name: string | undefined, completions: Completions): void {
    if (name === undefined) this.#fallback = completions;
    else this.#completions.set(name, completions);
  }

  /** Changes the lags given; what is already billed or counted stays so. */
  lags(lags: Partial<Lags>): void {
    this.#lags = { ...this.#lags, ...lags };
    for (const generation of this.#generations) {
      if (generation.billedAt > this.#now() && lags.usageMs !== undefined) {
        generation.billedAt = after(generation.at, lags.usageMs);
      }
      if (generation.countedAt > this.#now() && lags.analyticsMs !== undefined) {
        generation.countedAt = after(generation.at, lags.analyticsMs);
      }
    }
  }

  /** Bills and counts now what the lags still hold, for one key or every key. */
  settle(hash?: string): void {
    const now = this.#now();
    for (const generation of this.#generations) {
      if (hash !== undefined && generation.keyHash !== hash) continue;
      generation.billedAt = Math.min(generation.billedAt, now);
      generation.countedAt = Math.min(generation.countedAt, now);
    }
  }

  prices(prices: Prices): void {
    this.#prices = prices;
  }

  /** Sets what a key spent, in USD, and shows it at once in the key's usage. */
  setUsage(hash: string, usage: number): void {
    const key = this.#keys.find((candidate) => candidate.hash === hash);
    if (!key) throw new HttpError(404, { message: `No key ${hash}.` });
    const now = this.#now();
    let billed = 0;
    for (const generation of this.#generations) {
      if (generation.keyHash !== hash) continue;
      generation.billedAt = Math.min(generation.billedAt, now);
      billed += generation.cost;
    }
    key.adjustment = usage - billed;
  }

  #defaults(): void {
    this.#fallback = this.#setup.completions ?? fixedText();
    this.#lags = { usageMs: 0, analyticsMs: 0, ...this.#setup.lags };
    this.#prices = this.#setup.prices ?? DEFAULT_PRICES;
  }

  #credits(): number {
    return this.#setup.credits ?? 100;
  }

  /** What the key's usage shows now. */
  #usage(key: Key): number {
    const now = this.#now();
    return this.#generations.reduce(
      (total, g) => (g.keyHash === key.hash && g.billedAt <= now ? total + g.cost : total),
      key.adjustment,
    );
  }

  /** What the key really spent. */
  #spend(key: Key): number {
    return this.#generations.reduce(
      (total, g) => (g.keyHash === key.hash ? total + g.cost : total),
      key.adjustment,
    );
  }

  /** Requires the management key (errors-and-debugging.md and get-remaining-credits.md). */
  #management(request: FakeRequest): void {
    if (!request.bearer) throw orError(401, "Missing Authentication header");
    if (request.bearer === this.#setup.managementKey) return;
    if (this.#keys.some((key) => key.secret === request.bearer && !key.deleted)) {
      throw orError(403, "Only management keys can perform this operation");
    }
    throw orError(401, "User not found.");
  }

  /** A key of the account by hash; deleted keys are gone. */
  #managed(hash: string | undefined): Key {
    const key = this.#keys.find((candidate) => candidate.hash === hash && !candidate.deleted);
    if (!key) throw orError(404, "Key not found");
    return key;
  }

  /** A key's details, as list-api-keys.md lists them. */
  #view(key: Key) {
    const usage = this.#usage(key);
    return {
      hash: key.hash,
      name: key.name,
      label: key.label,
      disabled: key.disabled,
      limit: key.limit,
      limit_remaining: key.limit === null ? null : Math.max(0, key.limit - usage),
      limit_reset: key.limitReset,
      include_byok_in_limit: key.includeByokInLimit,
      // An e2e run's keys live less than a day: each window holds all their usage.
      usage,
      usage_daily: usage,
      usage_weekly: usage,
      usage_monthly: usage,
      byok_usage: 0,
      byok_usage_daily: 0,
      byok_usage_weekly: 0,
      byok_usage_monthly: 0,
      created_at: key.createdAt,
      updated_at: key.updatedAt,
      expires_at: key.expiresAt,
      workspace_id: null,
      creator_user_id: null,
    };
  }

  #listKeys(request: FakeRequest): Reply {
    this.#management(request);
    const disabled = request.query.get("include_disabled") === "true";
    const offset = Number(request.query.get("offset") ?? 0);
    if (!Number.isInteger(offset) || offset < 0) {
      throw orError(400, "offset must be a non-negative integer.");
    }
    const keys = this.#keys.filter((key) => !key.deleted && (disabled || !key.disabled));
    return json({
      data: keys.slice(offset, offset + PAGE_SIZE).map((key) => this.#view(key)),
    });
  }

  /** create-a-new-api-key.md: `name`, and optional `limit`, `limit_reset` and `expires_at`. */
  #createKey(request: FakeRequest): Reply {
    this.#management(request);
    const body = (request.json() ?? {}) as Record<string, unknown>;
    if (typeof body.name !== "string" || body.name === "") throw orError(400, "name is required.");
    const limit = optionalLimit(body.limit);
    const expiresAt = body.expires_at ?? null;
    if (expiresAt !== null) {
      if (typeof expiresAt !== "string" || !SECONDS_UTC.test(expiresAt)) {
        throw orError(400, "expires_at must be ISO 8601 UTC with seconds.");
      }
      if (Date.parse(expiresAt) <= this.#now()) throw orError(400, "expires_at is in the past.");
    }
    const secret = `sk-or-v1-${randomBytes(32).toString("hex")}`;
    const key: Key = {
      hash: createHash("sha256").update(secret).digest("hex"),
      secret,
      name: body.name,
      label: `${secret.slice(0, 12)}...${secret.slice(-3)}`,
      limit,
      limitReset: limitResetOf(body.limit_reset),
      includeByokInLimit: body.include_byok_in_limit === true,
      disabled: false,
      createdAt: new Date(this.#now()).toISOString(),
      updatedAt: null,
      expiresAt: expiresAt as string | null,
      deleted: false,
      adjustment: 0,
    };
    this.#keys.push(key);
    return json({ data: this.#view(key), key: secret }, 201);
  }

  /** update-an-api-key.md: `disabled`, `name`, `limit`, `limit_reset`, `include_byok_in_limit`. */
  #updateKey(request: FakeRequest): Reply {
    this.#management(request);
    const key = this.#managed(request.params.hash);
    const body = (request.json() ?? {}) as Record<string, unknown>;
    if (body.disabled !== undefined && typeof body.disabled !== "boolean") {
      throw orError(400, "disabled must be a boolean.");
    }
    if (body.name !== undefined && (typeof body.name !== "string" || body.name === "")) {
      throw orError(400, "name must be a non-empty string.");
    }
    const limit = body.limit === undefined ? key.limit : optionalLimit(body.limit);
    const limitReset =
      body.limit_reset === undefined ? key.limitReset : limitResetOf(body.limit_reset);
    if (body.disabled !== undefined) key.disabled = body.disabled as boolean;
    if (body.name !== undefined) key.name = body.name as string;
    if (body.include_byok_in_limit !== undefined) {
      key.includeByokInLimit = body.include_byok_in_limit === true;
    }
    key.limit = limit;
    key.limitReset = limitReset;
    key.updatedAt = new Date(this.#now()).toISOString();
    return json({ data: this.#view(key) });
  }

  /** The key a request authenticates with, for inference: 401 unless it is live. */
  #inferenceKey(request: FakeRequest): Key {
    if (!request.bearer) throw orError(401, "Missing Authentication header");
    if (request.bearer === this.#setup.managementKey) {
      throw orError(403, "Management keys cannot be used for inference.");
    }
    const key = this.#keys.find((candidate) => candidate.secret === request.bearer);
    if (!key || key.deleted) throw orError(401, "User not found.");
    if (key.disabled) throw orError(401, "This API key is disabled.");
    if (key.expiresAt !== null && Date.parse(key.expiresAt) <= this.#now()) {
      throw orError(401, "This API key has expired.");
    }
    return key;
  }

  /** get-current-api-key.md, from limits.md's "Checking your limits". */
  #currentKey(request: FakeRequest): Reply {
    if (request.bearer && request.bearer === this.#setup.managementKey) {
      return json({
        data: {
          label: `${request.bearer.slice(0, 12)}...${request.bearer.slice(-3)}`,
          limit: null,
          limit_remaining: null,
          limit_reset: null,
          include_byok_in_limit: false,
          usage: 0,
          usage_daily: 0,
          usage_weekly: 0,
          usage_monthly: 0,
          is_free_tier: false,
          is_management_key: true,
          is_provisioning_key: true,
          expires_at: null,
          budgets: [],
          effective_budget: null,
        },
      });
    }
    const view = this.#view(this.#inferenceKey(request));
    return json({
      data: {
        label: view.label,
        limit: view.limit,
        limit_remaining: view.limit_remaining,
        limit_reset: view.limit_reset,
        include_byok_in_limit: view.include_byok_in_limit,
        usage: view.usage,
        usage_daily: view.usage_daily,
        usage_weekly: view.usage_weekly,
        usage_monthly: view.usage_monthly,
        byok_usage: 0,
        byok_usage_daily: 0,
        byok_usage_weekly: 0,
        byok_usage_monthly: 0,
        is_free_tier: false,
        is_management_key: false,
        is_provisioning_key: false,
        expires_at: view.expires_at,
        budgets: [],
        effective_budget: null,
      },
    });
  }

  async #chat(request: FakeRequest, response: ServerResponse): Promise<undefined> {
    const key = this.#inferenceKey(request);
    const body = request.json() as ChatRequest;
    if (typeof body?.model !== "string" || !Array.isArray(body.messages)) {
      throw orError(400, "model and messages are required.");
    }
    // limits.md, "Handling 402 errors": the key's limit, then the account's credits.
    if (key.limit !== null && this.#spend(key) >= key.limit) {
      throw orError(402, "Key limit exceeded. Raise the key's credit limit to continue.", {
        limit_source: "openrouter_key_limit",
        remedy_hint: "Raise the key's credit limit or wait for it to reset.",
      });
    }
    const spent = this.#keys.reduce((total, candidate) => total + this.#spend(candidate), 0);
    if (spent >= this.#credits()) {
      throw orError(402, "Insufficient credits. Add more using https://openrouter.ai/credits", {
        limit_source: "openrouter_credits",
        remedy_hint: "Add credits at https://openrouter.ai/settings/credits.",
      });
    }
    const completions = this.#completions.get(key.name) ?? this.#fallback;
    const started = this.#now();
    const reply = await completions(body, {
      keyHash: key.hash,
      keyName: key.name,
      keyLabel: key.label,
    });
    const id = `gen-${Math.floor(started / 1000)}-${randomBytes(10).toString("base64url")}`;
    const envelope = {
      id,
      created: Math.floor(started / 1000),
      model: body.model,
      price: (tokens: Tokens) => this.#price(tokens),
    };
    const served = body.stream
      ? await sendStream(response, reply, body, envelope)
      : await sendJson(response, reply, body, envelope);
    this.#record(id, key, body.model, started, served.tokens);
    return undefined;
  }

  #price(tokens: Tokens): number {
    return (
      tokens.prompt_tokens * this.#prices.prompt +
      tokens.completion_tokens * this.#prices.completion
    );
  }

  /** Bills a finished request, seen by usage and analytics after their lags. */
  #record(id: string, key: Key, model: string, started: number, tokens: Tokens): void {
    const at = this.#now();
    const ms = tokens.generationMs ?? at - started;
    this.#generations.push({
      id,
      keyHash: key.hash,
      model,
      at,
      billedAt: after(at, this.#lags.usageMs),
      countedAt: after(at, this.#lags.analyticsMs),
      promptTokens: tokens.prompt_tokens,
      completionTokens: tokens.completion_tokens,
      cachedTokens: tokens.cached_tokens ?? 0,
      cost: this.#price(tokens),
      throughput:
        tokens.completion_tokens > 0 && ms > 0 ? tokens.completion_tokens / (ms / 1000) : null,
    });
  }
}

function after(at: number, lag: number | null): number {
  return lag === null ? Number.POSITIVE_INFINITY : at + lag;
}

function optionalLimit(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw orError(400, "limit must be a non-negative number of USD.");
  }
  return value;
}

function limitResetOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value !== "daily" && value !== "weekly" && value !== "monthly") {
    throw orError(400, "limit_reset is daily, weekly, monthly or null.");
  }
  return value;
}

function lagsOf(value: unknown): Partial<Lags> {
  const body = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const lag = (field: unknown) =>
    field === undefined || field === null || (typeof field === "number" && field >= 0);
  if (!lag(body.usageMs) || !lag(body.analyticsMs)) {
    throw new HttpError(400, {
      message: "Lags are usageMs and analyticsMs: milliseconds, or null to hold until settled.",
    });
  }
  const lags: Partial<Lags> = {};
  if (body.usageMs !== undefined) lags.usageMs = body.usageMs as number | null;
  if (body.analyticsMs !== undefined) lags.analyticsMs = body.analyticsMs as number | null;
  return lags;
}

function pricesOf(value: unknown): Prices {
  const body = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const price = (field: unknown) => typeof field === "number" && field >= 0;
  if (!price(body.prompt) || !price(body.completion)) {
    throw new HttpError(400, { message: "Prices are prompt and completion, in USD per token." });
  }
  return { prompt: body.prompt as number, completion: body.completion as number };
}

/**
 * The fake for e2e/fakes/main.ts. `FAKE_OPENROUTER` holds its setup as JSON:
 * `{ managementKey, credits?, prices?: { prompt, completion }, lags?: { usageMs, analyticsMs } }`;
 * without it, the management key is `FAKE_OPENROUTER_MANAGEMENT_KEY`. `FAKE_OPENROUTER_COMPLETIONS`,
 * the scripted model's origin, answers chat completions from it (e2e/fakes/llm/).
 */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  const setup = (env.FAKE_OPENROUTER ? JSON.parse(env.FAKE_OPENROUTER) : {}) as Record<
    string,
    unknown
  >;
  const managementKey = setup.managementKey ?? env.FAKE_OPENROUTER_MANAGEMENT_KEY;
  if (typeof managementKey !== "string" || managementKey === "") {
    throw new Error("The fake OpenRouter needs a management key: FAKE_OPENROUTER_MANAGEMENT_KEY.");
  }
  if (setup.credits !== undefined && typeof setup.credits !== "number") {
    throw new Error("FAKE_OPENROUTER's credits must be a number.");
  }
  const model = env.FAKE_OPENROUTER_COMPLETIONS;
  if (model !== undefined && URL.parse(model)?.origin !== model) {
    throw new Error("FAKE_OPENROUTER_COMPLETIONS must be an origin, such as http://llm:8080.");
  }
  try {
    return new OpenRouterFake({
      managementKey,
      credits: setup.credits as number | undefined,
      prices: setup.prices === undefined ? undefined : pricesOf(setup.prices),
      lags: setup.lags === undefined ? undefined : lagsOf(setup.lags),
      completions: model === undefined ? undefined : remoteCompletions(model),
    }).server;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    throw new Error(`FAKE_OPENROUTER: ${(error.body as { message: string }).message}`);
  }
}
