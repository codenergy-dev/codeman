/**
 * Proves each behavior of the prototype supervisor, with timings, inside the experiment's
 * container (Dockerfile). Each scenario starts a supervisor of its own and prints what it saw.
 *
 * Usage, in the container, after install.ts and the model's download (see run.sh):
 *   node prove.ts <scenario>...   scenarios: model lazy idle budget hold swap async failure
 *                                 occupancy, or all
 * Reads /data/proof/sizes.json, which `model` writes, to size the budgets of the others.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { OllamaAdapter, PythonAdapter } from "./adapters.ts";
import { type Footprint, MB, mb, type ServiceSpec } from "./services.ts";
import { Supervisor } from "./supervisor.ts";

const ENGINE = "/data/engines/diffusers-cpu";
const MODEL = "/data/models/tiny-random-sd";
const OUTPUTS = "/data/outputs";
const SIZES = "/data/proof/sizes.json";

interface Sizes {
  primary: number;
  subagent: number;
  generator: number;
}

function specs(overrides: Partial<Record<keyof Sizes, Partial<ServiceSpec>>> = {}): ServiceSpec[] {
  const sizes = readSizes();
  return [
    {
      name: "primary",
      family: "ollama",
      model: "qwen2.5:0.5b",
      kind: "chat",
      primary: true,
      estimateBytes: sizes?.primary ?? 1200 * MB,
      ...overrides.primary,
    },
    {
      name: "subagent",
      family: "ollama",
      model: "smollm2:135m",
      kind: "chat",
      estimateBytes: sizes?.subagent ?? 600 * MB,
      idleMs: 60_000,
      ...overrides.subagent,
    },
    {
      name: "generator",
      family: "python",
      model: MODEL,
      kind: "generation",
      estimateBytes: sizes?.generator ?? 900 * MB,
      idleMs: 60_000,
      ...overrides.generator,
    },
  ];
}

function readSizes(): Sizes | undefined {
  try {
    return JSON.parse(readFileSync(SIZES, "utf8")) as Sizes;
  } catch {
    return undefined;
  }
}

async function supervisor(
  options: { budget?: number; services?: ServiceSpec[]; keepAliveMs?: number } = {},
): Promise<{ supervisor: Supervisor; url: string; started: number }> {
  mkdirSync(OUTPUTS, { recursive: true });
  const t0 = Date.now();
  const one = new Supervisor({
    services: options.services ?? specs(),
    adapters: [
      new OllamaAdapter(),
      new PythonAdapter({
        python: `${ENGINE}/venv/bin/python`,
        script: "/opt/supervisor/generator.py",
        outputs: OUTPUTS,
      }),
    ],
    budgetBytes: options.budget ?? 4000 * MB,
    outputs: OUTPUTS,
    keepAliveMs: options.keepAliveMs ?? 250,
    log: (message) => console.log(`    [${((Date.now() - t0) / 1000).toFixed(2)} s] ${message}`),
  });
  await one.start();
  const url = await one.listen();
  console.log(`  started with the primary loaded in ${Date.now() - t0} ms`);
  return { supervisor: one, url, started: t0 };
}

interface ChatResult {
  status: number;
  comments: number;
  firstDataMs: number | undefined;
  totalMs: number;
  text: string;
}

/** A chat request; streamed ones count the SSE comments received before the first data. */
async function chat(
  url: string,
  run: string,
  model: string,
  options: { stream?: boolean; maxTokens?: number; prompt?: string } = {},
): Promise<ChatResult> {
  const started = Date.now();
  const response = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Codeman-Run": run },
    body: JSON.stringify({
      model,
      stream: options.stream ?? false,
      max_tokens: options.maxTokens ?? 16,
      messages: [{ role: "user", content: options.prompt ?? "Say hello in five words." }],
    }),
  });
  let comments = 0;
  let firstDataMs: number | undefined;
  let text = "";
  let rest = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    const part = decoder.decode(chunk, { stream: true });
    text += part;
    if (!options.stream) continue;
    const lines = (rest + part).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith(":") && firstDataMs === undefined) comments += 1;
      if (line.startsWith("data:")) firstDataMs ??= Date.now() - started;
    }
  }
  return { status: response.status, comments, firstDataMs, totalMs: Date.now() - started, text };
}

async function submit(
  url: string,
  run: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; ms: number; job: Record<string, unknown>; bytes: number }> {
  const started = Date.now();
  const response = await fetch(`${url}/v1/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Codeman-Run": run },
    body: JSON.stringify({ model: "generator", prompt: "a red cube", ...body }),
  });
  const text = await response.text();
  return {
    status: response.status,
    ms: Date.now() - started,
    job: JSON.parse(text),
    bytes: text.length,
  };
}

async function poll(url: string, run: string, id: string): Promise<Record<string, unknown>> {
  for (;;) {
    const response = await fetch(`${url}/v1/generations/${id}`, {
      headers: { "X-Codeman-Run": run },
    });
    const job = (await response.json()) as Record<string, unknown>;
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function check(condition: boolean, what: string): void {
  console.log(`  ${condition ? "PROVED" : "FAILED"}: ${what}`);
  if (!condition) process.exitCode = 1;
}

function states(one: Supervisor): string {
  const status = one.status() as { services: { name: string; state: string }[] };
  return status.services.map((service) => `${service.name}=${service.state}`).join(" ");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const scenarios: Record<string, () => Promise<void>> = {
  /** 1. The service model: each adapter loads, measures and unloads its service. */
  async model() {
    const { supervisor: one, url } = await supervisor({ budget: 8000 * MB });
    const sizes: Record<string, number> = {};
    const measured: Record<string, Footprint | undefined> = {};
    for (const name of ["primary", "subagent", "generator"]) {
      for (let round = 0; round < 3; round += 1) {
        if (one.service(name).state !== "loaded") await one.ensure(name);
        if (name === "generator") {
          // Its peak comes with its first generation.
          const { job } = await submit(url, "measure");
          await poll(url, "measure", String(job.id));
        }
        const service = one.service(name);
        sizes[name] = Math.max(sizes[name] ?? 0, service.peakBytes);
        measured[name] = service.footprint;
        if (name === "primary" && round === 2) break;
        await one.unload(name);
      }
      const service = one.service(name);
      console.log(
        `  ${name}: ${service.adapter.family}, routes ${service.adapter.routes(service.spec).join(", ")}; ` +
          `footprint ${mb(measured[name]?.bytes)} ` +
          `(reported ${mb(measured[name]?.reported)}, rss ${mb(measured[name]?.rss)}), ` +
          `peak ${mb(sizes[name])}; loads ${service.loads.join("/")} ms, unloads ${service.unloads.join("/")} ms`,
      );
    }
    mkdirSync("/data/proof", { recursive: true });
    writeFileSync(SIZES, JSON.stringify(sizes));
    check(
      Object.values(sizes).every((bytes) => bytes > 0),
      "each adapter measures its service",
    );
    await one.stop();
  },

  /** 2. Lazy loading: the generator loads on its first request, not before. */
  async lazy() {
    const { supervisor: one, url } = await supervisor();
    const before = one.service("generator").state;
    console.log(`  after start: ${states(one)}`);
    const first = await submit(url, "run-a");
    const firstJob = await poll(url, "run-a", String(first.job.id));
    const cold = Number(firstJob.finishedAt) - Number(firstJob.submittedAt);
    const second = await submit(url, "run-a");
    const secondJob = await poll(url, "run-a", String(second.job.id));
    const warm = Number(secondJob.finishedAt) - Number(secondJob.submittedAt);
    console.log(`  first generation (with the load): ${cold} ms; second: ${warm} ms`);
    check(before === "unloaded", "the generator is not loaded until its first request");
    check(one.service("generator").state === "loaded", "it is loaded after its first request");
    await one.stop();
  },

  /** 3. Idle unloading: secondary services unused for N seconds are unloaded. */
  async idle() {
    const idleMs = 3000;
    const { supervisor: one, url } = await supervisor({
      services: specs({ subagent: { idleMs }, generator: { idleMs } }),
    });
    await chat(url, "run-a", "subagent");
    const { job } = await submit(url, "run-a");
    await poll(url, "run-a", String(job.id));
    console.log(`  in use: ${states(one)}`);
    await sleep(idleMs + 2000);
    // Each unload names how long its service had been idle, since its own last request.
    for (const event of one.events.filter((one) => one.event.startsWith("idle for"))) {
      console.log(`  ${event.service}: unloaded after being ${event.event}`);
    }
    console.log(`  after ${idleMs + 2000} ms: ${states(one)}`);
    check(
      one.service("subagent").state === "unloaded" && one.service("generator").state === "unloaded",
      `the subagent and the generator unload after ${idleMs} ms idle`,
    );
    check(one.service("primary").state === "loaded", "the primary stays loaded");
    await one.stop();
  },

  /** 4. A memory budget: LRU idle eviction, and never a service with a request in flight. */
  async budget() {
    const sizes = readSizes() as Sizes;
    // The primary fits beside either secondary service, not beside both.
    const budget =
      sizes.primary +
      Math.max(sizes.subagent, sizes.generator) +
      Math.min(sizes.subagent, sizes.generator) / 2;
    console.log(
      `  budget ${mb(budget)}: ${mb(sizes.primary)} + ${mb(sizes.subagent)} + ${mb(sizes.generator)} do not fit`,
    );
    const { supervisor: one, url } = await supervisor({ budget });
    await chat(url, "run-a", "subagent");
    console.log(`  after a subagent chat: ${states(one)}`);
    const first = await submit(url, "run-a");
    await poll(url, "run-a", String(first.job.id));
    console.log(`  after a generation: ${states(one)}`);
    check(
      one.events.some(
        (event) => event.service === "subagent" && event.event === "evicted for generator",
      ),
      "loading the generator evicts the idle subagent, the least recently used",
    );
    // A long streamed chat keeps the subagent busy while the generator asks for memory.
    const long = chat(url, "run-b", "subagent", {
      stream: true,
      maxTokens: 60,
      prompt: "Write a long story about a lighthouse.",
    });
    await sleep(300);
    while (one.service("subagent").inFlight === 0) await sleep(50);
    const asked = Date.now();
    const second = submit(url, "run-a").then(({ job }) => poll(url, "run-a", String(job.id)));
    const story = await long;
    const ended = Date.now();
    const job = await second;
    const loading = one.events.find(
      (event) => event.service === "generator" && event.event === "loading" && event.at >= asked,
    );
    console.log(
      `  the subagent's stream ran ${story.totalMs} ms; the generator waited ` +
        `${(loading?.at ?? 0) - asked} ms for memory, then loaded; generation ${job.status}`,
    );
    check(
      loading !== undefined && loading.at >= ended - 50,
      "the subagent, with a request in flight, is evicted only after it ends",
    );
    await one.stop();
  },

  /** 5. Holding: a streamed chat to a service that loads gets SSE comments, then completes. */
  async hold() {
    const { supervisor: one, url } = await supervisor();
    const result = await chat(url, "run-a", "subagent", { stream: true });
    console.log(
      `  cold subagent: ${result.comments} SSE comments, first data at ${result.firstDataMs} ms, ` +
        `done at ${result.totalMs} ms`,
    );
    check(
      result.comments > 0 && result.text.includes("[DONE]"),
      "held with comments, then completed",
    );
    await one.stop();
  },

  /** 6. Swap mode: the primary sleeps while the generator runs, then comes back. */
  async swap() {
    const sizes = readSizes() as Sizes;
    const budget = Math.max(sizes.primary, sizes.generator) * 1.1;
    console.log(`  budget ${mb(budget)} < ${mb(sizes.primary)} + ${mb(sizes.generator)}`);
    const { supervisor: one, url } = await supervisor({ budget });
    const asked = Date.now();
    const submitted = await submit(url, "run-a", { steps: 30, size: 256 });
    // The agent's next chat arrives while the primary sleeps: it is held, then served.
    await sleep(200);
    const held = chat(url, "run-a", "primary", { stream: true });
    const job = await poll(url, "run-a", String(submitted.job.id));
    const answer = await held;
    await new Promise<void>((resolve) => {
      const wait = () =>
        one.service("primary").state === "loaded" ? resolve() : setTimeout(wait, 50);
      wait();
    });
    const back = Date.now();
    const timeline = one.events.filter((event) => event.at >= asked);
    for (const event of timeline)
      console.log(`  +${event.at - asked} ms ${event.service}: ${event.event}`);
    console.log(
      `  generation ran ${Number(job.finishedAt) - Number(job.startedAt)} ms; round trip from ` +
        `submit to the primary serving again: ${back - asked} ms; the held chat got ` +
        `${answer.comments} comments, first data at ${answer.firstDataMs} ms`,
    );
    check(
      timeline.some((event) => event.service === "primary" && event.event.startsWith("evicted")) &&
        one.service("primary").state === "loaded" &&
        answer.text.includes("[DONE]"),
      "the primary is put to sleep for the generator, restored after it, and its chat completes",
    );
    await one.stop();
  },

  /** 7. Asynchronous generation: submit, poll, content from a file. */
  async async() {
    const { supervisor: one, url } = await supervisor();
    const submitted = await submit(url, "run-a", { steps: 20, size: 128 });
    console.log(
      `  submit answered ${submitted.status} in ${submitted.ms} ms: ${JSON.stringify(submitted.job)}`,
    );
    const job = await poll(url, "run-a", String(submitted.job.id));
    const content = await fetch(`${url}${job.content}`, { headers: { "X-Codeman-Run": "run-a" } });
    const bytes = Buffer.from(await content.arrayBuffer());
    const other = await fetch(`${url}/v1/generations/${job.id}`, {
      headers: { "X-Codeman-Run": "run-b" },
    });
    console.log(
      `  done in ${Number(job.finishedAt) - Number(job.submittedAt)} ms; content ` +
        `${content.headers.get("content-type")}, ${bytes.length} bytes, from ${OUTPUTS}/${job.id}.png`,
    );
    check(submitted.status === 202 && submitted.ms < 1000, "submit answers at once with an id");
    check(bytes.subarray(1, 4).toString() === "PNG", "the content is a PNG served from its file");
    check(other.status === 404, "another run cannot read it");
    await one.stop();
  },

  /** 8. Per-service failure: a generator that cannot load fails alone. */
  async failure() {
    const { supervisor: one, url } = await supervisor({
      services: specs({ generator: { model: "/data/models/missing" } }),
    });
    const submitted = await submit(url, "run-a");
    const job = await poll(url, "run-a", String(submitted.job.id));
    const answer = await chat(url, "run-a", "primary");
    const again = await submit(url, "run-a");
    console.log(`  generation: ${job.status}: ${String(job.error).slice(0, 160)}`);
    console.log(
      `  then: ${states(one)}; primary chat ${answer.status}; a new submit ${again.status}`,
    );
    check(
      one.service("generator").state === "failed" && answer.status === 200 && again.status === 503,
      "only the generator is failed; the primary keeps serving",
    );
    await one.stop();
  },

  /** 9. Occupancy: per run, the seconds each service was busy for it. */
  async occupancy() {
    const { supervisor: one, url } = await supervisor();
    await chat(url, "run-a", "primary", { maxTokens: 64 });
    const { job } = await submit(url, "run-a", { steps: 20, size: 128 });
    await Promise.all([
      poll(url, "run-a", String(job.id)),
      chat(url, "run-b", "subagent", { stream: true, maxTokens: 64 }),
      chat(url, "run-b", "primary", { maxTokens: 32 }),
    ]);
    const report = await (await fetch(`${url}/admin/occupancy`)).json();
    console.log(`  ${JSON.stringify(report, null, 2).replaceAll("\n", "\n  ")}`);
    const a = (report as Record<string, Record<string, { busySeconds: number }>>)["run-a"];
    check(
      a?.primary !== undefined && a.generator !== undefined && a.generator.busySeconds > 0,
      "each run's busy seconds per service are measured",
    );
    await one.stop();
  },
};

const asked = process.argv.slice(2);
const names = asked.includes("all") || asked.length === 0 ? Object.keys(scenarios) : asked;
for (const name of names) {
  const scenario = scenarios[name];
  if (!scenario) throw new Error(`No scenario ${name}.`);
  console.log(`\n== ${name}`);
  const started = Date.now();
  await scenario();
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
