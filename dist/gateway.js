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
var HOUR_MS = 36e5;
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
      queueUrl: (id) => `https://api.runpod.ai/v2/${encodeURIComponent(id)}`
    };
  }
  /**
   * `GET /v2/billing`, by hour: the account's total for each hour from `start` (UTC). The API
   * snaps the window to whole hours, and takes `startTime` only with `endTime`.
   */
  async billedHours(start, end) {
    const from = new Date(start.getTime() - start.getTime() % HOUR_MS);
    const to = new Date(Math.ceil(end.getTime() / HOUR_MS) * HOUR_MS);
    const response = await this.#request(`/billing?bucketSize=hour&${window(from, to)}`);
    const hours = /* @__PURE__ */ new Map();
    for (const record of response.records ?? []) {
      const at = Date.parse(record.startTime ?? "");
      if (!Number.isFinite(at) || at < from.getTime()) continue;
      const hour = at - at % HOUR_MS;
      hours.set(hour, (hours.get(hour) ?? 0) + amount(record.totalAmount));
    }
    return hours;
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
function busySpans(records, idleMs, now, samples = []) {
  const spans = merge(records.map((record) => [record.start, (record.end ?? now) + idleMs]));
  const unbilledSpans = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (unbilled(a) && unbilled(b)) unbilledSpans.push([a.at, b.at]);
  }
  return subtract(spans, merge(unbilledSpans));
}
function busyMs(records, idleMs, now, samples = []) {
  return busySpans(records, idleMs, now, samples).reduce((sum, [from, to]) => sum + to - from, 0);
}
function merge(spans) {
  const merged = [];
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}
function subtract(spans, holes) {
  const left = [];
  let first = 0;
  for (const [from, to] of spans) {
    let start = from;
    while (first < holes.length && holes[first][1] <= start) first++;
    for (let i = first; i < holes.length && holes[i][0] < to; i++) {
      const [holeFrom, holeTo] = holes[i];
      if (holeFrom > start) left.push([start, holeFrom]);
      start = Math.max(start, holeTo);
    }
    if (start < to) left.push([start, to]);
  }
  return left;
}
function unbilled(sample) {
  return sample.workers === "starting" || sample.workers === "none";
}
function meterCost(meter, start, records, now, samples = []) {
  const ms = meter.kind === "time" ? Math.max(0, now - start) : busyMs(records, meter.idleMs, now, samples);
  return ms / 1e3 * meter.pricePerSecond;
}
function podShares(runs, kept, now, pricePerSecond) {
  const until = (end) => Math.min(end ?? now, now);
  const points = /* @__PURE__ */ new Set();
  for (const run of runs) points.add(Math.min(run.start, now)).add(until(run.end));
  for (const span of kept) points.add(Math.min(span.from, now)).add(until(span.to));
  const times = [...points].sort((a, b) => a - b);
  const shares = { runs: /* @__PURE__ */ new Map(), kept: /* @__PURE__ */ new Map() };
  for (let i = 1; i < times.length; i++) {
    const from = times[i - 1];
    const to = times[i];
    const seconds = (to - from) / 1e3;
    const on = runs.filter((run) => run.start <= from && until(run.end) >= to);
    for (const run of on) {
      const share = seconds * run.pricePerSecond / on.length;
      shares.runs.set(run.id, (shares.runs.get(run.id) ?? 0) + share);
    }
    if (on.length > 0) continue;
    const keepers = new Set(
      kept.filter((span) => span.from <= from && until(span.to) >= to).map((span) => span.task)
    );
    for (const task of keepers) {
      const share = seconds * pricePerSecond / keepers.size;
      shares.kept.set(task, (shares.kept.get(task) ?? 0) + share);
    }
  }
  return shares;
}
function summarize(records, meter, start, now, samples = []) {
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
    cost: meterCost(meter, start, records, now, samples),
    start,
    end: now,
    ...meter.kind === "busy" ? { busy: busySpans(records, meter.idleMs, now, samples) } : {}
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
var TASK = /^\d{1,12}$/;
var GROUP = /^[\w.-]{1,100}$/;
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
var RunStopped = class extends Error {
};
var GATEWAY_VERSION = 2;
var Gateway = class {
  #options;
  #now;
  /** Every run, in the order they started. */
  #runs = [];
  /** When each task kept the pod between its runs. */
  #kept = [];
  #nextId = 1;
  /** The group of runs that share the pod, as the last run that named one gave it. */
  group;
  /** The last time a request arrived or a run started or ended. */
  lastActivity;
  ready = false;
  contextLength;
  constructor(options) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.lastActivity = this.#now();
  }
  /**
   * Starts a run. A run of a task replaces that task's earlier one; a run that names no task
   * replaces every run, as when the gateway served one at a time.
   */
  startRun(settings) {
    const now = this.#now();
    const task = settings.task ?? "";
    for (const run of this.#runs) {
      if (run.active && (task === "" || run.task === task)) this.#end(run, now);
    }
    this.release(task);
    this.#runs.push({
      ...settings,
      id: this.#nextId++,
      task,
      active: true,
      records: [],
      samples: [],
      lastActivity: now,
      open: /* @__PURE__ */ new Set()
    });
    if (settings.group) this.group = settings.group;
    this.lastActivity = now;
  }
  /**
   * Records what the provider said of the workers, for each run's busy meter. A request that
   * waits `noWorkerMs` while every sample sees no worker starting or running stops its run;
   * unknown samples neither prove a worker nor its absence.
   */
  observe(sample) {
    for (const run of this.#runs.filter((one) => one.active)) {
      run.samples.push(sample);
      const limit = this.#options.noWorkerMs;
      const waiting = run.records.some((record) => record.end === void 0);
      if (limit === void 0 || sample.workers === void 0) continue;
      if (!waiting || sample.workers !== "none") {
        run.noWorkerSince = void 0;
        continue;
      }
      run.noWorkerSince ??= sample.at;
      if (sample.at - run.noWorkerSince >= limit) {
        const minutes = Math.round(limit / 6e4);
        this.#stop(
          run,
          `No worker of the endpoint started or ran for ${minutes} minutes while a request waited, as when it has no GPU.`
        );
      }
    }
  }
  /** Stops serving a run: its waiting requests fail with `reason`, and so do new ones. */
  #stop(run, reason) {
    if (!run.active) return;
    this.#end(run, this.#now());
    run.stopped = reason;
    this.#log(reason);
    for (const abort of run.open) abort.abort(new RunStopped(reason));
    this.#options.onStop?.(reason);
  }
  #end(run, now) {
    run.active = false;
    run.end ??= now;
    this.lastActivity = now;
  }
  /**
   * Ends a run, by its token's hash, or the last one: its token stops working. With `keep`, its
   * task keeps the pod for its next run, and is given the pod's time while no run uses it.
   * Returns what the run used.
   */
  endRun(options = {}) {
    const run = this.#find(options.tokenSha256);
    if (!run) return void 0;
    const now = this.#now();
    this.#end(run, now);
    if (options.keep && run.task && !this.#keepers().includes(run.task)) {
      this.#kept.push({ task: run.task, from: now });
    }
    const usage = this.usage(run.tokenSha256);
    return run.task ? { ...usage, share: this.#share(run.task, now) } : usage;
  }
  /** The task no longer keeps the pod: it does not go on to another run now. */
  release(task) {
    const now = this.#now();
    for (const span of this.#kept) if (span.task === task && span.to === void 0) span.to = now;
  }
  /** What a run, by its token's hash, or the last one, used so far. */
  usage(tokenSha256) {
    const run = this.#find(tokenSha256);
    if (!run) return void 0;
    const now = run.end ?? this.#now();
    return {
      ...summarize(run.records, run.meter, run.start, now, run.samples),
      cost: this.#cost(run)
    };
  }
  #find(tokenSha256) {
    if (tokenSha256 === void 0) return this.#runs.at(-1);
    return this.#runs.findLast((run) => run.tokenSha256 === tokenSha256);
  }
  /** Whether a run is being served. */
  get serving() {
    return this.#runs.some((run) => run.active);
  }
  /** The runs being served, for the pod's limits. */
  get runs() {
    return this.#runs.filter((run) => run.active).map((run) => ({ deadline: this.#deadline(run), lastActivity: run.lastActivity }));
  }
  /** When the first of the runs' budgets is spent, for a meter that knows in advance. */
  get deadline() {
    const deadlines = this.runs.flatMap(
      (run) => run.deadline === void 0 ? [] : [run.deadline]
    );
    return deadlines.length > 0 ? Math.min(...deadlines) : void 0;
  }
  /**
   * When a pod's run would spend its budget, were it alone from now on: other runs only make it
   * later, so the pod checks again.
   */
  #deadline(run) {
    if (!run.active || run.meter.kind !== "time") return void 0;
    const now = this.#now();
    return now + Math.floor((run.limit - this.#cost(run)) / run.meter.pricePerSecond * 1e3);
  }
  /**
   * Stops the runs whose budget is spent or whose agent made no request for `runIdleMs`, while
   * others go on; when none would, the pod terminates instead.
   */
  expireRuns(runIdleMs) {
    const now = this.#now();
    for (const run of this.#runs.filter((one) => one.active)) {
      if (!this.#withinBudget(run)) this.#stop(run, "This run's budget is spent.");
      else if (now - run.lastActivity >= runIdleMs) {
        this.#stop(run, "This run made no request for too long.");
      }
    }
  }
  /** What a run cost so far: its share of the pod's time, or its workers' busy time. */
  #cost(run) {
    const now = this.#now();
    if (run.meter.kind === "busy") {
      return meterCost(run.meter, run.start, run.records, run.end ?? now, run.samples);
    }
    return this.#shares(now).runs.get(run.id) ?? 0;
  }
  /** The pod's split among its runs and the tasks that keep it. */
  #shares(now) {
    const spans = [];
    for (const run of this.#runs) {
      if (run.meter.kind !== "time") continue;
      spans.push({
        id: run.id,
        start: run.start,
        end: run.end,
        pricePerSecond: run.meter.pricePerSecond
      });
    }
    return podShares(spans, this.#kept, now, spans.at(-1)?.pricePerSecond ?? 0);
  }
  #share(task, now) {
    const shares = this.#shares(now);
    let taskCost = shares.kept.get(task) ?? 0;
    for (const run of this.#runs) {
      if (run.task === task) taskCost += shares.runs.get(run.id) ?? 0;
    }
    const tasks = (runs) => [
      ...new Set(runs.map((run) => run.task).filter((one) => one !== ""))
    ];
    return {
      taskCost,
      tasks: tasks(this.#runs),
      active: tasks(this.#runs.filter((run) => run.active)),
      keepers: this.#keepers()
    };
  }
  #keepers() {
    return [...new Set(this.#kept.filter((span) => span.to === void 0).map((s) => s.task))];
  }
  /** Whether a run may still spend. */
  #withinBudget(run) {
    return this.#cost(run) < run.limit;
  }
  status() {
    const active = this.#runs.filter((run) => run.active);
    return {
      version: GATEWAY_VERSION,
      ready: this.ready,
      contextLength: this.contextLength,
      serving: this.serving,
      deadline: this.deadline,
      lastActivity: this.lastActivity,
      group: this.group,
      tasks: [...new Set(this.#runs.map((run) => run.task).filter((task) => task !== ""))],
      active: [...new Set(active.map((run) => run.task).filter((task) => task !== ""))],
      keepers: this.#keepers()
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
    const token = bearer(request);
    const run = this.#runs.findLast((one) => matches(token, one.tokenSha256));
    if (run?.stopped) return send(response, 503, error(run.stopped, "run_stopped"));
    if (!run?.active) return send(response, 401, error("Invalid token."));
    this.lastActivity = run.lastActivity = this.#now();
    if (!this.#withinBudget(run)) {
      return send(response, 402, error("This run's budget is spent.", "budget_exceeded"));
    }
    if (!this.ready) return send(response, 503, error("The model is not loaded yet."));
    await this.#forward(run, request, response, path);
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
    if (route === "POST /admin/end") {
      const body = parseJson(await readBody(request, 64 * 1024)) ?? {};
      const tokenSha256 = typeof body.tokenSha256 === "string" ? body.tokenSha256 : void 0;
      return send(response, 200, this.endRun({ tokenSha256, keep: body.keep === true }) ?? null);
    }
    if (route === "POST /admin/release") {
      const body = parseJson(await readBody(request, 64 * 1024)) ?? {};
      if (typeof body.task !== "string" || !TASK.test(body.task)) {
        return send(response, 400, error("Invalid task."));
      }
      this.release(body.task);
      return send(response, 200, this.status());
    }
    return send(response, 404, error("Not found."));
  }
  async #forward(run, request, response, path) {
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
    run.records.push(record);
    const abort = new AbortController();
    run.open.add(abort);
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
      const send2 = this.#options.send ?? this.#http;
      const upstream = await send2({
        method: request.method ?? "GET",
        path,
        body,
        signal: abort.signal
      });
      const contentType = upstream.contentType ?? "application/json";
      const status = upstream.status;
      const decoder = new TextDecoder();
      const decode = (chunk) => typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      if (status < 200 || status >= 300) {
        let text2 = "";
        for await (const chunk of upstream.body) {
          if (text2.length < 4e3) text2 += decode(chunk);
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
      let text = "";
      for await (const chunk of upstream.body) {
        record.firstByte ??= this.#now();
        const part = decode(chunk);
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
      const reason = abort.signal.reason;
      const stopped = reason instanceof RunStopped ? reason : void 0;
      if (abort.signal.aborted && !stopped) return;
      if (!stopped) {
        this.#log(
          `The engine failed: ${failure instanceof Error ? failure.message : String(failure)}`
        );
      }
      const body2 = stopped ? error(stopped.message, "run_stopped") : error("The engine did not answer.");
      if (!response.headersSent) send(response, stopped ? 503 : 502, body2);
      else response.end(`data: ${JSON.stringify(body2)}

`);
    } finally {
      run.open.delete(abort);
      clearInterval(keepAlive);
      this.lastActivity = run.lastActivity = this.#now();
    }
  }
  /** The engine at `upstream`, over HTTP. */
  #http = async (request) => {
    const response = await forward(`${this.#options.upstream}${request.path.slice("/v1".length)}`, {
      method: request.method,
      headers: {
        ...request.body === void 0 ? {} : { "Content-Type": "application/json" },
        ...this.#options.upstreamHeaders
      },
      body: request.body,
      signal: request.signal
    });
    return {
      status: response.statusCode ?? 502,
      contentType: header(response.headers["content-type"]),
      body: response
    };
  };
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
  const { tokenSha256, limit, start, pricePerSecond, idleSeconds, task, group } = body;
  const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (typeof tokenSha256 !== "string" || !/^[0-9a-f]{64}$/.test(tokenSha256)) return void 0;
  if (!positive(limit) || !positive(start) || !positive(pricePerSecond)) return void 0;
  if (task !== void 0 && (typeof task !== "string" || !TASK.test(task))) return void 0;
  if (group !== void 0 && (typeof group !== "string" || !GROUP.test(group))) return void 0;
  const named = { ...task ? { task } : {}, ...group ? { group } : {} };
  if (idleSeconds === void 0) {
    return { tokenSha256, limit, start, meter: { kind: "time", pricePerSecond }, ...named };
  }
  if (typeof idleSeconds !== "number" || !Number.isFinite(idleSeconds) || idleSeconds < 0) {
    return void 0;
  }
  return {
    tokenSha256,
    limit,
    start,
    meter: { kind: "busy", pricePerSecond, idleMs: idleSeconds * 1e3 },
    ...named
  };
}

// src/gateway/pod.ts
var GATEWAY_PORT = 8080;
function expiry(state, policy, now) {
  if (!state.ready) {
    return now >= policy.startBy ? "the model was not served in time" : void 0;
  }
  const runs = state.runs ?? (state.serving ? [{ deadline: state.deadline, lastActivity: state.lastActivity }] : []);
  if (runs.length > 0) {
    const spent = (run) => run.deadline !== void 0 && now >= run.deadline;
    const silent = (run) => now - run.lastActivity >= policy.runIdleMs;
    if (!runs.every((run) => spent(run) || silent(run))) return void 0;
    if (runs.length > 1) return "every run on it spent its budget or made no request for too long";
    return runs.every(spent) ? "the run's budget is spent" : "the run made no request for too long";
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
    else gateway.expireRuns(settings.policy.runIdleMs);
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
