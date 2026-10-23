import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { RunIdentity } from "../../fakes/google/oidc.ts";
import { docker, dockerOk } from "../docker.ts";
import type { Dispatched, GitHubPort } from "../simulator/github.ts";
import {
  type JobResult,
  type RunConclusion,
  type RunRequest,
  type RunResult,
  SimRun,
  type SimulatorEvents,
} from "../simulator/simulator.ts";
import { loadWorkflow, type Permissions, type Workflow } from "../simulator/workflow.ts";
import { cacheProblems, pinnedActions } from "./cache.ts";
import {
  ACT_STATE,
  type ActCommand,
  ActRefused,
  type ActState,
  actCommand,
  actVersion,
  valuesFile,
} from "./driver.ts";
import { type ActJob, parseActLog } from "./log.ts";

/**
 * Runs Codeman's real templates under act 0.2.89, for the smoke scenarios (step 6.1 of
 * docs/plans/2026-10-20-end-to-end-test-suite.md). It takes the simulator's place for a scenario
 * with `runner: act`: an event, a schedule or a dispatch the fake GitHub recorded becomes one
 * `act <event>` invocation, with the event's payload, on the repository's workflow files at the
 * run's commit. Invocations run one at a time, so per repository too: act ignores `concurrency`,
 * and every invocation shares act's `act-toolcache` volume.
 *
 * Each invocation is one run on the fake GitHub, which gives it its run ID, a `GITHUB_TOKEN`, a
 * runtime token for the artifact API it serves (act's own artifact server is not started), and an
 * OIDC request token with the run's claims. act gives every job of the invocation the same token,
 * since it ignores `permissions`: the token has the union of the jobs' permissions.
 */

/** act's tool cache volume, mounted on `/opt/hostedtoolcache` in every job (`GetBindsAndMounts`). */
export const TOOLCACHE_VOLUME = "act-toolcache";
/** The label of the tool cache volume the runtime made, and may therefore remove. */
const TOOLCACHE_LABEL = "codeman-e2e.act=toolcache";
/** What the templates' `${{ runner.temp }}` is under act, whatever `RUNNER_TEMP` says (spike 0.2, 6b). */
const RUNNER_TEMP = "/tmp";
/** Where the job image's entry point would install the session's CA from (e2e/infra/images/runner/). */
const CA_DIR = "/etc/codeman-e2e";

export interface ActRunnerOptions {
  github: GitHubPort;
  /** The fake OIDC issuer: its token URL as jobs reach it, and its registration. */
  oidc: { requestUrl: string; register(identity: RunIdentity): string | Promise<string> };
  secrets(repository: string): Record<string, string>;
  vars(repository: string): Record<string, string>;
  /** act's binary. */
  act: string;
  image: string;
  network: string;
  /** The volume of the session's CA, mounted on `/etc/codeman-e2e`. */
  caVolume: string;
  /** Every job's machine environment, such as `CODEMAN_E2E_ENDPOINTS` and `GH_HOST`. */
  env: Record<string, string>;
  /** Labels on each job container, so a scenario's end removes them. */
  labels: Record<string, string>;
  /** A job's memory limit, such as `3g`. */
  memory?: string;
  /** Where each invocation's own directory goes; its working directory is an empty one in it. */
  workdir: string;
  dockerHost: string;
  state?: ActState & { actions: string };
  events?: SimulatorEvents;
  /**
   * What runs once before the first invocation, and before each: by default, the check of act's
   * version, then a new `act-toolcache` volume. Tests replace it.
   */
  prepare?: { once(): Promise<void>; each(): Promise<void> };
  /** Runs act; tests replace it. */
  spawnAct?: (command: ActCommand, signal: AbortSignal) => Promise<ActOutcome>;
}

export interface ActOutcome {
  exitCode: number;
  /** act's output, one JSON object per line (`--json`). */
  output: string;
}

export class ActRunner {
  readonly runs: SimRun[] = [];
  readonly #options: ActRunnerOptions;
  /** The invocations, one after the other. */
  #chain: Promise<unknown> = Promise.resolve();
  #checked: Promise<void> | undefined;

  constructor(options: ActRunnerOptions) {
    this.#options = options;
  }

  /**
   * The runs an event starts: one per workflow of the default branch (a pull request's head for
   * its events) whose `on:` matches, as the simulator decides it. `workflow_dispatch` comes
   * through `dispatched`, with the run the fake made.
   */
  async trigger(event: {
    name: string;
    repository: string;
    payload: Record<string, unknown>;
    triggers?: boolean;
  }): Promise<SimRun[]> {
    if (event.triggers === false || event.name === "workflow_dispatch") return [];
    const { github } = this.#options;
    const repository = github.repository(event.repository);
    const pull = event.payload.pull_request as
      | { number?: number; head?: { sha?: string } }
      | undefined;
    let ref = `refs/heads/${repository.defaultBranch}`;
    let sha = await github.resolve(repository.fullName, repository.defaultBranch);
    if (event.name.startsWith("pull_request") && pull?.number) {
      ref = `refs/pull/${pull.number}/merge`;
      sha = pull.head?.sha ?? sha;
    }
    if (!sha) throw new Error(`${repository.fullName} has no commit to run workflows from.`);
    const started: SimRun[] = [];
    for (const path of await github.workflowFiles(repository.fullName, sha)) {
      const text = await github.readFile(repository.fullName, sha, path);
      if (text === undefined) continue;
      const trigger = loadWorkflow(text, path).on.get(event.name);
      if (!trigger) continue;
      const action = event.payload.action;
      const types =
        trigger.types ??
        (event.name === "pull_request" || event.name === "pull_request_target"
          ? ["opened", "synchronize", "reopened"]
          : undefined);
      if (types && typeof action === "string" && !types.includes(action)) continue;
      const sender = (event.payload.sender as { login?: string } | undefined)?.login;
      started.push(
        await this.start({
          repository: repository.fullName,
          workflow: path,
          event: event.name,
          payload: event.payload,
          ref,
          sha,
          ...(sender ? { actor: sender } : {}),
        }),
      );
    }
    return started;
  }

  /** Runs each workflow of the default branch that has a `schedule`. */
  async schedule(repository: string): Promise<SimRun[]> {
    const { github } = this.#options;
    const info = github.repository(repository);
    const sha = await github.resolve(info.fullName, info.defaultBranch);
    if (!sha) throw new Error(`${info.fullName} has no commit to run workflows from.`);
    const started: SimRun[] = [];
    for (const path of await github.workflowFiles(info.fullName, sha)) {
      const text = await github.readFile(info.fullName, sha, path);
      const crons = text === undefined ? undefined : loadWorkflow(text, path).on.get("schedule");
      if (!crons?.crons?.length) continue;
      started.push(
        await this.start({
          repository: info.fullName,
          workflow: path,
          event: "schedule",
          payload: { schedule: crons.crons[0] },
          sha,
        }),
      );
    }
    return started;
  }

  /** Runs a dispatch's queued run, as `act workflow_dispatch` with the dispatch's inputs. */
  dispatched(dispatch: Dispatched): Promise<SimRun> {
    const ref = dispatch.ref.startsWith("refs/") ? dispatch.ref : `refs/heads/${dispatch.ref}`;
    return this.start({
      repository: dispatch.repository,
      workflow: dispatch.workflow,
      event: "workflow_dispatch",
      ref,
      ...(dispatch.headSha ? { sha: dispatch.headSha } : {}),
      inputs: dispatch.inputs,
      actor: dispatch.sender,
      runId: dispatch.runId,
      payload: {
        inputs: dispatch.inputs,
        ref,
        workflow: dispatch.workflow,
        sender: { login: dispatch.sender },
      },
    });
  }

  /** Queues one invocation; it starts once the ones before it ended. */
  async start(request: RunRequest): Promise<SimRun> {
    const { github } = this.#options;
    const repository = github.repository(request.repository);
    const ref = request.ref ?? `refs/heads/${repository.defaultBranch}`;
    const sha =
      request.sha ?? (await github.resolve(repository.fullName, ref.replace(/^refs\/heads\//, "")));
    if (!sha) throw new Error(`${ref} of ${repository.fullName} resolves to no commit.`);
    const workflows: Record<string, string> = {};
    for (const path of await github.workflowFiles(repository.fullName, sha)) {
      const text = await github.readFile(repository.fullName, sha, path);
      if (text !== undefined) workflows[path] = text;
    }
    const text = workflows[request.workflow];
    if (text === undefined)
      throw new Error(`No ${request.workflow} in ${repository.fullName} at ${sha}.`);
    const workflow = loadWorkflow(text, request.workflow);
    const refName = ref.replace(/^refs\/(heads|tags)\//, "");
    const record = await (request.runId
      ? github.existingRun(request.runId)
      : github.startRun({
          repository: repository.fullName,
          workflow: request.workflow,
          name: workflow.name ?? request.workflow,
          event: request.event,
          headBranch: refName,
          headSha: sha,
          ...(request.actor ? { actor: request.actor } : {}),
          ...(request.inputs ? { inputs: request.inputs } : {}),
        }));
    const run = new SimRun(record.id, { ...request, sha, ref }, workflow);
    run.github = {
      run_id: String(record.id),
      run_number: String(record.runNumber),
      run_attempt: String(record.runAttempt),
    };
    this.runs.push(run);
    this.#options.events?.runQueued?.(run);
    const invocation = this.#chain.then(() =>
      this.#invoke(run, { workflows, sha, ref, record }).then(
        (result) => run.settle(result),
        (error: unknown) => {
          github.updateRun(run.id, { status: "completed", conclusion: "failure" });
          run.settle(error instanceof Error ? error : new Error(String(error)));
        },
      ),
    );
    this.#chain = invocation;
    return run;
  }

  /** One `act` invocation for a run, from its files to its conclusion on the fake. */
  async #invoke(
    run: SimRun,
    context: {
      workflows: Record<string, string>;
      sha: string;
      ref: string;
      record: { id: number; runNumber: number; runAttempt: number };
    },
  ): Promise<RunResult> {
    const options = this.#options;
    const { github } = options;
    const state = options.state ?? ACT_STATE;
    const request = run.request;
    const repository = github.repository(request.repository);
    if (run.cancelled) return this.#finish(run, "cancelled", []);

    const prepare = options.prepare ?? {
      once: () => actVersion(options.act).then(() => undefined),
      each: freshToolCache,
    };
    this.#checked ??= prepare.once();
    await this.#checked;
    // Every action the workflows pin must be in the cache, or act would clone it with the token.
    const problems = await cacheProblems(
      state.actions,
      pinnedActions(context.workflows),
      github.urls.server,
    );
    if (problems.length > 0) {
      throw new ActRefused(
        `act does not start: its action cache lacks pinned actions (${problems.join("; ")}). Fill it once with \`node e2e/runtime/act/fill-cache.ts\`.`,
      );
    }
    await prepare.each();

    github.updateRun(run.id, { status: "in_progress" });
    options.events?.runStarted?.(run);
    const job = await github.startJob(run.id, "act");
    const permissions = unionPermissions(run.workflow, context.workflows);
    const token = await github.jobToken(repository.fullName, restNames(permissions), run.id, "act");
    const requestToken = await options.oidc.register({
      repository: repository.fullName,
      repositoryId: String(repository.id),
      ownerId: String(repository.ownerId),
      runId: String(run.id),
      runAttempt: String(context.record.runAttempt),
      workflowFile: posix.basename(request.workflow),
      workflow: run.workflow.name ?? request.workflow,
      ref: context.ref,
      // act runs a called workflow's jobs with the caller's identity: one token per invocation.
      jobWorkflowFile: posix.basename(request.workflow),
      eventName: request.event,
    });

    mkdirSync(options.workdir, { recursive: true });
    const dir = mkdtempSync(join(options.workdir, `act-${run.id}-`));
    const workdir = join(dir, "run");
    const files = {
      event: join(dir, "event.json"),
      env: join(dir, "env.yaml"),
      secrets: join(dir, "secrets.yaml"),
      vars: join(dir, "vars.yaml"),
    };
    for (const [path, text] of Object.entries(context.workflows)) {
      mkdirSync(dirname(join(workdir, path)), { recursive: true });
      writeFileSync(join(workdir, path), text);
    }
    const payload = { ...request.payload, ...repository.payload };
    writeFileSync(files.event, `${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(
      files.env,
      valuesFile({
        ACTIONS_RUNTIME_TOKEN: job.runtimeToken,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken,
        // gh takes its token from GH_ENTERPRISE_TOKEN for a host other than github.com; under act
        // every step's `github.token` is this one.
        GH_ENTERPRISE_TOKEN: token,
      }),
      { mode: 0o600 },
    );
    writeFileSync(files.secrets, valuesFile(options.secrets(repository.fullName)), { mode: 0o600 });
    writeFileSync(files.vars, valuesFile(options.vars(repository.fullName)), { mode: 0o600 });
    for (const path of Object.values(state)) mkdirSync(path, { recursive: true });

    const command = actCommand({
      act: options.act,
      workdir,
      workflow: request.workflow,
      event: request.event,
      files,
      token,
      env: {
        ...options.env,
        GITHUB_SERVER_URL: github.urls.server,
        GITHUB_API_URL: github.urls.api,
        GITHUB_GRAPHQL_URL: github.urls.graphql,
        // The fake GitHub's artifact API, with this invocation's runtime token (decision 10).
        ACTIONS_RESULTS_URL: github.urls.results,
        ACTIONS_RUNTIME_URL: github.urls.results,
        ACTIONS_ID_TOKEN_REQUEST_URL: options.oidc.requestUrl,
        GITHUB_RUN_ID: String(run.id),
        GITHUB_RUN_ATTEMPT: String(context.record.runAttempt),
        GITHUB_RUN_NUMBER: String(context.record.runNumber),
        GITHUB_REPOSITORY: repository.fullName,
        GITHUB_REPOSITORY_OWNER: repository.owner,
        GITHUB_REPOSITORY_ID: String(repository.id),
        GITHUB_REPOSITORY_OWNER_ID: String(repository.ownerId),
        GITHUB_REF: context.ref,
        // act's own name for `github.sha` (`getGithubContext`); it would read git otherwise.
        SHA_REF: context.sha,
        RUNNER_TEMP,
        // act replaces the image's entry point, which adds the CA to the system store: git and gh
        // trust it through these instead. Node has NODE_EXTRA_CA_CERTS from the image.
        GIT_SSL_CAINFO: `${CA_DIR}/ca.crt`,
        SSL_CERT_DIR: CA_DIR,
      },
      actor: request.actor ?? "github-actions[bot]",
      defaultBranch: repository.defaultBranch,
      image: options.image,
      network: options.network,
      containerOptions: [
        "--volume",
        `${options.caVolume}:${CA_DIR}:ro`,
        ...(options.memory ? ["--memory", options.memory, "--memory-swap", options.memory] : []),
        ...Object.entries(options.labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
      ],
      actionCache: state.actions,
      state,
      dockerHost: options.dockerHost,
    });

    let outcome: ActOutcome;
    try {
      outcome = await (options.spawnAct ?? runAct)(command, run.controller.signal);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const parsed = parseActLog(outcome.output);
    const jobs = parsed.jobs.map((one) => jobResult(run, one, permissions));
    const { conclusion, error } = actConclusion({
      exitCode: outcome.exitCode,
      cancelled: run.cancelled,
      results: jobs.map((one) => one.result),
      errors: parsed.errors,
    });
    github.finishJob(job.id, conclusion === "skipped" ? "skipped" : conclusion, parsed.text);
    jobs.push({
      runId: run.id,
      id: "act",
      name: "act",
      workflow: request.workflow,
      result: conclusion === "startup_failure" ? "failure" : conclusion,
      outputs: {},
      steps: [],
      log: `act ${shownArgv(command.argv).join(" ")}\nexit code ${outcome.exitCode}\n\n${parsed.unattributed}`,
      permissions,
      env: {},
    });
    for (const one of jobs) options.events?.jobCompleted?.(one);
    return this.#finish(run, conclusion, jobs, error);
  }

  #finish(run: SimRun, conclusion: RunConclusion, jobs: JobResult[], error?: string): RunResult {
    run.jobs.push(...jobs);
    this.#options.github.updateRun(run.id, { status: "completed", conclusion });
    const result: RunResult = {
      id: run.id,
      repository: run.request.repository,
      workflow: run.request.workflow,
      event: run.request.event,
      conclusion,
      jobs: run.jobs,
      graph: {},
      ...(error ? { error } : {}),
    };
    this.#options.events?.runCompleted?.(result);
    return result;
  }
}

/**
 * act's matrix limit: it evaluates a job's `strategy.matrix` before the job's `if:`, so a
 * `fromJSON` of an output a skipped or idle `select` did not set stops act, with exit code 1,
 * when it plans that job's stage (`NewPlanExecutor` in `pkg/runner/runner.go`). On GitHub the
 * job is skipped and its matrix never read.
 */
const MATRIX_LIMIT = /Error while evaluating matrix|Failed to decode node/;

/**
 * A run's conclusion as GitHub would give it, from act's exit code, the jobs that logged a result
 * and act's own errors, which stay in `error`. A run where no job ran is skipped, as on GitHub,
 * when act stopped only at its matrix limit; with any other error it failed to start.
 */
export function actConclusion(outcome: {
  exitCode: number;
  cancelled: boolean;
  results: readonly JobResult["result"][];
  errors: readonly string[];
}): { conclusion: RunConclusion; error?: string } {
  const error =
    outcome.exitCode !== 0 || outcome.errors.length > 0
      ? `act exited with ${outcome.exitCode}${outcome.errors.length > 0 ? `: ${outcome.errors.join(" ")}` : ""}`
      : undefined;
  const withError = (conclusion: RunConclusion) => ({ conclusion, ...(error ? { error } : {}) });
  if (outcome.cancelled) return withError("cancelled");
  const ran = outcome.results.filter((result) => result !== "skipped");
  if (ran.length === 0) {
    const onlyMatrix =
      outcome.exitCode === 0 ||
      (outcome.errors.length > 0 && outcome.errors.every((line) => MATRIX_LIMIT.test(line)));
    return withError(onlyMatrix ? "skipped" : "startup_failure");
  }
  if (ran.includes("failure") || outcome.exitCode !== 0) return withError("failure");
  if (ran.includes("cancelled")) return withError("cancelled");
  return withError("success");
}

function jobResult(run: SimRun, job: ActJob, permissions: Permissions): JobResult {
  return {
    runId: run.id,
    id: job.id,
    name: job.name,
    workflow: run.request.workflow,
    result: job.result,
    outputs: {},
    steps: [],
    log: job.log,
    permissions,
    env: {},
  };
}

/**
 * The permissions of every job act may run, the called workflows' included: act gives them all the
 * one `GITHUB_TOKEN`. `id-token` is the OIDC request token's, not the token's.
 */
export function unionPermissions(root: Workflow, files: Record<string, string>): Permissions {
  const union: Permissions = {};
  const seen = new Set<string>();
  const visit = (workflow: Workflow) => {
    if (seen.has(workflow.file)) return;
    seen.add(workflow.file);
    for (const job of workflow.jobs.values()) {
      for (const [name, level] of Object.entries(job.permissions ?? workflow.permissions ?? {})) {
        if (name === "id-token") continue;
        if (union[name] !== "write") union[name] = level;
      }
      const called = job.uses?.startsWith("./") ? posix.normalize(job.uses.slice(2)) : undefined;
      const text = called ? files[called] : undefined;
      if (called && text !== undefined) visit(loadWorkflow(text, called));
    }
  };
  visit(root);
  return union;
}

/** act's arguments for a log, with the token's value masked. */
export function shownArgv(argv: readonly string[]): string[] {
  return argv.map((arg) => arg.replace(/^GITHUB_TOKEN=.*/, "GITHUB_TOKEN=***"));
}

/** Permission names as tokens hold them (`pull_requests`). */
function restNames(permissions: Permissions): Record<string, "read" | "write"> {
  return Object.fromEntries(
    Object.entries(permissions).map(([name, level]) => [name.replaceAll("-", "_"), level]),
  );
}

/**
 * A new `act-toolcache` volume for each invocation, which Docker fills from the job image when
 * act first mounts it: the volume is shared and world-writable, so a job of an earlier invocation
 * could have left anything there. Only a volume the runtime made is removed; another is the
 * developer's, and the runtime stops.
 */
async function freshToolCache(): Promise<void> {
  const found = await docker([
    "volume",
    "inspect",
    "--format",
    "{{json .Labels}}",
    TOOLCACHE_VOLUME,
  ]);
  if (found.exitCode === 0) {
    const labels = (JSON.parse(found.stdout.trim() || "null") ?? {}) as Record<string, string>;
    const [key, value] = TOOLCACHE_LABEL.split("=");
    if (labels[key ?? ""] !== value) {
      throw new ActRefused(
        `act does not start: the Docker volume ${TOOLCACHE_VOLUME} exists and the e2e runtime did not make it. act mounts it on /opt/hostedtoolcache in every job, where it would hide the job image's Node. Remove it with \`docker volume rm ${TOOLCACHE_VOLUME}\` if nothing of yours needs it.`,
      );
    }
    await dockerOk(["volume", "rm", TOOLCACHE_VOLUME]);
  }
  await dockerOk(["volume", "create", "--label", TOOLCACHE_LABEL, TOOLCACHE_VOLUME]);
}

/** Removes the tool cache volume the runtime made, if it is there. */
export async function removeToolCache(): Promise<void> {
  const found = await docker([
    "volume",
    "inspect",
    "--format",
    "{{json .Labels}}",
    TOOLCACHE_VOLUME,
  ]);
  if (found.exitCode !== 0) return;
  const labels = (JSON.parse(found.stdout.trim() || "null") ?? {}) as Record<string, string>;
  if (labels["codeman-e2e.act"] === "toolcache") await docker(["volume", "rm", TOOLCACHE_VOLUME]);
}

/** Runs act, with nothing of the runtime's environment; a cancelled run stops it. */
export function runAct(command: ActCommand, signal: AbortSignal): Promise<ActOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.binary, command.argv, {
      cwd: command.cwd,
      env: command.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    let killer: NodeJS.Timeout | undefined;
    const stop = () => {
      child.kill("SIGINT");
      killer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    };
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(killer);
      signal.removeEventListener("abort", stop);
      resolve({ exitCode: code ?? 1, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}
