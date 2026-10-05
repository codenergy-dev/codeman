import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// src/gateway/main.ts
import { spawn } from "node:child_process";

// src/inference/engine.ts
function openAiUsage(body, cachedApart = false) {
  if (typeof body !== "object" || body === null) return void 0;
  const usage = body.usage;
  if (typeof usage !== "object" || usage === null) return void 0;
  const fields = usage;
  const input = count(fields.prompt_tokens);
  const output = count(fields.completion_tokens);
  if (input === void 0 || output === void 0) return void 0;
  const cached = cachedApart ? count(fields.prompt_tokens_details?.cached_tokens) ?? 0 : 0;
  return { input: input + cached, output };
}
function count(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : void 0;
}

// src/inference/ollama.ts
var OLLAMA_URL = "http://127.0.0.1:11434";
var MODEL = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,2}(:[a-z0-9][a-z0-9._-]*)?$/i;
var ollama = {
  name: "ollama",
  example: "qwen3-coder:30b",
  isModel: (model) => model.length <= 100 && MODEL.test(model),
  usage: (body) => openAiUsage(body)
};
function ollamaContextLength(show) {
  const info = show?.model_info;
  if (typeof info !== "object" || info === null) return void 0;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number" && value > 0) return value;
  }
  return void 0;
}

// src/inference/runpod.ts
var API = "https://api.runpod.io/v2";
var STATUS = {
  PROVISIONING: "starting",
  STARTING: "starting",
  RUNNING: "running",
  EXITED: "stopped",
  ERROR: "failed",
  TERMINATED: "terminated"
};
var Runpod = class {
  name = "runpod";
  pods;
  serverless;
  #apiKey;
  #fetch;
  #now;
  constructor(apiKey, fetchFn = fetch, now = () => /* @__PURE__ */ new Date()) {
    this.#apiKey = apiKey;
    this.#fetch = fetchFn;
    this.#now = now;
    this.pods = {
      price: (gpuType) => this.#podPrice(gpuType),
      create: (spec) => this.#createPod(spec),
      get: (id) => this.#getPod(id),
      list: (env) => this.#listPods(env),
      terminate: (id) => this.#terminatePod(id),
      url: (id, port) => `https://${id}-${port}.proxy.runpod.net`,
      billing: (ids, since) => this.#podBilling(ids, since)
    };
    this.serverless = {
      endpoint: (id) => this.#endpoint(id),
      price: (id) => this.#serverlessPrice(id),
      openAiUrl: (id) => `https://api.runpod.ai/v2/${encodeURIComponent(id)}/openai/v1`
    };
  }
  /**
   * `GET /v2/billing`, by month: the account's total since the month began (UTC). The API takes
   * `startTime` only with `endTime`; both fall on the month's boundaries.
   */
  async monthSpent(now) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const response = await this.#request(`/billing?bucketSize=month&${window(start, end)}`);
    return (response.records ?? []).filter((record) => !record.startTime || Date.parse(record.startTime) >= start.getTime()).reduce((total, record) => total + amount(record.totalAmount), 0);
  }
  async #podPrice(gpuType) {
    const gpu = await this.#request(
      `/catalog/gpus/${encodeURIComponent(gpuType)}`,
      "GET",
      void 0,
      [404]
    );
    if (!gpu) {
      throw new Error(
        `Runpod has no GPU type "${gpuType}". \`gpu-type\` takes the GPU's ID, such as "NVIDIA RTX A6000", not its display name; see https://docs.runpod.io/references/gpu-types.`
      );
    }
    const hourly = gpu.price?.secure;
    if (gpu.secure === false || typeof hourly !== "number" || !(hourly > 0)) {
      throw new Error(`Runpod does not offer ${gpuType} on Secure Cloud.`);
    }
    return hourly / 3600;
  }
  async #createPod(spec) {
    const pod = await this.#request("/pods", "POST", {
      name: spec.name,
      image: spec.image,
      gpu: { id: spec.gpuType, count: 1 },
      // Decision 6 of the self-hosted inference plan: Runpod's own data centers only.
      cloud: "SECURE",
      env: spec.env,
      ports: [`${spec.port}/http`],
      disk: spec.diskGb
    });
    return toPod(pod);
  }
  async #getPod(id) {
    const pod = await this.#request(`/pods/${encodeURIComponent(id)}`, "GET", void 0, [404]);
    return pod ? toPod(pod) : void 0;
  }
  async #listPods(env) {
    const pods = [];
    let cursor;
    for (let page = 0; page < 100; page++) {
      const response = await this.#request(
        `/pods${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
      );
      for (const pod of response.pods ?? []) {
        const found = toPod(pod);
        if (Object.entries(env).every(([name, value]) => found.env[name] === value)) {
          pods.push(found);
        }
      }
      cursor = response.pagination?.nextCursor;
      if (!response.pagination?.hasNextPage || !cursor) return pods;
    }
    throw new Error("Too many Runpod pods to list.");
  }
  async #terminatePod(id) {
    await this.#request(`/pods/${encodeURIComponent(id)}`, "DELETE", void 0, [404]);
  }
  /** `GET /v2/billing/pods`, by day, once for every pod; records are per pod per bucket. */
  async #podBilling(ids, since) {
    if (ids.length === 0) return {};
    const start = new Date(
      Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate())
    );
    const now = this.#now();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const response = await this.#request(
      `/billing/pods?bucketSize=day&${window(start, end)}`
    );
    const wanted = new Set(ids);
    const billed = {};
    for (const record of response.records ?? []) {
      if (!record.podId || !wanted.has(record.podId)) continue;
      billed[record.podId] = (billed[record.podId] ?? 0) + amount(record.totalAmount);
    }
    return billed;
  }
  async #endpoint(id) {
    const endpoint = await this.#request(
      `/serverless/${encodeURIComponent(id)}`
    );
    return {
      id: endpoint.id,
      type: endpoint.type,
      workersMin: endpoint.workers?.min ?? 0,
      workersMax: endpoint.workers?.max ?? 0,
      idleTimeoutSeconds: endpoint.workers?.idleTimeout,
      gpuCount: endpoint.gpu?.count ?? 1,
      env: endpoint.env ?? {}
    };
  }
  /**
   * The flex price of the endpoint's dearest GPU type, times its GPUs per worker: a worker may
   * land on any type of its pools. Throws when no price is listed.
   */
  async #serverlessPrice(id) {
    const endpoint = await this.#request(
      `/serverless/${encodeURIComponent(id)}`
    );
    const pools = new Set(endpoint.gpu?.pools ?? []);
    const excluded = new Set(endpoint.gpu?.excludedTypes ?? []);
    const { gpus } = await this.#request("/catalog/gpus");
    const prices = (gpus ?? []).filter((gpu) => gpu.pool && pools.has(gpu.pool) && !excluded.has(gpu.id)).map((gpu) => gpu.price?.serverless).filter((price) => typeof price === "number" && price > 0);
    if (prices.length === 0)
      throw new Error(`Runpod lists no Serverless price for endpoint ${id}.`);
    return Math.max(...prices) * (endpoint.gpu?.count ?? 1) / 3600;
  }
  async #request(path, method = "GET", body, absent = []) {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        ...body === void 0 ? {} : { "Content-Type": "application/json" }
      },
      body: body === void 0 ? null : JSON.stringify(body)
    });
    if (absent.includes(response.status)) return void 0;
    if (!response.ok) {
      const problem = describeProblem(await response.text().catch(() => ""));
      throw new Error(
        `Runpod ${method} ${path.split("?")[0]} failed with ${response.status}${problem ? `: ${problem}` : "."}`
      );
    }
    return response.status === 204 ? void 0 : response.json();
  }
};
function toPod(pod) {
  return {
    id: pod.id,
    name: pod.name,
    status: STATUS[pod.status] ?? "starting",
    image: pod.image ?? "",
    env: pod.env ?? {},
    gpuType: pod.gpu?.id,
    createdAt: new Date(pod.createdAt),
    pricePerSecond: typeof pod.cost === "number" && pod.cost > 0 ? pod.cost / 3600 : void 0
  };
}
function timestamp(date) {
  return `${date.toISOString().slice(0, 19)}Z`;
}
function window(start, end) {
  return `startTime=${encodeURIComponent(timestamp(start))}&endTime=${encodeURIComponent(timestamp(end))}`;
}
function describeProblem(body) {
  let problem;
  try {
    problem = JSON.parse(body);
  } catch {
    return void 0;
  }
  if (typeof problem !== "object" || problem === null) return void 0;
  const { title, detail, errors } = problem;
  const parts = [title, detail, ...Array.isArray(errors) ? errors : []].filter(
    (part) => typeof part === "string" && part.trim() !== ""
  );
  if (parts.length === 0) return void 0;
  const text = parts.join(" \u2014 ").replace(/\s+/g, " ").trim();
  return text.length > 500 ? `${text.slice(0, 499)}\u2026` : text;
}
function amount(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

// src/gateway/gateway.ts
import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  request as httpRequest
} from "node:http";
import { request as httpsRequest } from "node:https";

// src/gateway/usage.ts
function busyMs(records, idleMs, now) {
  const spans = records.map((record) => [record.start, (record.end ?? now) + idleMs]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let from;
  let to = 0;
  for (const [start, end] of spans) {
    if (from === void 0 || start > to) {
      if (from !== void 0) total += to - from;
      from = start;
      to = end;
    } else {
      to = Math.max(to, end);
    }
  }
  return from === void 0 ? 0 : total + to - from;
}
function meterCost(meter, start, records, now) {
  const ms = meter.kind === "time" ? Math.max(0, now - start) : busyMs(records, meter.idleMs, now);
  return ms / 1e3 * meter.pricePerSecond;
}
function summarize(records, meter, start, now) {
  let inputTokens = 0;
  let outputTokens = 0;
  let maxInputTokens;
  let rates = 0;
  let measured = 0;
  for (const record of records) {
    inputTokens += record.input ?? 0;
    outputTokens += record.output ?? 0;
    if (record.input !== void 0) maxInputTokens = Math.max(maxInputTokens ?? 0, record.input);
    const from = record.firstByte ?? record.start;
    if (record.streamed && record.output && record.end !== void 0 && record.end > from) {
      rates += record.output / ((record.end - from) / 1e3);
      measured++;
    }
  }
  return {
    requests: records.length,
    inputTokens,
    outputTokens,
    maxInputTokens,
    tokensPerSecond: measured > 0 ? rates / measured : void 0,
    cost: meterCost(meter, start, records, now),
    start,
    end: now
  };
}
var EventReader = class {
  #buffer = "";
  #onData;
  constructor(onData) {
    this.#onData = onData;
  }
  /** Whether the text read so far ends at an event's end. */
  get atBoundary() {
    return this.#buffer === "" && this.#ended;
  }
  #ended = true;
  feed(text) {
    this.#buffer += text;
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) {
      this.#ended = line === "";
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        this.#onData(JSON.parse(payload));
      } catch {
      }
    }
    if (this.#buffer !== "") this.#ended = false;
  }
};

// src/gateway/gateway.ts
var ROUTES = /* @__PURE__ */ new Set(["POST /v1/chat/completions", "POST /v1/completions", "GET /v1/models"]);
var MAX_BODY_BYTES = 32 * 1024 * 1024;
var KEEP_ALIVE_MS = 2e4;
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
function matches(token, hash) {
  if (!token || !hash) return false;
  const given = Buffer.from(sha256(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
var Gateway = class {
  #options;
  #now;
  #run;
  #records = [];
  /** The last time a request arrived or a run started or ended. */
  lastActivity;
  ready = false;
  contextLength;
  constructor(options) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.lastActivity = this.#now();
  }
  /** Starts a run, whose token replaces any earlier one. */
  startRun(run) {
    this.#run = { ...run, active: true };
    this.#records = [];
    this.lastActivity = this.#now();
  }
  /** Ends the run: its token stops working. Returns what it used. */
  endRun() {
    const usage = this.usage();
    if (this.#run) this.#run.active = false;
    this.lastActivity = this.#now();
    return usage;
  }
  /** What the current or last run used so far. */
  usage() {
    const run = this.#run;
    return run ? summarize(this.#records, run.meter, run.start, this.#now()) : void 0;
  }
  /** Whether a run is being served. */
  get serving() {
    return this.#run?.active === true;
  }
  /** When the current run's budget is spent, for a meter that knows in advance. */
  get deadline() {
    const run = this.#run;
    if (!run?.active || run.meter.kind !== "time") return void 0;
    return run.start + Math.floor(run.limit / run.meter.pricePerSecond * 1e3);
  }
  /** Whether the current run may still spend. */
  #withinBudget() {
    const run = this.#run;
    if (!run) return false;
    return meterCost(run.meter, run.start, this.#records, this.#now()) < run.limit;
  }
  status() {
    return {
      ready: this.ready,
      contextLength: this.contextLength,
      serving: this.serving,
      deadline: this.deadline,
      lastActivity: this.lastActivity
    };
  }
  /** Listens on `host` (the loopback by default) and a free port unless one is given. */
  async listen(host = "127.0.0.1", port = 0) {
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error2) => {
        this.#log(`Request failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
        if (!response.headersSent) send(response, 500, { error: { message: "Gateway error." } });
        else response.end();
      });
    });
    await new Promise((resolve) => server.listen(port, host, resolve));
    const address = server.address();
    return { server, url: `http://${host}:${address.port}` };
  }
  async handle(request, response) {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const route = `${request.method} ${path}`;
    if (route === "GET /health") return send(response, 200, { ready: this.ready });
    if (path.startsWith("/admin/") || path === "/usage")
      return this.#admin(route, request, response);
    if (!ROUTES.has(route)) return send(response, 404, error("Not found."));
    if (!this.serving || !matches(bearer(request), this.#run?.tokenSha256)) {
      return send(response, 401, error("Invalid token."));
    }
    this.lastActivity = this.#now();
    if (!this.#withinBudget()) {
      return send(response, 402, error("This run's budget is spent.", "budget_exceeded"));
    }
    if (!this.ready) return send(response, 503, error("The model is not loaded yet."));
    await this.#forward(request, response, path);
  }
  async #admin(route, request, response) {
    if (!matches(bearer(request), this.#options.adminSha256)) {
      return send(response, 401, error("Invalid token."));
    }
    if (route === "GET /usage") return send(response, 200, this.usage() ?? null);
    if (route === "GET /admin/status") return send(response, 200, this.status());
    if (route === "POST /admin/run") {
      const body = parseJson(await readBody(request, 64 * 1024));
      const run = runSettings(body);
      if (!run) return send(response, 400, error("Invalid run."));
      this.startRun(run);
      return send(response, 200, this.status());
    }
    if (route === "POST /admin/end") return send(response, 200, this.endRun() ?? null);
    return send(response, 404, error("Not found."));
  }
  async #forward(request, response, path) {
    let body;
    let stream = false;
    if (request.method === "POST") {
      const json = parseJson(await readBody(request, MAX_BODY_BYTES));
      if (typeof json !== "object" || json === null) {
        return send(response, 400, error("The body must be a JSON object."));
      }
      const payload = json;
      stream = payload.stream === true;
      if (stream) {
        const options = typeof payload.stream_options === "object" ? payload.stream_options : {};
        payload.stream_options = { ...options, include_usage: true };
      }
      body = JSON.stringify(payload);
    }
    const record = { start: this.#now(), streamed: stream };
    this.#records.push(record);
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableFinished) abort.abort();
    });
    let lastWrite = this.#now();
    const reader = new EventReader((data) => {
      const usage = this.#options.engine.usage(data);
      if (usage) Object.assign(record, usage);
    });
    const keepAlive = stream ? setInterval(
      () => {
        if (this.#now() - lastWrite < (this.#options.keepAliveMs ?? KEEP_ALIVE_MS)) return;
        if (!response.headersSent) response.writeHead(200, SSE_HEADERS);
        if (reader.atBoundary) response.write(": keep-alive\n\n");
        lastWrite = this.#now();
      },
      Math.max(1, Math.floor((this.#options.keepAliveMs ?? KEEP_ALIVE_MS) / 2))
    ) : void 0;
    try {
      const upstream = await forward(`${this.#options.upstream}${path.slice("/v1".length)}`, {
        method: request.method ?? "GET",
        headers: {
          ...body === void 0 ? {} : { "Content-Type": "application/json" },
          ...this.#options.upstreamHeaders
        },
        body,
        signal: abort.signal
      });
      const contentType = header(upstream.headers["content-type"]) ?? "application/json";
      const status = upstream.statusCode ?? 502;
      if (status < 200 || status >= 300) {
        let text2 = "";
        for await (const chunk of upstream) {
          if (text2.length < 4e3) text2 += chunk.toString("utf8");
        }
        text2 = text2.slice(0, 4e3);
        record.end = this.#now();
        if (response.headersSent) {
          response.end(
            `data: ${JSON.stringify(error(text2 || "Engine error.", `upstream_${status}`))}

`
          );
        } else {
          response.writeHead(status, { "Content-Type": contentType });
          response.end(text2);
        }
        return;
      }
      if (!response.headersSent) {
        response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-cache" });
      }
      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of upstream) {
        record.firstByte ??= this.#now();
        const part = decoder.decode(chunk, { stream: true });
        if (stream) reader.feed(part);
        else text += part;
        response.write(chunk);
        lastWrite = this.#now();
      }
      record.end = this.#now();
      if (!stream) {
        const usage = this.#options.engine.usage(parseJson(text));
        if (usage) Object.assign(record, usage);
      }
      response.end();
    } catch (failure) {
      record.end ??= this.#now();
      if (abort.signal.aborted) return;
      this.#log(
        `The engine failed: ${failure instanceof Error ? failure.message : String(failure)}`
      );
      if (!response.headersSent) send(response, 502, error("The engine did not answer."));
      else response.end(`data: ${JSON.stringify(error("The engine did not answer."))}

`);
    } finally {
      clearInterval(keepAlive);
      this.lastActivity = this.#now();
    }
  }
  #log(message) {
    this.#options.log?.(message);
  }
};
function forward(url, options) {
  const request = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: options.method,
      headers: options.headers,
      signal: options.signal
    });
    outgoing.on("response", resolve);
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}
function header(value) {
  return Array.isArray(value) ? value[0] : value;
}
var SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive"
};
function error(message, code) {
  return { error: { message: `Codeman gateway: ${message}`, ...code ? { code } : {} } };
}
function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
function bearer(request) {
  const header2 = request.headers.authorization ?? "";
  return /^Bearer (\S+)$/.exec(header2)?.[1];
}
async function readBody(request, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) throw new Error("The request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function runSettings(body) {
  if (typeof body !== "object" || body === null) return void 0;
  const { tokenSha256, limit, start, pricePerSecond, idleSeconds } = body;
  const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (typeof tokenSha256 !== "string" || !/^[0-9a-f]{64}$/.test(tokenSha256)) return void 0;
  if (!positive(limit) || !positive(start) || !positive(pricePerSecond)) return void 0;
  if (idleSeconds === void 0) {
    return { tokenSha256, limit, start, meter: { kind: "time", pricePerSecond } };
  }
  if (typeof idleSeconds !== "number" || !Number.isFinite(idleSeconds) || idleSeconds < 0) {
    return void 0;
  }
  return {
    tokenSha256,
    limit,
    start,
    meter: { kind: "busy", pricePerSecond, idleMs: idleSeconds * 1e3 }
  };
}

// src/gateway/pod.ts
var GATEWAY_PORT = 8080;
function expiry(state, policy, now) {
  if (!state.ready) {
    return now >= policy.startBy ? "the model was not served in time" : void 0;
  }
  if (state.serving) {
    if (state.deadline !== void 0 && now >= state.deadline) return "the run's budget is spent";
    if (now - state.lastActivity >= policy.runIdleMs) return "the run made no request for too long";
    return void 0;
  }
  return now - state.lastActivity >= policy.keptIdleMs ? "no run came to use it" : void 0;
}
function podSettings(env) {
  const model = env.CODEMAN_MODEL;
  const adminSha256 = env.CODEMAN_ADMIN_SHA256;
  const startBy = Date.parse(env.CODEMAN_START_BY ?? "");
  const keptIdle = Number(env.CODEMAN_KEPT_IDLE_MINUTES ?? "15");
  const runIdle = Number(env.CODEMAN_RUN_IDLE_MINUTES ?? "30");
  if (!model || !adminSha256 || !/^[0-9a-f]{64}$/.test(adminSha256) || Number.isNaN(startBy)) {
    throw new Error("CODEMAN_MODEL, CODEMAN_ADMIN_SHA256 and CODEMAN_START_BY are required.");
  }
  if (!(keptIdle > 0) || !(runIdle > 0)) throw new Error("Idle limits must be positive.");
  return {
    model,
    adminSha256,
    policy: { startBy, keptIdleMs: keptIdle * 6e4, runIdleMs: runIdle * 6e4 },
    podId: env.RUNPOD_POD_ID,
    podKey: env.RUNPOD_API_KEY
  };
}
async function prepareOllama(server, model, log) {
  const call = async (path, body) => {
    const response = await (server.fetch ?? fetch)(`${server.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Ollama ${path} failed with ${response.status}.`);
    return response.json();
  };
  await untilUp(server);
  log(`Pulling ${model}.`);
  await pull(server, model);
  const contextLength = ollamaContextLength(await call("/api/show", { model }));
  log(`Serving ${model} with a context length of ${contextLength ?? "Ollama's default"}.`);
  await server.restart(contextLength);
  await untilUp(server);
  await call("/api/generate", { model, keep_alive: -1 });
  return contextLength;
}
async function pull(server, model) {
  const response = await (server.fetch ?? fetch)(`${server.url}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true })
  });
  if (!response.ok || !response.body)
    throw new Error(`Ollama /api/pull failed with ${response.status}.`);
  const decoder = new TextDecoder();
  let rest = "";
  let last = {};
  for await (const chunk of response.body) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      last = JSON.parse(line);
      if (last.error) throw new Error(`Ollama could not pull ${model}: ${last.error}`);
    }
  }
  if (rest.trim() !== "") last = JSON.parse(rest);
  if (last.error || last.status !== "success") {
    throw new Error(`Ollama could not pull ${model}: ${last.error ?? last.status ?? "no status"}`);
  }
}
async function untilUp(server) {
  const wait = server.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await (server.fetch ?? fetch)(`${server.url}/api/version`)).ok) return;
    } catch {
    }
    await wait(1e3);
  }
  throw new Error("Ollama did not start.");
}

// src/gateway/main.ts
async function main() {
  const settings = podSettings(process.env);
  const log = (message) => console.log(`[codeman] ${message}`);
  let ollamaProcess;
  const terminate = async (reason) => {
    log(`Terminating the pod: ${reason}.`);
    if (settings.podId && settings.podKey) {
      await new Runpod(settings.podKey).pods.terminate(settings.podId).catch((error2) => {
        log(`Could not terminate the pod: ${error2 instanceof Error ? error2.message : error2}`);
      });
    }
    ollamaProcess?.kill("SIGTERM");
    process.exit(0);
  };
  if (Date.now() >= settings.policy.startBy) await terminate("it started after its start limit");
  const gateway = new Gateway({
    upstream: `${OLLAMA_URL}/v1`,
    engine: ollama,
    adminSha256: settings.adminSha256,
    log
  });
  await gateway.listen("0.0.0.0", GATEWAY_PORT);
  log(`Gateway listening on port ${GATEWAY_PORT}.`);
  ollamaProcess = serve(void 0);
  setInterval(() => {
    const reason = expiry(gateway, settings.policy, Date.now());
    if (reason) void terminate(reason);
  }, 15e3).unref();
  try {
    gateway.contextLength = await prepareOllama(
      {
        url: OLLAMA_URL,
        restart: async (contextLength) => {
          await stop(ollamaProcess);
          ollamaProcess = serve(contextLength);
        }
      },
      settings.model,
      log
    );
    gateway.ready = true;
    gateway.lastActivity = Date.now();
    log("Ready.");
  } catch (error2) {
    await terminate(
      `the model could not be served: ${error2 instanceof Error ? error2.message : error2}`
    );
  }
}
function serve(contextLength) {
  return spawn("ollama", ["serve"], {
    stdio: "inherit",
    env: {
      ...process.env,
      OLLAMA_HOST: "127.0.0.1:11434",
      OLLAMA_KEEP_ALIVE: "-1",
      ...contextLength ? { OLLAMA_CONTEXT_LENGTH: String(contextLength) } : {}
    }
  });
}
function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
await main();
