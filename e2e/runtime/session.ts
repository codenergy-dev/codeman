import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Firestore } from "../../src/store/firestore.ts";
import { Compose, network } from "./compose.ts";
import { docker, dockerOk, imageExists, removeLabeled } from "./docker.ts";
import { DockerExecutor, JOB_ROOT } from "./executor.ts";
import { fakeList } from "./expect.ts";
import { bundleEndpoints, FAKE_NAMES, FakeClient, type Fakes, INTERNAL } from "./fakes.ts";
import { FaultingExecutor, type JobFault } from "./faults.ts";
import { RemoteGitHub } from "./github.ts";
import { allowlistPlan, Launcher, podRunner } from "./launcher.ts";
import { type ReportData, Timeline, writePass, writeReport } from "./report.ts";
import { ScenarioFailure, ScenarioRun } from "./run.ts";
import type { Profile, Scenario } from "./scenario/schema.ts";
import { Simulator } from "./simulator/simulator.ts";
import { buildWorld, OIDC_REQUEST_URL } from "./world.ts";

/**
 * One `npm run test:e2e`: Compose up with the profiles the scenarios need, the fakes' clients,
 * the pod launcher, and each scenario run on a fresh state, one at a time. Every container a
 * scenario starts, jobs and pods, carries the session's and the scenario's labels, and goes when
 * the scenario ends, whatever its result.
 */

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const OUT = join(ROOT, "e2e", ".out");
export const BUILD = join(ROOT, "e2e", ".build");
const COMPOSE_FILE = join(ROOT, "e2e", "infra", "compose.yaml");
const RUNNER_IMAGE = "codeman-e2e-runner:local";
const POD_IMAGES: Record<Profile, { service: string; image: string }> = {
  ollama: { service: "pod-ollama", image: "codeman-e2e-pod-ollama:local" },
  vllm: { service: "pod-vllm", image: "codeman-e2e-pod-vllm:local" },
};
const JOBS_NETWORK = "codeman-e2e-jobs";
const SESSION_LABEL = "codeman-e2e.session";
const SCENARIO_LABEL = "codeman-e2e.scenario";

export interface ScenarioResult {
  scenario: Scenario;
  passed: boolean;
  durationMs: number;
  /** The failure's message, with the timeline's tail and the report's path. */
  message?: string;
}

/** The tokens and the launcher's port, kept between sessions so Compose can reuse its services. */
interface Secrets {
  controlToken: string;
  launcherToken: string;
  launcherPort: number;
}

function sessionSecrets(): Secrets {
  const file = join(OUT, "session.json");
  try {
    const known = JSON.parse(readFileSync(file, "utf8")) as Secrets;
    if (known.controlToken && known.launcherToken && known.launcherPort) return known;
  } catch {
    // A new session's.
  }
  const secrets: Secrets = {
    controlToken: randomBytes(24).toString("base64url"),
    launcherToken: randomBytes(24).toString("base64url"),
    launcherPort: 47_000 + Math.floor(Math.random() * 1000),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(file, `${JSON.stringify(secrets)}\n`, { mode: 0o600 });
  return secrets;
}

interface Current {
  session: string;
  scenario: string;
  timeline?: Timeline | undefined;
}

export class Session {
  readonly compose: Compose;
  readonly fakes: Fakes;
  readonly github: RemoteGitHub;
  readonly launcher: Launcher;
  readonly #secrets: Secrets;
  /** The scenario running now, which the launcher labels its pods with and logs to. */
  readonly #current: Current;

  private constructor(
    compose: Compose,
    fakes: Fakes,
    github: RemoteGitHub,
    launcher: Launcher,
    secrets: Secrets,
    current: Current,
  ) {
    this.compose = compose;
    this.fakes = fakes;
    this.github = github;
    this.launcher = launcher;
    this.#secrets = secrets;
    this.#current = current;
  }

  static async open(options: {
    profiles: Profile[];
    build: boolean;
    log(text: string): void;
  }): Promise<Session> {
    const secrets = sessionSecrets();
    const compose = new Compose(COMPOSE_FILE, {
      CODEMAN_E2E_CONTROL_TOKEN: secrets.controlToken,
      CODEMAN_E2E_LAUNCHER: `http://host.docker.internal:${secrets.launcherPort}`,
      CODEMAN_E2E_LAUNCHER_TOKEN: secrets.launcherToken,
    });
    const images = [
      { service: "runner", image: RUNNER_IMAGE },
      ...options.profiles.map((profile) => POD_IMAGES[profile]),
    ];
    // The pod images hold the e2e bundle's gateway (decision 11): built again each session, from
    // the cache when nothing changed. The job image only when missing.
    const missing: string[] = [];
    for (const { service, image } of images) {
      if ((options.build && service !== "runner") || !(await imageExists(image)))
        missing.push(service);
    }
    if (missing.length > 0) {
      options.log(`Building the images of ${missing.join(", ")}.`);
      await compose.buildImages(missing);
    }
    options.log("Starting the e2e services with Compose.");
    await compose.up(options.profiles, { build: options.build });

    mkdirSync(OUT, { recursive: true });
    const caFile = join(OUT, "ca.crt");
    const ca = await dockerOk([
      "run",
      "--rm",
      "--network",
      "none",
      "--volume",
      "codeman-e2e-ca:/ca:ro",
      "--entrypoint",
      "cat",
      "codeman-e2e-fakes:local",
      "/ca/ca.crt",
    ]);
    writeFileSync(caFile, ca);
    const client = async (name: string, port: number, https = false) =>
      new FakeClient(name, `${https ? "https" : "http"}://${await compose.port(name, port)}`, {
        token: secrets.controlToken,
        ...(https ? { ca } : {}),
      });
    const fakes: Fakes = {
      github: await client("github", 443, true),
      google: await client("google", 8080),
      llm: await client("llm", 8080),
      openrouter: await client("openrouter", 8080),
      runpod: await client("runpod", 8080),
      npm: await client("npm", 8080),
      firestore: `http://${await compose.port("firestore", 8080)}`,
    };
    const github = new RemoteGitHub(fakes.github, { server: INTERNAL.github, caFile });
    const current: Current = { session: randomBytes(4).toString("hex"), scenario: "" };
    const launcher = new Launcher({
      token: secrets.launcherToken,
      plan: (spec) =>
        allowlistPlan(spec, { model: INTERNAL.llm, controlToken: secrets.controlToken }),
      labels: () => ({ [SESSION_LABEL]: current.session, [SCENARIO_LABEL]: current.scenario }),
      run: podRunner(JOBS_NETWORK),
      events: (event) => current.timeline?.add("pod", `${event.kind} ${event.id}: ${event.detail}`),
    });
    await launcher.listen(
      secrets.launcherPort,
      process.env.CODEMAN_E2E_LAUNCHER_HOST ?? "127.0.0.1",
    );
    return new Session(compose, fakes, github, launcher, secrets, current);
  }

  get id(): string {
    return this.#current.session;
  }

  async close(options: { down?: boolean } = {}): Promise<void> {
    await this.launcher.close();
    await removeLabeled(`${SESSION_LABEL}=${this.id}`);
    if (options.down) await this.compose.down();
  }

  async runScenario(scenario: Scenario): Promise<ScenarioResult> {
    const started = Date.now();
    const slug = scenario.id.replace(/[^A-Za-z0-9._-]+/g, "-");
    const timeline = new Timeline();
    this.#current.scenario = slug;
    this.#current.timeline = timeline;
    const dir = join(OUT, ...scenario.id.split("/"));
    const workdir = join(dir, "work");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(workdir, { recursive: true });

    // A fresh state: every fake reset, a new Firestore project, no container of before.
    await removeLabeled(`${SESSION_LABEL}=${this.id}`);
    for (const name of FAKE_NAMES) await this.fakes[name].reset();
    this.github.forget();
    this.launcher.forget();

    let simulator: Simulator | undefined;
    let run: ScenarioRun | undefined;
    let store: Firestore | undefined;
    try {
      const world = await buildWorld(scenario, this.github, this.fakes);
      timeline.add(
        "world",
        `Firestore project ${world.project}; Codeman at ${world.codemanSha.slice(0, 7)}`,
      );
      store = new Firestore({
        project: world.project,
        baseUrl: this.fakes.firestore,
        token: async () => "owner",
      });
      await this.#fresh(scenario, store);
      const jobFaults: JobFault[] = [];
      const executor = new FaultingExecutor(
        new DockerExecutor({
          image: RUNNER_IMAGE,
          network: JOBS_NETWORK,
          caVolume: "codeman-e2e-ca",
          bundle: {
            dir: BUILD,
            rules: join(ROOT, "AGENTS.md"),
            tools: join(ROOT, "docs", "web", "tools"),
          },
          env: {
            CODEMAN_E2E_ENDPOINTS: JSON.stringify(bundleEndpoints()),
            GH_HOST: new URL(INTERNAL.github).host,
          },
          labels: { [SESSION_LABEL]: this.id, [SCENARIO_LABEL]: slug },
          memory: "3g",
          started: (job, container) => timeline.add("job", `start ${job.name} in ${container}`),
        }),
        jobFaults,
        JOB_ROOT,
      );
      simulator = new Simulator({
        github: this.github,
        executor,
        secrets: (repository) => world.secrets(repository),
        vars: (repository) => world.vars(repository),
        oidc: {
          requestUrl: OIDC_REQUEST_URL,
          register: async (identity) =>
            (await this.fakes.google.json<{ token: string }>("POST", "/google/runs", identity))
              .token,
        },
        bundle: { entry: join(BUILD, "index.js"), actionYml: join(ROOT, "action.yml") },
        workdir,
        events: {
          runQueued: (queued) =>
            timeline.add(
              "run",
              `queued ${queued.id} ${queued.request.event} (${queued.request.workflow})`,
            ),
          runCompleted: (result) =>
            timeline.add(
              "run",
              `completed ${result.id} ${result.event}: ${result.conclusion}${result.error ? ` (${result.error})` : ""}`,
            ),
          jobCompleted: (job) =>
            timeline.add("job", `${job.name}: ${job.result}${job.error ? ` (${job.error})` : ""}`),
        },
      });
      const context = {
        scenario,
        github: this.github,
        fakes: this.fakes,
        store,
        simulator,
        world,
        timeline,
        jobFaults,
        infrastructure: { firestore: (down: boolean) => this.#firestore(down) },
        engine: (id: string) => this.#engine(id),
      };
      run = new ScenarioRun(context);
      const current = run;
      await withTimeout(
        (async () => {
          await current.runAll(scenario.actions);
          await current.finish();
        })(),
        scenario.timeoutMs,
        () => {
          for (const one of simulator?.runs ?? []) one.cancel();
          return new ScenarioFailure(
            `The scenario ran out of its ${scenario.timeoutMs / 60_000} minutes.`,
          );
        },
      );
      timeline.add("pass", scenario.id);
      rmSync(workdir, { recursive: true, force: true });
      writePass(dir, timeline, jobLogs(simulator));
      return { scenario, passed: true, durationMs: Date.now() - started };
    } catch (error) {
      const text =
        error instanceof ScenarioFailure ? error.message : `${(error as Error)?.stack ?? error}`;
      timeline.add("fail", text.split("\n")[0] ?? "");
      const message = writeReport(
        dir,
        await this.#collect(scenario, text, timeline, simulator, store),
        ROOT,
      );
      return { scenario, passed: false, durationMs: Date.now() - started, message };
    } finally {
      await this.#firestore(false).catch(() => undefined);
      await removeLabeled(`${SCENARIO_LABEL}=${slug}`);
      this.launcher.forget();
      this.#current.timeline = undefined;
    }
  }

  /**
   * Checks the scenario starts from nothing of an earlier one: no document in its store, no pod
   * on the fake Runpod, no container of the session, and no event, dispatch or violation on the
   * fake GitHub but its new world's. The repositories are new: the fake refuses one that exists.
   */
  async #fresh(scenario: Scenario, store: Firestore): Promise<void> {
    const left: string[] = [];
    for (const owner of new Set(
      scenario.world.repositories.map((one) => one.owner.toLowerCase()),
    )) {
      for (const collection of ["runs", "events", "pods"]) {
        const found = await store.query(`organizations/${owner}/${collection}`);
        if (found.length > 0)
          left.push(`${found.length} documents in organizations/${owner}/${collection}`);
      }
    }
    const pods = await this.fakes.runpod.json<{ status: string }[]>("GET", "/runpod/pods");
    if (pods.length > 0) left.push(`${pods.length} pods on the fake Runpod`);
    const containers = (
      await dockerOk(["ps", "-aq", "--filter", `label=${SESSION_LABEL}=${this.id}`])
    ).trim();
    if (containers) left.push(`containers of the session: ${containers.split("\n").join(", ")}`);
    if ((await this.github.events()).length > 0) left.push("events on the fake GitHub");
    if ((await this.github.dispatches()).length > 0) left.push("dispatches on the fake GitHub");
    if ((await this.github.violations()).length > 0) left.push("violations on the fake GitHub");
    const turns = await this.fakes.llm.json<unknown[]>("GET", "/llm/turns");
    if (turns.length > 0) left.push(`${turns.length} turns on the scripted model`);
    if (left.length > 0) {
      throw new Error(`The scenario does not start from a fresh state: ${left.join("; ")}.`);
    }
  }

  /** What the report holds; a part that cannot be read says why instead. */
  async #collect(
    scenario: Scenario,
    error: string,
    timeline: Timeline,
    simulator: Simulator | undefined,
    store: Firestore | undefined,
  ): Promise<ReportData> {
    const safely = async <T>(read: () => Promise<T>): Promise<T | { error: string }> => {
      try {
        return await read();
      } catch (caught) {
        return { error: (caught as Error).message };
      }
    };
    const jobs = jobLogs(simulator);
    const fakes: ReportData["fakes"] = {};
    const lists: Record<string, string[]> = {
      github: ["events", "dispatches", "violations", "requests"],
      openrouter: ["keys", "generations", "requests"],
      runpod: ["pods", "jobs", "requests"],
      google: ["requests"],
      llm: ["turns", "violations", "requests"],
      npm: ["requests"],
    };
    for (const [fake, names] of Object.entries(lists)) {
      fakes[fake] = {};
      for (const name of names) {
        (fakes[fake] as Record<string, unknown>)[name] = await safely(() =>
          fakeList(this.fakes, fake, name),
        );
      }
    }
    const documents: Record<string, unknown> = {};
    if (store) {
      const owners = new Set(
        scenario.world.repositories.map((repository) => repository.owner.toLowerCase()),
      );
      for (const owner of owners) {
        for (const collection of ["runs", "events", "pods"]) {
          const path = `organizations/${owner}/${collection}`;
          const found = await safely(() => store.query(path));
          if (Array.isArray(found))
            for (const document of found) documents[document.path] = document.fields;
          else documents[path] = found;
        }
        const organization = await safely(() => store.get(`organizations/${owner}`));
        if (organization) documents[`organizations/${owner}`] = organization;
      }
      for (const collection of ["contexts"]) {
        const found = await safely(() => store.query(collection));
        if (Array.isArray(found))
          for (const document of found) documents[document.path] = document.fields;
      }
    }
    const engine: Record<string, unknown> = {};
    for (const [id, container] of this.launcher.pods) {
      engine[id] = {
        container,
        status: await safely(() => this.#engine(id)),
        logs: await safely(async () => {
          const logs = await docker(["logs", "--tail", "300", container]);
          return `${logs.stdout}${logs.stderr}`;
        }),
      };
    }
    const violations = {
      github: await safely(() => this.github.violations()),
      llm: await safely(() => this.fakes.llm.json("GET", "/llm/violations")),
    };
    return {
      scenario: scenario.id,
      error,
      timeline,
      jobs,
      fakes,
      store: documents,
      engine,
      violations,
    };
  }

  /** Firestore's emulator off the jobs network (`down`), or back on it. */
  async #firestore(down: boolean): Promise<void> {
    const container = await this.compose.container("firestore");
    const networks = (
      await dockerOk(["inspect", "--format", "{{json .NetworkSettings.Networks}}", container])
    ).trim();
    const connected = JOBS_NETWORK in (JSON.parse(networks) as Record<string, unknown>);
    if (down && connected) await network(container, JOBS_NETWORK, false);
    if (!down && !connected) await network(container, JOBS_NETWORK, true, ["firestore"]);
  }

  /** A pod's engine, read inside its container: the gateway's health, Ollama's, vLLM's. */
  async #engine(id: string): Promise<{ gateway?: unknown; ollama?: unknown; vllm?: unknown }> {
    const container = this.launcher.pods.get(id);
    if (!container) throw new Error(`The launcher started no pod ${id}.`);
    const get = async (url: string) => {
      const script = `fetch(${JSON.stringify(url)}).then((r) => r.text()).then((t) => process.stdout.write(t), (e) => { process.stderr.write(String(e)); process.exit(1); })`;
      const result = await docker(["exec", container, "node", "-e", script], { timeoutMs: 20_000 });
      return result.exitCode === 0 ? result.stdout : undefined;
    };
    const parse = (text: string | undefined) => {
      try {
        return text === undefined ? undefined : JSON.parse(text);
      } catch {
        return undefined;
      }
    };
    const status: { gateway?: unknown; ollama?: unknown; vllm?: unknown } = {
      gateway: parse(await get("http://127.0.0.1:8080/health")),
    };
    const ps = parse(await get("http://127.0.0.1:11434/api/ps"));
    if (ps) status.ollama = ps;
    const models = parse(await get("http://127.0.0.1:8000/v1/models"));
    if (models) {
      const metrics: Record<string, number> = {};
      for (const line of (await get("http://127.0.0.1:8000/metrics"))?.split("\n") ?? []) {
        const found = /^(vllm:[A-Za-z_:]+)(?:\{[^}]*\})? ([0-9.eE+-]+)$/.exec(line);
        if (found?.[1] && found[2]) metrics[found[1]] = Number(found[2]);
      }
      const first = (models as { data?: Record<string, unknown>[] }).data?.[0] ?? {};
      status.vllm = { ...first, metrics };
    }
    return status;
  }

  /** Whether the session's secrets are those Compose's services run with. */
  get controlToken(): string {
    return this.#secrets.controlToken;
  }
}

/** Each job's log, by a file name in the order the jobs ended. */
function jobLogs(simulator: Simulator | undefined): Record<string, string> {
  const jobs: Record<string, string> = {};
  let index = 0;
  for (const run of simulator?.runs ?? []) {
    for (const job of run.jobs) {
      jobs[`${String(++index).padStart(3, "0")}-run${run.id}-${job.name}.log`] =
        `${job.name}: ${job.result}\n\n${job.log}\n`;
    }
  }
  return jobs;
}

async function withTimeout<T>(work: Promise<T>, ms: number, timedOut: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timedOut()), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the e2e bundle is there to mount. */
export function bundleBuilt(): boolean {
  return existsSync(join(BUILD, "index.js"));
}
