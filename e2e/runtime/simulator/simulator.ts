import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { GitError } from "../../fakes/github/git.ts";
import type { RunIdentity } from "../../fakes/google/oidc.ts";
import { HttpError } from "../../fakes/http.ts";
import { ACTIONS, type ActionContext, type EmulatedAction, Unsupported } from "./actions.ts";
import type { Command, CommandResult, JobExecutor, JobSession, StepInfo } from "./executor.ts";
import {
  AVAILABILITY,
  type Contexts,
  EvaluationError,
  evaluateCondition,
  evaluateValue,
  interpolate,
  type KeyKind,
  type Scope,
  type Status,
  toText,
  truthy,
} from "./expressions.ts";
import { readCommands, readStepFiles, stepFiles } from "./files.ts";
import { ActionFailure, type Dispatched, type GitHubPort } from "./github.ts";
import {
  type JobSpec,
  loadWorkflow,
  type Permissions,
  type StepSpec,
  type Workflow,
} from "./workflow.ts";

/**
 * Runs workflow files as GitHub Actions does, job by job, for the e2e suite: the job graph with
 * `needs`, `if:` and GitHub's implicit `success()` over every ancestor, matrices from `fromJSON`
 * with `include`, `fail-fast` and `max-parallel`, reusable workflows with their inputs, secrets,
 * permissions and outputs (a failed inner job fails the calling job, and the caller's `always()`
 * jobs still run), `run:` steps through a `JobExecutor`, Codeman's action as the e2e bundle, and
 * the pinned actions emulated against the fake GitHub. Runs queue per concurrency group, one
 * running and one pending, a newer pending run replacing the older. Dispatches the fake records
 * start runs; `schedule` runs on demand.
 */

export type JobResultName = "success" | "failure" | "cancelled" | "skipped";
export type RunConclusion = JobResultName | "startup_failure";

export interface StepResult {
  index: number;
  id?: string;
  name: string;
  outcome: JobResultName;
  conclusion: JobResultName;
  outputs: Record<string, string>;
}

/** One job of a run as it ended: a matrix leg, a job of a called workflow, or a skipped job. */
export interface JobResult {
  runId: number;
  /** The job's key in its file, such as `open-key`. */
  id: string;
  /** As GitHub names it, such as `task (#1) / Open key`. */
  name: string;
  /** The file the job is in. */
  workflow: string;
  result: JobResultName;
  outputs: Record<string, string>;
  matrix?: Record<string, unknown>;
  steps: StepResult[];
  log: string;
  /** The job's `GITHUB_TOKEN` permissions, with `id-token`. */
  permissions: Permissions;
  /** The environment every step of the job got, before its own `env:`. */
  env: Record<string, string>;
  /** The job's `GITHUB_TOKEN`. */
  token?: string;
  /** Why the job failed before its steps, such as a matrix with no leg. */
  error?: string;
}

export interface RunResult {
  id: number;
  repository: string;
  workflow: string;
  event: string;
  conclusion: RunConclusion;
  /** The concurrency group, if the workflow has one. */
  group?: string;
  /** Each job, leg and called workflow's job, in the order they ended. */
  jobs: JobResult[];
  /** The root workflow's jobs, as `needs` reads them. */
  graph: Record<string, { result: JobResultName; outputs: Record<string, string> }>;
  /** A startup failure's message. */
  error?: string;
}

/** Where a run's workflow files come from. */
export interface WorkflowSource {
  list(repository: string, sha: string): Promise<string[]>;
  read(repository: string, sha: string, path: string): Promise<string | undefined>;
}

/** The workflow files of the repository's commit, on the fake. */
export function repositoryWorkflows(github: GitHubPort): WorkflowSource {
  return {
    list: (repository, sha) => github.workflowFiles(repository, sha),
    read: (repository, sha, path) => github.readFile(repository, sha, path),
  };
}

/** The same files for every repository and commit, such as the templates. */
export function fixedWorkflows(files: Record<string, string>): WorkflowSource {
  return {
    list: async () => Object.keys(files).filter((path) => path.startsWith(".github/workflows/")),
    read: async (_repository, _sha, path) => files[path],
  };
}

/** What the orchestrator hears about runs and jobs. */
export interface SimulatorEvents {
  runQueued?(run: SimRun): void;
  runStarted?(run: SimRun): void;
  runCompleted?(result: RunResult): void;
  jobCompleted?(job: JobResult): void;
  /** A line of a job's log, masked. */
  log?(job: string, line: string): void;
}

export interface SimulatorOptions {
  github: GitHubPort;
  executor: JobExecutor;
  /** The repository's own files at the run's commit by default. */
  workflows?: WorkflowSource;
  /** A repository's secrets, its organization's included. */
  secrets?: (repository: string) => Record<string, string>;
  /** A repository's variables, its organization's included. */
  vars?: (repository: string) => Record<string, string>;
  /** The fake OIDC issuer: its token URL as jobs reach it, and its registration. */
  oidc?: { requestUrl: string; register(identity: RunIdentity): string | Promise<string> };
  /** Codeman's action: the e2e bundle and the `action.yml` its input defaults come from. */
  bundle?: { entry?: string; actionYml?: string };
  /** The repository whose checkout `uses: ./<path>` and `uses: <it>@<ref>` run as the bundle. */
  codemanRepository?: string;
  /** More emulated actions, by `owner/repo`. */
  actions?: Record<string, EmulatedAction>;
  /** Where the jobs' directories go; a new temporary directory by default. */
  workdir?: string;
  /** The repository's default `GITHUB_TOKEN` permissions, for a workflow without `permissions`. */
  defaultPermissions?: Permissions;
  events?: SimulatorEvents;
  /**
   * Values that a job's masks leave out: a fake's stand-in for a secret a real service makes
   * random, such as the Firestore emulator's admin token `owner`. GitHub's runner masks every
   * secret a step registers, and skips each job output holding one, so a common word as a secret
   * would hide every output with that word in it, as `select`'s `dispatches` holds `"owner"`.
   */
  unmasked?: readonly string[];
}

/** What starts a run. */
export interface RunRequest {
  repository: string;
  /** The workflow's path, such as `.github/workflows/codeman.yml`. */
  workflow: string;
  event: string;
  /** As `GITHUB_EVENT_PATH` holds it; the repository's payload is added. */
  payload?: Record<string, unknown>;
  /** `refs/heads/<default branch>` by default. */
  ref?: string;
  /** The ref's commit by default. */
  sha?: string;
  /** `workflow_dispatch`'s inputs. */
  inputs?: Record<string, string>;
  actor?: string;
  /** A run the fake already made, as a dispatch does. */
  runId?: number;
  /** The workflow files of this run, instead of the simulator's. */
  workflows?: WorkflowSource;
}

/** A job's and a step's time when they set none, as on GitHub. */
const DEFAULT_MINUTES = 360;

const DEFAULT_PERMISSIONS: Permissions = { contents: "read", packages: "read" };
const STATUS_TEXT = {
  success: "success",
  failure: "failure",
  cancelled: "cancelled",
  skipped: "skipped",
};

/** A run, from queued to completed. */
export class SimRun {
  readonly id: number;
  readonly request: RunRequest;
  readonly workflow: Workflow;
  readonly finished: Promise<RunResult>;
  status: "queued" | "pending" | "in_progress" | "completed" = "queued";
  group?: string;
  readonly controller = new AbortController();
  readonly jobs: JobResult[] = [];
  /** The run's `github` context, without the job's keys. */
  github: Record<string, unknown> = {};
  readonly loaded = new Map<string, Workflow>();
  #resolve!: (result: RunResult) => void;
  #reject!: (error: unknown) => void;
  #settled = false;

  constructor(id: number, request: RunRequest, workflow: Workflow) {
    this.id = id;
    this.request = request;
    this.workflow = workflow;
    this.finished = new Promise((resolvePromise, rejectPromise) => {
      this.#resolve = resolvePromise;
      this.#reject = rejectPromise;
    });
    // A run nobody awaits must not crash the process: callers read `finished` when they care.
    this.finished.catch(() => undefined);
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  /** Cancels the run: running jobs stop, and only jobs whose `if:` allows it still run. */
  cancel(): void {
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  settle(result: RunResult | Error): void {
    if (this.#settled) return;
    this.#settled = true;
    this.status = "completed";
    if (result instanceof Error) this.#reject(result);
    else this.#resolve(result);
  }
}

interface Instance {
  run: SimRun;
  workflow: Workflow;
  inputs: Record<string, unknown>;
  secrets: Record<string, string>;
  /** The permissions a called workflow's jobs may not exceed. */
  cap?: Permissions;
  /** A job's permissions when it names none. */
  defaults: Permissions;
  /** Before each job's name: the calling job's, for a called workflow. */
  prefix: string;
  signal: AbortSignal;
}

interface Outcome {
  result: JobResultName;
  outputs: Record<string, string>;
}

/** A signal that aborts with `parent`, or by its own controller. */
function child(parent: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

function scope(file: string, key: string, kind: KeyKind, status = false): Scope {
  return { file, key, contexts: AVAILABILITY[kind], status };
}

/** A GitHub permission name, as tokens hold it. */
function restPermissions(permissions: Permissions): Record<string, "read" | "write"> {
  const rest: Record<string, "read" | "write"> = {};
  for (const [name, level] of Object.entries(permissions)) {
    if (name !== "id-token") rest[name.replaceAll("-", "_")] = level;
  }
  return rest;
}

function within(permissions: Permissions, cap: Permissions): string | undefined {
  for (const [name, level] of Object.entries(permissions)) {
    const allowed = cap[name];
    if (!allowed || (level === "write" && allowed === "read")) {
      return `'${name}: ${level}', but is only allowed '${name}: ${allowed ?? "none"}'`;
    }
  }
  return undefined;
}

/** A matrix's legs, as GitHub expands one: the product, then `exclude`, then `include`. */
export function expandMatrix(matrix: unknown): Record<string, unknown>[] {
  if (typeof matrix !== "object" || matrix === null || Array.isArray(matrix)) {
    throw new Error("The matrix must be a mapping.");
  }
  const spec = matrix as Record<string, unknown>;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const listOf = (value: unknown, name: string): Record<string, unknown>[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(`The matrix's ${name} must be a list.`);
    return value.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error(`Each entry of the matrix's ${name} must be a mapping.`);
      }
      return entry as Record<string, unknown>;
    });
  };
  const include = listOf(spec.include, "include");
  const exclude = listOf(spec.exclude, "exclude");
  const keys = Object.keys(spec).filter((key) => key !== "include" && key !== "exclude");
  let legs: { values: Record<string, unknown>; original: Set<string> }[] = [];
  if (keys.length > 0) {
    let product: Record<string, unknown>[] = [{}];
    for (const key of keys) {
      const values = spec[key];
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`The matrix vector '${key}' does not contain any values.`);
      }
      product = product.flatMap((leg) => values.map((value) => ({ ...leg, [key]: value })));
    }
    legs = product
      .filter(
        (leg) =>
          !exclude.some((entry) =>
            Object.entries(entry).every(([key, value]) => same(leg[key], value)),
          ),
      )
      .map((values) => ({ values, original: new Set(keys) }));
  }
  const originals = legs.length;
  for (const entry of include) {
    let matched = false;
    for (const leg of legs.slice(0, originals)) {
      const fits = Object.entries(entry).every(
        ([key, value]) => !leg.original.has(key) || same(leg.values[key], value),
      );
      if (fits) {
        Object.assign(leg.values, entry);
        matched = true;
      }
    }
    if (!matched) legs.push({ values: { ...entry }, original: new Set() });
  }
  if (legs.length === 0) throw new Error("The matrix does not contain any values.");
  if (legs.length > 256) throw new Error("A matrix may hold at most 256 jobs.");
  return legs.map((leg) => leg.values);
}

export class Simulator {
  readonly runs: SimRun[] = [];
  readonly #options: SimulatorOptions;
  readonly #github: GitHubPort;
  readonly #workdir: string;
  readonly #queues = new Map<string, { running?: SimRun; pending?: SimRun }>();
  readonly #starting = new Set<Promise<unknown>>();
  readonly #oidc = new Map<string, Promise<string>>();
  #actionInputs: Map<string, string | undefined> | undefined;
  #jobs = 0;

  constructor(options: SimulatorOptions) {
    this.#options = options;
    this.#github = options.github;
    this.#workdir = options.workdir ?? mkdtempSync(join(tmpdir(), "codeman-e2e-simulator-"));
  }

  /** Starts a run for each `workflow_dispatch` the fake records, until the returned function is called. */
  listen(): () => void {
    return this.#github.onDispatch((dispatch) => {
      this.#track(this.dispatched(dispatch));
    });
  }

  /** Runs a dispatch's queued run. */
  dispatched(dispatch: Dispatched): Promise<SimRun> {
    return this.start({
      repository: dispatch.repository,
      workflow: dispatch.workflow,
      event: "workflow_dispatch",
      ref: dispatch.ref.startsWith("refs/") ? dispatch.ref : `refs/heads/${dispatch.ref}`,
      ...(dispatch.headSha ? { sha: dispatch.headSha } : {}),
      inputs: dispatch.inputs,
      actor: dispatch.sender,
      runId: dispatch.runId,
      payload: {
        inputs: dispatch.inputs,
        ref: dispatch.ref.startsWith("refs/") ? dispatch.ref : `refs/heads/${dispatch.ref}`,
        workflow: dispatch.workflow,
        sender: { login: dispatch.sender },
      },
    });
  }

  /**
   * Starts the runs an event triggers: one per workflow of the default branch (a pull request's
   * head for its events) whose `on:` matches. Events a `GITHUB_TOKEN` caused trigger nothing, and
   * `workflow_dispatch` comes through `listen`, with the run the fake made.
   */
  async trigger(event: {
    name: string;
    repository: string;
    payload: Record<string, unknown>;
    triggers?: boolean;
    workflows?: WorkflowSource;
  }): Promise<SimRun[]> {
    if (event.triggers === false || event.name === "workflow_dispatch") return [];
    const repository = this.#github.repository(event.repository);
    const pull = event.payload.pull_request as
      | { number?: number; head?: { sha?: string } }
      | undefined;
    let ref = `refs/heads/${repository.defaultBranch}`;
    let sha = await this.#github.resolve(repository.fullName, repository.defaultBranch);
    if (event.name.startsWith("pull_request") && pull?.number) {
      ref = `refs/pull/${pull.number}/merge`;
      sha = pull.head?.sha ?? sha;
    }
    if (!sha) throw new Error(`${repository.fullName} has no commit to run workflows from.`);
    const source = event.workflows ?? this.#source();
    const started: SimRun[] = [];
    for (const path of await source.list(repository.fullName, sha)) {
      const text = await source.read(repository.fullName, sha, path);
      if (text === undefined) continue;
      const workflow = loadWorkflow(text, path);
      const trigger = workflow.on.get(event.name);
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
          workflows: source,
        }),
      );
    }
    return started;
  }

  /** Runs each workflow of the default branch that has a `schedule`, as its cron would. */
  async schedule(repository: string, workflows?: WorkflowSource): Promise<SimRun[]> {
    const info = this.#github.repository(repository);
    const sha = await this.#github.resolve(info.fullName, info.defaultBranch);
    if (!sha) throw new Error(`${info.fullName} has no commit to run workflows from.`);
    const source = workflows ?? this.#source();
    const started: SimRun[] = [];
    for (const path of await source.list(info.fullName, sha)) {
      const text = await source.read(info.fullName, sha, path);
      if (text === undefined) continue;
      const crons = loadWorkflow(text, path).on.get("schedule")?.crons;
      if (!crons?.length) continue;
      started.push(
        await this.start({
          repository: info.fullName,
          workflow: path,
          event: "schedule",
          payload: { schedule: crons[0] },
          sha,
          workflows: source,
        }),
      );
    }
    return started;
  }

  /** Queues a run of one workflow; it starts when its concurrency group lets it. */
  start(request: RunRequest): Promise<SimRun> {
    const starting = this.#start(request);
    this.#track(starting);
    return starting;
  }

  /** Resolves when no run is queued, pending or running, dispatched ones included. */
  async idle(): Promise<void> {
    for (;;) {
      await Promise.allSettled([...this.#starting]);
      const open = this.runs.filter((run) => run.status !== "completed");
      if (open.length === 0) {
        await new Promise((done) => setImmediate(done));
        if (this.#starting.size === 0 && this.runs.every((run) => run.status === "completed"))
          return;
        continue;
      }
      await Promise.allSettled(open.map((run) => run.finished));
    }
  }

  #track(promise: Promise<unknown>): void {
    this.#starting.add(promise);
    promise.then(
      () => this.#starting.delete(promise),
      () => this.#starting.delete(promise),
    );
  }

  #source(): WorkflowSource {
    return this.#options.workflows ?? repositoryWorkflows(this.#github);
  }

  async #start(request: RunRequest): Promise<SimRun> {
    const repository = this.#github.repository(request.repository);
    const ref = request.ref ?? `refs/heads/${repository.defaultBranch}`;
    const sha =
      request.sha ??
      (await this.#github.resolve(repository.fullName, ref.replace(/^refs\/heads\//, "")));
    if (!sha) throw new Error(`${ref} of ${repository.fullName} resolves to no commit.`);
    const source = request.workflows ?? this.#source();
    const text = await source.read(repository.fullName, sha, request.workflow);
    if (text === undefined)
      throw new Error(`No ${request.workflow} in ${repository.fullName} at ${sha}.`);
    const workflow = loadWorkflow(text, request.workflow);
    const refName = ref.replace(/^refs\/(heads|tags)\//, "");
    const record = await (request.runId
      ? this.#github.existingRun(request.runId)
      : this.#github.startRun({
          repository: repository.fullName,
          workflow: request.workflow,
          name: workflow.name ?? request.workflow,
          event: request.event,
          headBranch: refName,
          headSha: sha,
          ...(request.actor ? { actor: request.actor } : {}),
          ...(request.inputs ? { inputs: request.inputs } : {}),
        }));
    const run = new SimRun(record.id, { ...request, workflows: source, sha, ref }, workflow);
    run.loaded.set(request.workflow, workflow);
    this.runs.push(run);
    const pull = (request.payload?.pull_request ?? {}) as {
      head?: { ref?: string };
      base?: { ref?: string };
    };
    const payload = { ...request.payload, ...repository.payload };
    const actor = request.actor ?? "github-actions[bot]";
    run.github = {
      event_name: request.event,
      event: payload,
      repository: repository.fullName,
      repository_id: String(repository.id),
      repository_owner: repository.owner,
      repository_owner_id: String(repository.ownerId),
      run_id: String(record.id),
      run_number: String(record.runNumber),
      run_attempt: String(record.runAttempt),
      workflow: workflow.name ?? request.workflow,
      workflow_ref: `${repository.fullName}/${request.workflow}@${ref}`,
      workflow_sha: sha,
      ref,
      ref_name: refName,
      ref_type: ref.startsWith("refs/tags/") ? "tag" : "branch",
      ref_protected: false,
      sha,
      head_ref: pull.head?.ref ?? "",
      base_ref: pull.base?.ref ?? "",
      actor,
      triggering_actor: actor,
      server_url: this.#github.urls.server,
      api_url: this.#github.urls.api,
      graphql_url: this.#github.urls.graphql,
      retention_days: "90",
      repositoryUrl: `${this.#github.urls.server.replace(/^https?/, "git")}/${repository.fullName}.git`,
    };
    this.#options.events?.runQueued?.(run);

    // GitHub checks the called workflows and their permissions before any job starts.
    const problem = await this.#check(run, workflow, undefined, 0);
    if (problem) {
      this.#github.updateRun(run.id, { status: "completed", conclusion: "startup_failure" });
      this.#finish(run, { conclusion: "startup_failure", error: problem, graph: {} });
      return run;
    }

    const vars = this.#options.vars?.(repository.fullName) ?? {};
    const concurrency = workflow.concurrency;
    if (!concurrency) {
      void this.#execute(run);
      return run;
    }
    const contexts: Contexts = {
      github: run.github,
      inputs: this.#dispatchInputs(workflow, request),
      vars,
    };
    const group = interpolate(
      concurrency.group,
      contexts,
      scope(workflow.file, "concurrency.group", "concurrency"),
    );
    const cancelInProgress = truthy(
      evaluateValue(
        concurrency.cancelInProgress,
        contexts,
        scope(workflow.file, "concurrency.cancel-in-progress", "concurrency"),
      ),
    );
    if (group === "") {
      void this.#execute(run);
      return run;
    }
    run.group = group;
    this.#github.updateRun(run.id, { concurrency: group });
    const key = `${repository.fullName.toLowerCase()}#${group.toLowerCase()}`;
    const slot = this.#queues.get(key) ?? {};
    this.#queues.set(key, slot);
    if (cancelInProgress) slot.running?.cancel();
    if (!slot.running) {
      slot.running = run;
      void this.#execute(run, key);
      return run;
    }
    if (slot.pending) {
      const replaced = slot.pending;
      replaced.cancel();
      this.#github.updateRun(replaced.id, { status: "completed", conclusion: "cancelled" });
      this.#finish(replaced, { conclusion: "cancelled", graph: {} });
    }
    slot.pending = run;
    run.status = "pending";
    this.#github.updateRun(run.id, { status: "pending" });
    return run;
  }

  #finish(
    run: SimRun,
    result: Pick<RunResult, "conclusion" | "graph"> & { error?: string },
  ): RunResult {
    const final: RunResult = {
      id: run.id,
      repository: run.request.repository,
      workflow: run.request.workflow,
      event: run.request.event,
      ...(run.group ? { group: run.group } : {}),
      jobs: run.jobs,
      ...result,
    };
    run.settle(final);
    this.#options.events?.runCompleted?.(final);
    return final;
  }

  #release(key: string | undefined, run: SimRun): void {
    if (!key) return;
    const slot = this.#queues.get(key);
    if (!slot || slot.running !== run) return;
    slot.running = undefined;
    const next = slot.pending;
    slot.pending = undefined;
    if (next) {
      slot.running = next;
      void this.#execute(next, key);
    }
  }

  async #execute(run: SimRun, key?: string): Promise<void> {
    run.status = "in_progress";
    this.#github.updateRun(run.id, { status: "in_progress" });
    this.#options.events?.runStarted?.(run);
    const repository = run.request.repository;
    try {
      const outcomes = await this.#graph({
        run,
        workflow: run.workflow,
        inputs: this.#dispatchInputs(run.workflow, run.request),
        secrets: this.#options.secrets?.(repository) ?? {},
        defaults:
          run.workflow.permissions ?? this.#options.defaultPermissions ?? DEFAULT_PERMISSIONS,
        prefix: "",
        signal: run.controller.signal,
      });
      const results = [...outcomes.values()].map((outcome) => outcome.result);
      const conclusion: RunConclusion = results.includes("failure")
        ? "failure"
        : run.cancelled || results.includes("cancelled")
          ? "cancelled"
          : results.every((result) => result === "skipped")
            ? "skipped"
            : "success";
      this.#github.updateRun(run.id, { status: "completed", conclusion });
      this.#finish(run, { conclusion, graph: Object.fromEntries(outcomes) });
    } catch (error) {
      this.#github.updateRun(run.id, { status: "completed", conclusion: "failure" });
      run.settle(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#release(key, run);
    }
  }

  /** `inputs` of the root workflow: a dispatch's declared inputs, typed, with their defaults. */
  #dispatchInputs(workflow: Workflow, request: RunRequest): Record<string, unknown> {
    if (request.event !== "workflow_dispatch") return {};
    const inputs: Record<string, unknown> = {};
    for (const [name, spec] of workflow.dispatchInputs) {
      const given = request.inputs?.[name];
      inputs[name] = typed(spec.type, given ?? spec.default);
    }
    return inputs;
  }

  /** The called workflows' files and permissions, as GitHub checks them at a run's start. */
  async #check(
    run: SimRun,
    workflow: Workflow,
    cap: Permissions | undefined,
    depth: number,
  ): Promise<string | undefined> {
    if (depth > 10) return `${workflow.file}: reusable workflows nest more than 10 levels`;
    const defaults =
      workflow.permissions ?? cap ?? this.#options.defaultPermissions ?? DEFAULT_PERMISSIONS;
    for (const job of workflow.jobs.values()) {
      const permissions = job.permissions ?? defaults;
      if (cap) {
        const beyond = within(permissions, cap);
        if (beyond) {
          return `${workflow.file}: The nested job '${job.id}' is requesting ${beyond}.`;
        }
      }
      if (!job.uses) continue;
      const called = await this.#load(run, job);
      const call = called.call;
      if (!call)
        return `${called.file}: has no workflow_call trigger, so ${workflow.file} cannot call it`;
      for (const name of Object.keys(job.with)) {
        if (!call.inputs.has(name))
          return `${workflow.file}: jobs.${job.id}.with: ${name} is not an input of ${called.file}`;
      }
      for (const [name, input] of call.inputs) {
        if (input.required && input.default === undefined && !(name in job.with)) {
          return `${workflow.file}: jobs.${job.id}: the input ${name} of ${called.file} is required`;
        }
      }
      if (job.secrets !== "inherit") {
        for (const name of Object.keys(job.secrets ?? {})) {
          if (!call.secrets.has(name))
            return `${workflow.file}: jobs.${job.id}.secrets: ${name} is not a secret of ${called.file}`;
        }
      }
      const problem = await this.#check(run, called, permissions, depth + 1);
      if (problem) return problem;
    }
    return undefined;
  }

  async #load(run: SimRun, job: JobSpec): Promise<Workflow> {
    const uses = job.uses ?? "";
    if (!uses.startsWith("./") || uses.includes("${{") || uses.includes("@")) {
      throw new Unsupported(
        `${run.workflow.file}: jobs.${job.id}.uses: only a workflow of the same repository, as ./<path>, is supported, not ${uses}`,
      );
    }
    const path = posix.normalize(uses.slice(2));
    const known = run.loaded.get(path);
    if (known) return known;
    const source = run.request.workflows ?? this.#source();
    const text = await source.read(run.request.repository, run.request.sha ?? "", path);
    if (text === undefined)
      throw new Unsupported(`${run.workflow.file}: jobs.${job.id}.uses: no ${path}`);
    const workflow = loadWorkflow(text, path);
    run.loaded.set(path, workflow);
    return workflow;
  }

  /** Runs a workflow's jobs, each when its needs end; returns each job's outcome. */
  async #graph(instance: Instance): Promise<Map<string, Outcome>> {
    const { workflow } = instance;
    const outcomes = new Map<string, Outcome>();
    const scheduled = new Map<string, Promise<Outcome>>();
    const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
      for (const need of workflow.jobs.get(id)?.needs ?? []) {
        if (!seen.has(need)) {
          seen.add(need);
          ancestors(need, seen);
        }
      }
      return seen;
    };
    const schedule = (id: string): Promise<Outcome> => {
      const known = scheduled.get(id);
      if (known) return known;
      const job = workflow.jobs.get(id);
      if (!job) throw new Error(`${workflow.file}: no job ${id}`);
      const promise = Promise.all(job.needs.map(schedule)).then(async () => {
        const outcome = await this.#job(instance, job, outcomes, ancestors(id));
        outcomes.set(id, outcome);
        return outcome;
      });
      scheduled.set(id, promise);
      return promise;
    };
    await Promise.all([...workflow.jobs.keys()].map(schedule));
    return new Map([...workflow.jobs.keys()].map((id) => [id, outcomes.get(id) as Outcome]));
  }

  /** One job: its `if:`, its matrix's legs, and each leg's steps or called workflow. */
  async #job(
    instance: Instance,
    job: JobSpec,
    outcomes: Map<string, Outcome>,
    ancestors: Set<string>,
  ): Promise<Outcome> {
    const { run, workflow } = instance;
    const file = workflow.file;
    const vars = this.#options.vars?.(run.request.repository) ?? {};
    const needs = Object.fromEntries(
      job.needs.map((need) => [need, outcomes.get(need) ?? { result: "skipped", outputs: {} }]),
    );
    const before = [...ancestors].map((id) => outcomes.get(id)?.result);
    const status: Status = {
      success: () => !instance.signal.aborted && before.every((result) => result === "success"),
      failure: () => before.includes("failure"),
      cancelled: () => instance.signal.aborted,
    };
    const contexts: Contexts = { github: run.github, needs, vars, inputs: instance.inputs };
    const ended = (result: JobResultName, error?: string): Outcome => {
      // A job that never ran has no matrix: its name is evaluated without one, as GitHub shows it.
      let own = job.id;
      try {
        if (job.name !== undefined) {
          own = interpolate(
            job.name,
            { ...contexts, matrix: {}, strategy: {} },
            scope(file, `jobs.${job.id}.name`, "job.name"),
          );
        }
      } catch (caught) {
        if (!(caught instanceof EvaluationError)) throw caught;
      }
      const name = `${instance.prefix}${own}`;
      this.#record(run, {
        runId: run.id,
        id: job.id,
        name,
        workflow: file,
        result,
        outputs: {},
        steps: [],
        log: error ?? "",
        permissions: {},
        env: {},
        ...(error ? { error } : {}),
      });
      return { result, outputs: {} };
    };

    let go: boolean;
    try {
      go = evaluateCondition(
        job.if ?? "success()",
        contexts,
        scope(file, `jobs.${job.id}.if`, "job.if", true),
        status,
      );
    } catch (error) {
      if (error instanceof EvaluationError) return ended("failure", error.message);
      throw error;
    }
    if (!go) return ended(instance.signal.aborted ? "cancelled" : "skipped");

    // The job's own signal: a job that starts after a cancellation, by its if:, runs whole.
    const jobController = instance.signal.aborted ? new AbortController() : child(instance.signal);

    let legs: (Record<string, unknown> | undefined)[] = [undefined];
    let failFast = true;
    let maxParallel = Number.POSITIVE_INFINITY;
    if (job.strategy) {
      try {
        const at = (key: string) => scope(file, `jobs.${job.id}.strategy.${key}`, "job.strategy");
        legs = expandMatrix(deepEvaluate(job.strategy.matrix, contexts, at("matrix")));
        failFast = truthy(evaluateValue(job.strategy.failFast, contexts, at("fail-fast")));
        if (job.strategy.maxParallel !== undefined) {
          const max = Number(evaluateValue(job.strategy.maxParallel, contexts, at("max-parallel")));
          if (Number.isFinite(max) && max > 0) maxParallel = max;
        }
      } catch (error) {
        if (error instanceof EvaluationError || !(error instanceof Unsupported)) {
          return ended(
            "failure",
            `Error when evaluating 'strategy' for job '${job.id}'. ${(error as Error).message}`,
          );
        }
        throw error;
      }
    }

    const results: { index: number; outcome: Outcome }[] = [];
    const legsController = child(jobController.signal);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= legs.length) return;
        const matrix = legs[index];
        const legContexts: Contexts = {
          ...contexts,
          ...(matrix ? { matrix } : { matrix: {} }),
          strategy: {
            "fail-fast": failFast,
            "job-index": index,
            "job-total": legs.length,
            "max-parallel": Number.isFinite(maxParallel) ? maxParallel : legs.length,
          },
        };
        const name = this.#legName(job, file, legContexts, matrix);
        let outcome: Outcome;
        if (legsController.signal.aborted && !instance.signal.aborted) {
          outcome = { result: "cancelled", outputs: {} };
          this.#record(run, {
            runId: run.id,
            id: job.id,
            name: `${instance.prefix}${name}`,
            workflow: file,
            result: "cancelled",
            outputs: {},
            steps: [],
            log: "",
            permissions: {},
            env: {},
            ...(matrix ? { matrix } : {}),
          });
        } else if (job.uses) {
          outcome = await this.#call(instance, job, legContexts, name, legsController.signal);
        } else {
          outcome = await this.#steps(
            instance,
            job,
            legContexts,
            name,
            matrix,
            legsController.signal,
          );
        }
        results.push({ index, outcome });
        if (failFast && outcome.result === "failure" && legs.length > 1) legsController.abort();
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxParallel, legs.length) }, () => worker()));

    const all = results.map((entry) => entry.outcome.result);
    const result: JobResultName = all.includes("failure")
      ? "failure"
      : all.includes("cancelled")
        ? "cancelled"
        : all.every((value) => value === "skipped")
          ? "skipped"
          : "success";
    // A matrix keeps, per output, the last successful leg's value that is not empty.
    const outputs: Record<string, string> = {};
    for (const { outcome } of results) {
      if (legs.length > 1 && outcome.result !== "success") continue;
      for (const [name, value] of Object.entries(outcome.outputs)) {
        if (value !== "" || !(name in outputs)) outputs[name] = value;
      }
    }
    return { result, outputs };
  }

  #legName(
    job: JobSpec,
    file: string,
    contexts: Contexts,
    matrix: Record<string, unknown> | undefined,
  ): string {
    const values = matrix ? Object.values(matrix).map(toText).join(", ") : "";
    if (job.name === undefined) return matrix ? `${job.id} (${values})` : job.id;
    const name = interpolate(job.name, contexts, scope(file, `jobs.${job.id}.name`, "job.name"));
    const usesMatrix = typeof job.name === "string" && /matrix\./i.test(job.name);
    return matrix && !usesMatrix ? `${name} (${values})` : name;
  }

  #record(run: SimRun, result: JobResult): void {
    run.jobs.push(result);
    this.#options.events?.jobCompleted?.(result);
  }

  /** A leg that calls a reusable workflow. */
  async #call(
    instance: Instance,
    job: JobSpec,
    contexts: Contexts,
    name: string,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const { run, workflow } = instance;
    const file = workflow.file;
    const called = await this.#load(run, job);
    const call = called.call;
    if (!call) throw new Unsupported(`${called.file} has no workflow_call trigger`);
    const inputs: Record<string, unknown> = {};
    let secrets: Record<string, string>;
    try {
      for (const [input, spec] of call.inputs) {
        const value =
          input in job.with
            ? evaluateValue(
                job.with[input],
                contexts,
                scope(file, `jobs.${job.id}.with.${input}`, "job.with"),
              )
            : spec.default;
        inputs[input] = typed(spec.type, value);
      }
      if (job.secrets === "inherit") secrets = { ...instance.secrets };
      else {
        secrets = {};
        const secretContexts = { ...contexts, secrets: instance.secrets };
        for (const [secret, value] of Object.entries(job.secrets ?? {})) {
          secrets[secret] = interpolate(
            value,
            secretContexts,
            scope(file, `jobs.${job.id}.secrets.${secret}`, "job.secrets"),
          );
        }
      }
    } catch (error) {
      if (!(error instanceof EvaluationError)) throw error;
      this.#record(run, {
        runId: run.id,
        id: job.id,
        name: `${instance.prefix}${name}`,
        workflow: file,
        result: "failure",
        outputs: {},
        steps: [],
        log: error.message,
        permissions: {},
        env: {},
        error: error.message,
      });
      return { result: "failure", outputs: {} };
    }
    const cap = job.permissions ?? instance.defaults;
    const inner = await this.#graph({
      run,
      workflow: called,
      inputs,
      secrets,
      cap,
      defaults: called.permissions ?? cap,
      prefix: `${instance.prefix}${name} / `,
      signal,
    });
    const results = [...inner.values()].map((outcome) => outcome.result);
    const result: JobResultName = results.includes("failure")
      ? "failure"
      : results.includes("cancelled")
        ? "cancelled"
        : "success";
    const jobs = Object.fromEntries(inner);
    const outputs: Record<string, string> = {};
    for (const [output, value] of call.outputs) {
      try {
        outputs[output] = interpolate(
          value,
          {
            github: run.github,
            jobs,
            vars: this.#options.vars?.(run.request.repository) ?? {},
            inputs,
          },
          scope(called.file, `on.workflow_call.outputs.${output}.value`, "call.outputs"),
        );
      } catch (error) {
        if (!(error instanceof EvaluationError)) throw error;
      }
    }
    return { result, outputs };
  }

  /** A leg with steps: one job on a runner. */
  async #steps(
    instance: Instance,
    job: JobSpec,
    legContexts: Contexts,
    name: string,
    matrix: Record<string, unknown> | undefined,
    parent: AbortSignal,
  ): Promise<Outcome> {
    const { run, workflow } = instance;
    const file = workflow.file;
    const repository = run.request.repository;
    const fullName = `${instance.prefix}${name}`;
    const permissions = job.permissions ?? instance.defaults;
    const controller = parent.aborted ? new AbortController() : child(parent);
    let timedOut = false;

    const timeoutMinutes = Number(
      job.timeoutMinutes === undefined
        ? DEFAULT_MINUTES
        : evaluateValue(
            job.timeoutMinutes,
            legContexts,
            scope(file, `jobs.${job.id}.timeout-minutes`, "job.name"),
          ),
    );
    const deadline =
      Date.now() + (Number.isFinite(timeoutMinutes) ? timeoutMinutes : DEFAULT_MINUTES) * 60_000;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.max(0, deadline - Date.now()),
    );

    const record = await this.#github.startJob(run.id, fullName);
    const hostRoot = join(this.#workdir, `run-${run.id}`, `${++this.#jobs}-${slug(fullName)}`);
    mkdirSync(hostRoot, { recursive: true });
    const session: JobSession = await this.#options.executor.start({
      runId: run.id,
      name: fullName,
      repository,
      hostRoot,
    });
    const view = session.root.replace(/\/$/, "");
    const toHost = (path: string): string => {
      const normalized = posix.normalize(path);
      if (normalized !== view && !normalized.startsWith(`${view}/`)) {
        throw new Unsupported(`${fullName}: ${path} is outside the job's directory ${view}`);
      }
      return join(hostRoot, ...normalized.slice(view.length).split("/").filter(Boolean));
    };
    const repoName = repository.split("/")[1] ?? repository;
    const workspace = { view: `${view}/${repoName}/${repoName}`, host: "" };
    workspace.host = toHost(workspace.view);
    const temp = `${view}/_temp`;
    const commandsDir = `${temp}/_runner_file_commands`;
    const eventPath = `${temp}/_github_workflow/event.json`;
    for (const dir of [workspace.view, commandsDir, `${temp}/_github_workflow`]) {
      mkdirSync(toHost(dir), { recursive: true });
    }
    writeFileSync(toHost(eventPath), JSON.stringify(run.github.event ?? {}, null, 2));

    const token = await this.#github.jobToken(repository, restPermissions(permissions), run.id);
    const masks = new Set<string>([
      token,
      ...Object.values(instance.secrets).filter((value) => value.length > 0),
    ]);
    const lines: string[] = [];
    const log = (line: string) => {
      let masked = line;
      for (const secret of [...masks].sort((a, b) => b.length - a.length)) {
        if (secret) masked = masked.split(secret).join("***");
      }
      lines.push(masked);
      this.#options.events?.log?.(fullName, masked);
    };

    const repoInfo = this.#github.repository(repository);
    const baseEnv: Record<string, string> = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_ACTOR: String(run.github.actor),
      GITHUB_TRIGGERING_ACTOR: String(run.github.triggering_actor),
      GITHUB_API_URL: this.#github.urls.api,
      GITHUB_SERVER_URL: this.#github.urls.server,
      GITHUB_GRAPHQL_URL: this.#github.urls.graphql,
      GITHUB_BASE_REF: String(run.github.base_ref),
      GITHUB_HEAD_REF: String(run.github.head_ref),
      GITHUB_EVENT_NAME: run.request.event,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_JOB: job.id,
      GITHUB_REF: String(run.github.ref),
      GITHUB_REF_NAME: String(run.github.ref_name),
      GITHUB_REF_TYPE: String(run.github.ref_type),
      GITHUB_REF_PROTECTED: "false",
      GITHUB_REPOSITORY: repository,
      GITHUB_REPOSITORY_ID: String(repoInfo.id),
      GITHUB_REPOSITORY_OWNER: repoInfo.owner,
      GITHUB_REPOSITORY_OWNER_ID: String(repoInfo.ownerId),
      GITHUB_RETENTION_DAYS: "90",
      GITHUB_RUN_ATTEMPT: String(run.github.run_attempt),
      GITHUB_RUN_ID: String(run.id),
      GITHUB_RUN_NUMBER: String(run.github.run_number),
      GITHUB_SHA: String(run.github.sha),
      GITHUB_WORKFLOW: String(run.github.workflow),
      GITHUB_WORKFLOW_REF: String(run.github.workflow_ref),
      GITHUB_WORKFLOW_SHA: String(run.github.workflow_sha),
      GITHUB_WORKSPACE: workspace.view,
      RUNNER_ARCH: "X64",
      RUNNER_OS: "Linux",
      RUNNER_NAME: `GitHub Actions ${this.#jobs}`,
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_TEMP: temp,
      RUNNER_TOOL_CACHE: "/opt/hostedtoolcache",
      ACTIONS_RUNTIME_TOKEN: record.runtimeToken,
      ACTIONS_RUNTIME_URL: this.#github.urls.results,
      ACTIONS_RESULTS_URL: this.#github.urls.results,
    };
    if (permissions["id-token"] === "write" && this.#options.oidc) {
      baseEnv.ACTIONS_ID_TOKEN_REQUEST_URL = this.#options.oidc.requestUrl;
      baseEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN = await this.#oidcToken(run, workflow.file);
      masks.add(baseEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
    }

    const github = {
      ...run.github,
      token,
      job: job.id,
      workspace: workspace.view,
      event_path: eventPath,
      action: "",
    };
    const runner = {
      os: "Linux",
      arch: "X64",
      name: baseEnv.RUNNER_NAME,
      temp,
      tool_cache: "/opt/hostedtoolcache",
      environment: "github-hosted",
      debug: "",
    };
    const secrets = { ...instance.secrets, GITHUB_TOKEN: token };
    const jobContext: {
      status: string;
      container: Record<string, string>;
      services: Record<string, unknown>;
    } = {
      status: "success",
      container: { id: "", network: "" },
      services: {},
    };
    const contexts: Contexts = {
      ...legContexts,
      github,
      runner,
      job: jobContext,
      secrets,
      steps: {},
    };
    const env: Record<string, string> = {};
    const steps: Record<
      string,
      { outputs: Record<string, string>; outcome: string; conclusion: string }
    > = {};
    const results: StepResult[] = [];
    const posts: { name: string; run: () => Promise<void> }[] = [];
    const paths: string[] = [];
    const codeman = {
      repository: this.#options.codemanRepository ?? "codenergy-dev/codeman",
      paths: new Set<string>(),
    };
    let failed = false;
    let error: string | undefined;

    try {
      for (const [key, value] of Object.entries(workflow.env)) {
        env[key] = interpolate(
          value,
          { ...contexts, env: { ...env } },
          scope(file, `env.${key}`, "workflow.env"),
        );
      }
      for (const [key, value] of Object.entries(job.env)) {
        env[key] = interpolate(
          value,
          { ...contexts, env: { ...env } },
          scope(file, `jobs.${job.id}.env.${key}`, "job.env"),
        );
      }
    } catch (caught) {
      if (!(caught instanceof EvaluationError)) throw caught;
      failed = true;
      error = caught.message;
      log(caught.message);
    }

    const stepContexts = () => ({ ...contexts, steps, env: { ...env }, job: { ...jobContext } });
    for (const step of error ? [] : job.steps) {
      const info: StepInfo = { index: step.index, ...(step.id ? { id: step.id } : {}), name: "" };
      const cancelled = controller.signal.aborted;
      const stepStatus: Status = {
        success: () => !controller.signal.aborted && !failed,
        failure: () => failed,
        cancelled: () => controller.signal.aborted,
      };
      jobContext.status = cancelled ? "cancelled" : failed ? "failure" : "success";
      const at = (key: string, kind: KeyKind) =>
        scope(file, `${step.key}.${key}`, kind, key === "if");
      let outcome: JobResultName = "success";
      let outputs: Record<string, string> = {};
      try {
        info.name =
          step.name !== undefined
            ? interpolate(step.name, stepContexts(), at("name", "step"))
            : step.run !== undefined
              ? `Run ${step.run.split("\n")[0]}`
              : `Run ${step.uses}`;
        const go = evaluateCondition(
          step.if ?? "success()",
          stepContexts(),
          at("if", "step.if"),
          stepStatus,
        );
        if (!go) {
          outcome = "skipped";
        } else {
          log(`##[group]${info.name}`);
          const stepEnv: Record<string, string> = { ...env };
          for (const [key, value] of Object.entries(step.env)) {
            stepEnv[key] = interpolate(value, stepContexts(), at(`env.${key}`, "step"));
          }
          const stepSignal = cancelled ? new AbortController().signal : controller.signal;
          const executed = await this.#step({
            step,
            info,
            file,
            contexts: { ...stepContexts(), env: stepEnv },
            env: { ...stepEnv, ...baseEnv },
            paths,
            session,
            toHost,
            commandsDir,
            workspace,
            temp,
            signal: stepSignal,
            // A step that runs after its job was cancelled or timed out, by its if:, has its own
            // time only, as on GitHub.
            deadline: cancelled ? undefined : deadline,
            log,
            masks,
            posts,
            codeman,
            action: {
              runId: run.id,
              repository,
              owner: repoInfo.owner,
              sha: String(run.github.sha),
              ref: String(run.github.ref),
              token,
              backendId: record.backendId,
            },
          });
          outcome = executed.outcome;
          outputs = executed.outputs;
          for (const [key, value] of executed.env) {
            if (!/^(GITHUB|RUNNER)_/.test(key)) env[key] = value;
          }
          // As the runner's PrependPath: the latest entry first, each entry once.
          for (const entry of executed.paths) {
            const known = paths.indexOf(entry);
            if (known >= 0) paths.splice(known, 1);
            paths.unshift(entry);
          }
          log("##[endgroup]");
        }
      } catch (caught) {
        if (!(caught instanceof EvaluationError)) {
          clearTimeout(timer);
          await session.stop();
          throw caught;
        }
        outcome = "failure";
        log(`##[error]${caught.message}`);
      }
      let conclusion = outcome;
      if (outcome === "failure" && step.continueOnError !== undefined) {
        try {
          if (
            truthy(
              evaluateValue(step.continueOnError, stepContexts(), at("continue-on-error", "step")),
            )
          ) {
            conclusion = "success";
          }
        } catch (caught) {
          if (!(caught instanceof EvaluationError)) throw caught;
        }
      }
      if (conclusion === "failure") failed = true;
      if (step.id) steps[step.id] = { outputs, outcome, conclusion };
      results.push({ ...info, outcome, conclusion, outputs });
    }

    for (const post of posts.reverse()) {
      try {
        await post.run();
      } catch (caught) {
        log(`##[warning]Post ${post.name}: ${(caught as Error).message}`);
      }
    }

    const cancelled = controller.signal.aborted && !timedOut;
    if (timedOut) {
      log(
        `##[error]The job running on runner ${runner.name} has exceeded the maximum execution time of ${timeoutMinutes} minutes.`,
      );
    }
    const result: JobResultName =
      timedOut || failed ? "failure" : cancelled ? "cancelled" : "success";
    jobContext.status = result;
    const jobOutputs: Record<string, string> = {};
    for (const [key, value] of Object.entries(job.outputs)) {
      try {
        const text = interpolate(
          value,
          stepContexts(),
          scope(file, `jobs.${job.id}.outputs.${key}`, "job.outputs"),
        );
        if ([...masks].some((secret) => secret !== "" && text.includes(secret))) {
          log(`##[warning]Skip output '${key}' since it may contain secret.`);
          continue;
        }
        jobOutputs[key] = text;
      } catch (caught) {
        if (!(caught instanceof EvaluationError)) throw caught;
        log(`##[error]${caught.message}`);
      }
    }
    clearTimeout(timer);
    await session.stop();
    const text = lines.join("\n");
    this.#github.finishJob(record.id, STATUS_TEXT[result], text);
    this.#record(run, {
      runId: run.id,
      id: job.id,
      name: fullName,
      workflow: file,
      result,
      outputs: jobOutputs,
      ...(matrix ? { matrix } : {}),
      steps: results,
      log: text,
      permissions,
      env: baseEnv,
      token,
      ...(error ? { error } : {}),
    });
    return { result, outputs: jobOutputs };
  }

  /** One request token per run and job workflow: jobs that start at once share it. */
  #oidcToken(run: SimRun, jobWorkflow: string): Promise<string> {
    const key = `${run.id}#${jobWorkflow}`;
    const known = this.#oidc.get(key);
    if (known) return known;
    const info = this.#github.repository(run.request.repository);
    const token = Promise.resolve(
      this.#options.oidc?.register({
        repository: info.fullName,
        repositoryId: String(info.id),
        ownerId: String(info.ownerId),
        runId: String(run.id),
        runAttempt: String(run.github.run_attempt),
        workflowFile: posix.basename(run.request.workflow),
        workflow: String(run.github.workflow),
        ref: String(run.github.ref),
        jobWorkflowFile: posix.basename(jobWorkflow),
        eventName: run.request.event,
      }) ?? "",
    );
    this.#oidc.set(key, token);
    return token;
  }

  /** Runs one step that its `if:` let through. */
  async #step(context: {
    step: StepSpec;
    info: StepInfo;
    file: string;
    contexts: Contexts;
    env: Record<string, string>;
    paths: string[];
    session: JobSession;
    toHost: (path: string) => string;
    commandsDir: string;
    workspace: { view: string; host: string };
    temp: string;
    signal: AbortSignal;
    /** When the job's time ends; undefined for a step that runs after its job was cancelled. */
    deadline: number | undefined;
    log: (line: string) => void;
    masks: Set<string>;
    posts: { name: string; run: () => Promise<void> }[];
    codeman: { repository: string; paths: Set<string> };
    action: Omit<ActionContext["job"], "workspace" | "toHost" | "codeman">;
  }): Promise<{
    outcome: JobResultName;
    outputs: Record<string, string>;
    env: Map<string, string>;
    paths: string[];
  }> {
    const { step, file, contexts, log } = context;
    const at = (key: string) => scope(file, `${step.key}.${key}`, "step");
    const files = stepFiles(context.toHost(context.commandsDir), context.commandsDir);
    const env: Record<string, string> = {
      ...context.env,
      GITHUB_OUTPUT: files.view.output,
      GITHUB_ENV: files.view.env,
      GITHUB_PATH: files.view.path,
      GITHUB_STATE: files.view.state,
      GITHUB_STEP_SUMMARY: files.view.summary,
      GITHUB_ACTION: step.id ?? `__run_${step.index}`,
    };
    const stepMinutes =
      step.timeoutMinutes === undefined
        ? undefined
        : Number(evaluateValue(step.timeoutMinutes, contexts, at("timeout-minutes")));
    const limit = Math.min(
      context.deadline === undefined ? Number.POSITIVE_INFINITY : context.deadline - Date.now(),
      stepMinutes !== undefined && Number.isFinite(stepMinutes)
        ? stepMinutes * 60_000
        : Number.POSITIVE_INFINITY,
    );
    const timeoutMs = Math.max(0, Number.isFinite(limit) ? limit : DEFAULT_MINUTES * 60_000);
    const base = {
      env,
      path: [...context.paths],
      step: context.info,
      signal: context.signal,
      timeoutMs,
    };

    let command: Command | undefined;
    let outputs: Record<string, string> = {};
    if (step.run !== undefined) {
      const script = interpolate(step.run, contexts, at("run"));
      const scriptView = `${context.temp}/${randomUUID()}.sh`;
      writeFileSync(context.toHost(scriptView), script);
      const cwd =
        step.workingDirectory === undefined
          ? context.workspace.view
          : posix.resolve(
              context.workspace.view,
              interpolate(step.workingDirectory, contexts, at("working-directory")),
            );
      command = { kind: "run", argv: shellArgv(step.shell, scriptView), script, cwd, ...base };
    } else {
      const uses = step.uses ?? "";
      const inputs: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.with))
        inputs[key] = interpolate(value, contexts, at(`with.${key}`));
      const local = uses.startsWith("./")
        ? posix.normalize(posix.join(context.workspace.view, uses))
        : undefined;
      const repository = /^([^/@]+\/[^/@]+)(\/[^@]*)?@.+$/.exec(uses)?.[1]?.toLowerCase();
      const isCodeman =
        (local !== undefined && context.codeman.paths.has(local)) ||
        repository === context.codeman.repository.toLowerCase();
      if (isCodeman) {
        const defaults = this.#codemanDefaults();
        const given = { ...inputs };
        for (const [key, value] of defaults) {
          if (!(key in given) && value !== undefined)
            given[key] = interpolate(value, contexts, at(`with.${key}`));
        }
        for (const key of Object.keys(inputs)) {
          if (!defaults.has(key))
            log(
              `##[warning]Unexpected input '${key}', valid inputs are ${[...defaults.keys()].join(", ")}`,
            );
        }
        const inputEnv = Object.fromEntries(
          Object.entries(given).map(([key, value]) => [
            `INPUT_${key.replace(/ /g, "_").toUpperCase()}`,
            value,
          ]),
        );
        command = {
          kind: "action",
          entry: resolve(this.#options.bundle?.entry ?? "e2e/.build/index.js"),
          inputs: given,
          cwd: context.workspace.view,
          ...base,
          env: { ...env, ...inputEnv, ...(local ? { GITHUB_ACTION_PATH: local } : {}) },
        };
      } else {
        const action = repository
          ? { ...ACTIONS, ...this.#options.actions }[repository]
          : undefined;
        if (!action) {
          throw new Unsupported(
            `${file}: ${step.key}.uses: ${uses} is not an action the simulator emulates`,
          );
        }
        try {
          const result = await action({
            inputs,
            step: context.info,
            github: this.#github,
            job: {
              ...context.action,
              workspace: context.workspace,
              toHost: context.toHost,
              codeman: context.codeman,
            },
            log,
            mask: (value) => {
              if (value && !this.#options.unmasked?.includes(value)) context.masks.add(value);
            },
          });
          outputs = result.outputs ?? {};
          if (result.post) context.posts.push({ name: context.info.name, run: result.post });
          return { outcome: "success", outputs, env: new Map(), paths: [] };
        } catch (error) {
          if (
            error instanceof ActionFailure ||
            error instanceof GitError ||
            error instanceof HttpError
          ) {
            log(`##[error]${error.message}`);
            return { outcome: "failure", outputs: {}, env: new Map(), paths: [] };
          }
          throw error;
        }
      }
    }

    const result: CommandResult = await context.session.exec(command);
    // Masks apply to the whole output here, and the runner never echoes `::add-mask::`.
    const printed = readCommands(result.output);
    for (const mask of printed.masks) {
      if (!this.#options.unmasked?.includes(mask)) context.masks.add(mask);
    }
    for (const line of result.output.split("\n")) {
      if (line !== "" && !line.trim().startsWith("::add-mask::")) log(line);
    }
    for (const message of printed.errors) log(`##[error]${message}`);
    for (const message of printed.warnings) log(`##[warning]${message}`);
    // The runner reads the files after the process, whatever its exit code.
    const fromFiles = readStepFiles(files.host);
    for (const message of fromFiles.errors) log(`##[error]${message}`);
    let outcome: JobResultName = fromFiles.failed ? "failure" : "success";
    if (printed.refused.length > 0) outcome = "failure";
    if (result.timedOut) {
      log(`##[error]The action '${context.info.name}' has timed out.`);
      outcome = "failure";
    } else if (context.signal.aborted) {
      outcome = "cancelled";
    } else if (result.exitCode !== 0) {
      log(`##[error]Process completed with exit code ${result.exitCode}.`);
      outcome = "failure";
    }
    outputs = {
      ...Object.fromEntries(printed.outputs),
      ...Object.fromEntries(fromFiles.outputs),
    };
    return {
      outcome,
      outputs,
      env: fromFiles.env,
      paths: fromFiles.paths,
    };
  }

  /** The inputs of Codeman's `action.yml`, with their defaults. */
  #codemanDefaults(): Map<string, string | undefined> {
    if (this.#actionInputs) return this.#actionInputs;
    const path = resolve(this.#options.bundle?.actionYml ?? "action.yml");
    const parsed = parseYaml(readFileSync(path, "utf8")) as {
      inputs?: Record<string, { default?: unknown } | null>;
    };
    this.#actionInputs = new Map(
      Object.entries(parsed.inputs ?? {}).map(([name, spec]) => [
        name,
        spec?.default === undefined ? undefined : String(spec.default),
      ]),
    );
    return this.#actionInputs;
  }
}

/** A value with every text's expressions evaluated, as `strategy.matrix` takes them. */
function deepEvaluate(value: unknown, contexts: Contexts, at: Scope): unknown {
  if (typeof value === "string") return evaluateValue(value, contexts, at);
  if (Array.isArray(value)) return value.map((item) => deepEvaluate(item, contexts, at));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepEvaluate(item, contexts, at)]),
    );
  }
  return value;
}

/** An input as its declared type gives it to the `inputs` context. */
function typed(type: string, value: unknown): unknown {
  if (type === "boolean") {
    if (value === undefined || value === null || value === "") return false;
    return value === true || String(value).toLowerCase() === "true";
  }
  if (type === "number") {
    if (value === undefined || value === null || value === "") return 0;
    return Number(value);
  }
  return value === undefined || value === null ? "" : toText(value);
}

/** The argv of GitHub's shells for a script file. */
function shellArgv(shell: string | undefined, script: string): string[] {
  const known: Record<string, string> = {
    bash: "bash --noprofile --norc -eo pipefail {0}",
    sh: "sh -e {0}",
    python: "python {0}",
  };
  const template = shell === undefined ? "bash -e {0}" : (known[shell] ?? shell);
  const parts = template.split(/\s+/).filter(Boolean);
  if (!parts.some((part) => part.includes("{0}"))) parts.push("{0}");
  return parts.map((part) => part.replace("{0}", script));
}

function slug(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "job"
  );
}
