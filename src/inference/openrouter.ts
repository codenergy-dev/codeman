import { type Fetch, usd } from "../budget.ts";
import type { RepositoryRef } from "../platform/types.ts";
import type { Log } from "../runtime/runtime.ts";
import type { InferenceProvider, OpenedRun, RunRequest, RunUsage } from "./provider.ts";

const API = "https://openrouter.ai/api/v1";

export interface KeyInfo {
  hash: string;
  name: string;
  /** Total usage, in USD. */
  usage?: number;
  usage_monthly?: number;
}

/**
 * Task keys are named `codeman/<owner>/<repo>/<issue>/<run>`, so usage can be summed per
 * repository and per task. An owner of several segments, such as a group path, must not make
 * one repository's prefix another's: the platform's adapter keeps them apart.
 */
export function keyPrefix(repository: RepositoryRef): string {
  return `codeman/${repository.owner}/${repository.name}/`;
}

export function taskKeyPrefix(repository: RepositoryRef, issue: number | string): string {
  return `${keyPrefix(repository)}${issue}/`;
}

/** Adds up one usage field over the keys whose name starts with `prefix`. */
export function sumUsage(
  keys: readonly KeyInfo[],
  prefix: string,
  field: "usage" | "usage_monthly",
): number {
  return keys
    .filter((key) => key.name.startsWith(prefix))
    .reduce((total, key) => total + (key[field] ?? 0), 0);
}

/**
 * What each run of a task spent, in USD, by run ID, from the keys whose name starts with the
 * task's `prefix`. A re-run of a whole workflow opens another key with the same name, so keys of
 * one run add up.
 */
export function costsByRun(keys: readonly KeyInfo[], prefix: string): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const key of keys) {
    const run = key.name.slice(prefix.length);
    if (!key.name.startsWith(prefix) || !/^\d+$/.test(run)) continue;
    costs[run] = (costs[run] ?? 0) + (key.usage ?? 0);
  }
  return costs;
}

/** A non-negative whole count from a number or a numeric string; 0 otherwise. */
function count(value: unknown): number {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? Math.round(number)
    : 0;
}

/** A non-negative finite rate from a number or a numeric string; undefined otherwise. */
function rate(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : undefined;
}

/** How a key's requests went, as OpenRouter's analytics counts them. */
export interface KeyStats {
  requests: number;
  /** Mean completion tokens per second over the requests; undefined when none was measured. */
  tokensPerSecond?: number | undefined;
  /** The largest prompt of one request, cached tokens included. */
  maxInputTokens?: number | undefined;
}

/** Analytics wants seconds precision: `YYYY-MM-DDTHH:MM:SSZ`. */
function utcSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** OpenRouter wants `YYYY-MM-DDTHH:MM:SSZ`. */
export function expiresAt(now: Date, hours: number): string {
  return `${new Date(now.getTime() + hours * 3_600_000).toISOString().slice(0, 19)}Z`;
}

export class OpenRouter {
  readonly #managementKey: string;
  readonly #fetch: Fetch;

  constructor(managementKey: string, fetchFn: Fetch = fetch) {
    this.#managementKey = managementKey;
    this.#fetch = fetchFn;
  }

  /** Every key of the account, disabled ones included. */
  async listKeys(): Promise<KeyInfo[]> {
    const keys: KeyInfo[] = [];
    for (let page = 0; page < 100; page++) {
      const { data } = (await this.#request(
        `/keys?include_disabled=true&offset=${keys.length}`,
      )) as { data: KeyInfo[] };
      if (data.length === 0) return keys;
      keys.push(...data);
    }
    throw new Error("Too many OpenRouter keys to add up.");
  }

  /** This month's usage, in USD, of every key whose name starts with `prefix`, disabled ones included. */
  async monthlyUsage(prefix: string): Promise<number> {
    return sumUsage(await this.listKeys(), prefix, "usage_monthly");
  }

  async key(hash: string): Promise<KeyInfo> {
    const { data } = (await this.#request(`/keys/${encodeURIComponent(hash)}`)) as {
      data: KeyInfo;
    };
    return data;
  }

  /** The total usage of one key, in USD. */
  async keyUsage(hash: string): Promise<number> {
    return (await this.key(hash)).usage ?? 0;
  }

  /**
   * The tokens one key used between `since` and `until`, from OpenRouter's analytics, as
   * OpenRouter counts them: prompt tokens (cached ones included) and completion tokens.
   * Undefined when analytics has no rows for the key yet.
   */
  async keyTokens(
    hash: string,
    since: Date,
    until: Date,
  ): Promise<{ input: number; output: number } | undefined> {
    const rows = await this.#query({
      metrics: ["tokens_prompt", "tokens_completion"],
      filters: [{ field: "api_key_id", operator: "eq", value: hash }],
      time_range: { start: utcSeconds(since), end: utcSeconds(until) },
    });
    if (rows.length === 0) return undefined;
    let input = 0;
    let output = 0;
    for (const row of rows) {
      // Counts may come back as strings.
      input += count(row.tokens_prompt);
      output += count(row.tokens_completion);
    }
    return { input, output };
  }

  /**
   * How one key's requests went between `since` and `until`, from OpenRouter's analytics: how
   * many there were, their mean throughput (completion tokens per second) and the largest
   * prompt among them, cached tokens included. Undefined when analytics has no requests for the
   * key yet. Throughput and per-request rows cover at most 31 days.
   */
  async keyStats(hash: string, since: Date, until: Date): Promise<KeyStats | undefined> {
    const filters = [{ field: "api_key_id", operator: "eq", value: hash }];
    const time_range = { start: utcSeconds(since), end: utcSeconds(until) };
    const rows = await this.#query({
      metrics: ["request_count", "avg_throughput"],
      filters,
      time_range,
    });
    // One row is expected; several (such as time buckets) are weighed by their requests.
    let requests = 0;
    let weighted = 0;
    let measured = 0;
    for (const row of rows) {
      const n = count(row.request_count);
      const throughput = rate(row.avg_throughput);
      requests += n;
      if (throughput !== undefined && n > 0) {
        weighted += throughput * n;
        measured += n;
      }
    }
    if (requests === 0) return undefined;

    // There is no max aggregate: the largest prompt is the first request by prompt size.
    const largest = await this.#query({
      metrics: ["tokens_prompt"],
      dimensions: ["generation_id"],
      filters,
      time_range,
      order_by: { field: "tokens_prompt", direction: "desc" },
      limit: 1,
    });
    const maxInputTokens = largest.reduce((max, row) => Math.max(max, count(row.tokens_prompt)), 0);
    return {
      requests,
      tokensPerSecond: measured > 0 ? weighted / measured : undefined,
      maxInputTokens: largest.length > 0 ? maxInputTokens : undefined,
    };
  }

  async createKey(options: {
    name: string;
    limit: number;
    expiresAt: string;
  }): Promise<{ key: string; hash: string }> {
    const response = (await this.#request("/keys", "POST", {
      name: options.name,
      limit: options.limit,
      expires_at: options.expiresAt,
    })) as { key: string; data: KeyInfo };
    return { key: response.key, hash: response.data.hash };
  }

  /** Disables instead of deleting, so the key's usage still counts towards the monthly cap. */
  async disableKey(hash: string): Promise<void> {
    await this.#request(`/keys/${encodeURIComponent(hash)}`, "PATCH", { disabled: true });
  }

  /** The rows of an analytics query. */
  async #query(body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const response = (await this.#request("/analytics/query", "POST", body)) as {
      data?: { data?: unknown };
    };
    const rows = response.data?.data;
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }

  async #request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#managementKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!response.ok) {
      // The body may echo request data; report only the status.
      throw new Error(`OpenRouter ${method} ${path.split("?")[0]} failed with ${response.status}.`);
    }
    return response.json();
  }
}

/**
 * OpenRouter as Codeman's inference: a key per run, limited to what remains of the task's
 * budget, named so that usage adds up per task and per repository, and disabled when the run
 * ends.
 */
export class OpenRouterProvider implements InferenceProvider {
  readonly name = "openrouter";
  readonly #router: OpenRouter;
  readonly #repository: RepositoryRef;
  readonly #expiryHours: () => number;
  #keys: Promise<KeyInfo[]> | undefined;

  constructor(router: OpenRouter, repository: RepositoryRef, expiryHours: () => number) {
    this.#router = router;
    this.#repository = repository;
    this.#expiryHours = expiryHours;
  }

  /** The account's keys, listed once for both sums. */
  #listKeys(): Promise<KeyInfo[]> {
    this.#keys ??= this.#router.listKeys();
    return this.#keys;
  }

  async taskSpent(task: string): Promise<number> {
    return sumUsage(await this.#listKeys(), taskKeyPrefix(this.#repository, task), "usage");
  }

  async monthSpent(): Promise<number> {
    return sumUsage(await this.#listKeys(), keyPrefix(this.#repository), "usage_monthly");
  }

  async open(run: RunRequest, log: Log): Promise<OpenedRun> {
    const hours = this.#expiryHours();
    const { key, hash } = await this.#router.createKey({
      name: `${keyPrefix(this.#repository)}${run.task}/${run.runId}`,
      limit: run.limit,
      expiresAt: expiresAt(new Date(), hours),
    });
    log.info(`Created a key limited to ${usd(run.limit)}, expiring in ${hours} hours.`);
    return { handle: hash, credential: key };
  }

  /**
   * Disables the run's key, then reads what it spent and used, and what each run of the task
   * spent, so apply can refresh the costs that earlier runs read too soon.
   */
  async close(hash: string, log: Log): Promise<RunUsage> {
    const router = this.#router;
    await router.disableKey(hash);
    log.info("Disabled the key.");

    let cost = await runCost(router, hash, false);
    const tokens = await runTokens(router, hash, cost > 0, log);
    if (cost === 0 && tokens && tokens.input + tokens.output > 0) {
      // The analytics counted requests that the key's usage does not show yet.
      log.info("OpenRouter has tokens for this run's key but no cost yet; reading it again.");
      cost = await runCost(router, hash, true);
      if (cost === 0) log.warning("OpenRouter has no cost for this run's key yet.");
    }
    const stats = await runStats(router, hash, tokens !== undefined && tokens.output > 0, log);
    return {
      cost,
      inputTokens: tokens?.input,
      outputTokens: tokens?.output,
      requests: stats?.requests,
      maxInputTokens: stats?.maxInputTokens,
      tokensPerSecond: stats?.tokensPerSecond,
      taskCosts: await taskCosts(router, hash, this.#repository, log),
    };
  }
}

/**
 * What the key spent. OpenRouter may count the last requests a little later, so the usage is
 * read until it stops changing, for up to about half a minute. For a key known to be `used`, a
 * usage of zero is not final: it is read for up to about a minute.
 */
export async function runCost(
  router: Pick<OpenRouter, "keyUsage">,
  hash: string,
  used: boolean,
  wait = sleep,
): Promise<number> {
  let cost = await router.keyUsage(hash);
  for (let attempt = 0; attempt < (used ? 12 : 6); attempt++) {
    await wait(5_000);
    const latest = await router.keyUsage(hash);
    if (latest === cost && (latest > 0 || !used)) break;
    cost = latest;
  }
  return cost;
}

/**
 * What each run of the key's task spent, by run ID, rounded as `run-cost` is. The task comes
 * from the key's name. Failures are only logged: apply then keeps the costs it has.
 */
export async function taskCosts(
  router: Pick<OpenRouter, "key" | "listKeys">,
  hash: string,
  repository: RepositoryRef,
  log: Log,
): Promise<Record<string, number> | undefined> {
  try {
    const { name } = await router.key(hash);
    const prefix = name.slice(0, name.lastIndexOf("/") + 1);
    if (!prefix.startsWith(keyPrefix(repository)) || prefix === keyPrefix(repository)) {
      throw new Error("the key's name is not a task key's.");
    }
    const costs = costsByRun(await router.listKeys(), prefix);
    return Object.fromEntries(
      Object.entries(costs).map(([run, cost]) => [run, Number(cost.toFixed(4))]),
    );
  } catch (error) {
    log.warning(
      `Could not read what the task's runs spent: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

/** How far back the key's tokens are counted: longer than any key lives. */
const KEY_LIFETIME_MS = 48 * 3_600_000;

/**
 * The key's tokens, from OpenRouter's analytics. A request may show up there some time after
 * it is billed, so while a key that spent something has no tokens yet, this asks again, for up
 * to about a minute. Failures are only logged: the tokens are informational.
 */
export async function runTokens(
  router: Pick<OpenRouter, "keyTokens">,
  hash: string,
  spent: boolean,
  log: Log,
  wait = sleep,
): Promise<{ input: number; output: number } | undefined> {
  try {
    for (let attempt = 0; ; attempt++) {
      const now = new Date();
      const tokens = await router.keyTokens(hash, new Date(now.getTime() - KEY_LIFETIME_MS), now);
      const counted = tokens !== undefined && tokens.input + tokens.output > 0;
      if (counted || !spent) return tokens ?? (spent ? undefined : { input: 0, output: 0 });
      if (attempt === 6) {
        log.warning("OpenRouter's analytics has no tokens for this run's key yet.");
        return undefined;
      }
      await wait(10_000);
    }
  } catch (error) {
    log.warning(
      `Could not read this run's tokens: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

/**
 * How the key's requests went, from OpenRouter's analytics. When the key generated tokens,
 * analytics may still be counting its requests, so this asks again for up to about a minute.
 * Failures are only logged: these figures are informational.
 */
export async function runStats(
  router: Pick<OpenRouter, "keyStats">,
  hash: string,
  generated: boolean,
  log: Log,
  wait = sleep,
): Promise<KeyStats | undefined> {
  try {
    for (let attempt = 0; ; attempt++) {
      const now = new Date();
      const stats = await router.keyStats(hash, new Date(now.getTime() - KEY_LIFETIME_MS), now);
      if (stats || !generated) return stats;
      if (attempt === 6) {
        log.warning("OpenRouter's analytics has no requests for this run's key yet.");
        return undefined;
      }
      await wait(10_000);
    }
  } catch (error) {
    log.warning(
      `Could not read this run's requests: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
