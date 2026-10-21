import type { Permissions } from "../../fakes/github/auth.ts";
import type { Role } from "../../fakes/github/world.ts";
import type { Script } from "../../fakes/llm/script.ts";
import type { CatalogGpu } from "../../fakes/runpod/catalog.ts";
import type { EndpointSetup } from "../../fakes/runpod/serverless.ts";

/**
 * A scenario of the e2e suite, as `load.ts` reads it from a YAML file under `e2e/scenarios/`
 * (docs/plans/2026-10-20-end-to-end-test-suite.md, "Scenario schema, sketched"). The file's keys
 * are kebab-case; these types are what the validator makes of them. Durations are milliseconds,
 * written in the file as `500ms`, `90s`, `25m`, `2h` or `1d`.
 */
export interface Scenario {
  /** The file it was read from, as given to the loader. */
  file: string;
  /** Its path under `e2e/scenarios/` without `.yaml`, such as `happy-path/openrouter-to-done`. */
  id: string;
  name: string;
  tags: string[];
  /** `simulator` by default. */
  runner: Runner;
  /** The Compose profiles it needs, beyond the services every scenario has. */
  profiles: Profile[];
  /** The whole scenario's time limit: 15 minutes by default. */
  timeoutMs: number;
  world: World;
  agent: Agent;
  actions: Action[];
}

export const RUNNERS = ["simulator", "act"] as const;
export type Runner = (typeof RUNNERS)[number];

export const PROFILES = ["ollama", "vllm"] as const;
export type Profile = (typeof PROFILES)[number];

// The world

export interface World {
  /** Every user the scenario names, declared or implied by an organization or repository. */
  users: string[];
  organizations: Organization[];
  repositories: Repository[];
  app: App;
  runpod: RunpodWorld | undefined;
  openrouter: OpenRouterWorld | undefined;
}

/** The provider secrets the templates pass, by their short name in the scenario. */
export const PROVIDER_SECRETS = {
  openrouter: "CODEMAN_OPENROUTER_MANAGEMENT_KEY",
  runpod: "CODEMAN_RUNPOD_API_KEY",
  "runpod-serverless": "CODEMAN_RUNPOD_SERVERLESS_KEY",
} as const;
export type ProviderSecret = keyof typeof PROVIDER_SECRETS;

export interface Organization {
  name: string;
  owners: string[];
  members: string[];
  /** `CODEMAN_SETTINGS`, in the settings file's format; undefined when unset. */
  settings: string | undefined;
  /** Other organization variables, such as `CODEMAN_COMMIT_SHA`. */
  variables: Record<string, string>;
  /** Undefined: every provider's secret. */
  secrets: ProviderSecret[] | undefined;
}

export interface Repository {
  /** `owner/name`. An owner that is no declared organization is a user account. */
  name: string;
  owner: string;
  /** The fixture's directory, resolved: `e2e/fixtures/<fixture>`. */
  fixture: string;
  /** Users with the `maintain` role. */
  maintainers: string[];
  /** Other collaborators, with their role. */
  collaborators: Record<string, Role>;
  private: boolean;
  /** False as on a plan without draft pull requests. */
  drafts: boolean;
  /** The repository's `CODEMAN_SETTINGS`, which replaces the organization's whole. */
  settings: string | undefined;
  variables: Record<string, string>;
  /** Undefined: the organization's, or every provider's for a user account. */
  secrets: ProviderSecret[] | undefined;
}

/** The repository's provider secrets: its own, else its organization's, else every one. */
export function secretsOf(world: World, repository: Repository): ProviderSecret[] {
  const organization = world.organizations.find((one) => one.name === repository.owner);
  return (
    repository.secrets ??
    organization?.secrets ??
    (Object.keys(PROVIDER_SECRETS) as ProviderSecret[])
  );
}

export interface App {
  slug: string;
  /** Undefined: one per repository owner, for all its repositories, with Codeman's permissions. */
  installations: Installation[] | undefined;
}

export interface Installation {
  owner: string;
  /** Repository names under the owner, or all of them. */
  repositories: string[] | "all";
  /** Undefined: Codeman's documented permissions. */
  permissions: Permissions | undefined;
}

/** The fake Runpod's setup, in the fake's own shapes (catalog.ts, serverless.ts). */
export interface RunpodWorld {
  catalog: CatalogGpu[] | undefined;
  endpoints: EndpointSetup[];
}

/** The fake OpenRouter's setup; a lag of null holds until settled. */
export interface OpenRouterWorld {
  credits: number | undefined;
  prices: { prompt: number; completion: number } | undefined;
  lags: Lags | undefined;
}

export interface Lags {
  usageMs?: number | null;
  analyticsMs?: number | null;
}

// The agent

export interface Agent {
  /** The `agent:` section as written, for the scripted model's control API. */
  source: Record<string, unknown>;
  /** As the scripted model reads it (e2e/fakes/llm/script.ts). */
  script: Script;
}

// Actions

export type Action =
  | OpenIssue
  | Comment
  | Label
  | Review
  | IssueState
  | Push
  | SetVariable
  | Seed
  | RunWorkflow
  | Advance
  | Parallel
  | Fault
  | Apply
  | Wait
  | Expect;

export const ACTION_KINDS = [
  "open-issue",
  "comment",
  "label",
  "unlabel",
  "review",
  "close",
  "reopen",
  "push",
  "set-variable",
  "seed",
  "run",
  "advance",
  "parallel",
  "fault",
  "apply",
  "wait",
  "expect",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What every action of a user on the fake GitHub has. */
interface UserAction {
  /** The user who acts. */
  as: string;
  /** `owner/name`. */
  repo: string;
}

export interface OpenIssue extends UserAction {
  kind: "open-issue";
  /** Names the issue for later actions and the agent's script. */
  ref: string;
  title: string;
  body: string;
  labels: string[];
}

/** An issue by its ref, or the pull request of the task that ref names. */
export interface Target {
  issue: string;
  pull: boolean;
}

export interface Comment extends UserAction, Target {
  kind: "comment";
  body: string;
}

export interface Label extends UserAction, Target {
  kind: "label" | "unlabel";
  label: string;
}

export interface Review extends UserAction {
  kind: "review";
  /** The ref of the task whose pull request is reviewed. */
  pull: string;
  state: "approve" | "request-changes" | "comment";
  body: string | undefined;
  comments: { path: string; line: number | undefined; body: string }[];
}

export interface IssueState extends UserAction, Target {
  kind: "close" | "reopen";
}

export interface Push extends UserAction {
  kind: "push";
  /** A branch by name, or the branch of the task a ref names. */
  branch: { name: string } | { task: string };
  /** Contents by path; null deletes the file. */
  files: Record<string, string | null>;
  message: string | undefined;
  base: string | undefined;
  force: boolean;
}

export interface SetVariable {
  kind: "set-variable";
  /** An organization's variable, or a repository's. */
  scope: { org: string } | { repo: string };
  /** `CODEMAN_SETTINGS` by default. */
  name: string;
  /** Null deletes it. */
  value: string | null;
}

export interface Seed {
  kind: "seed";
  /** A document's path in the store, such as `pools/acme/pods/n1`. */
  doc: string;
  /** How long ago the document was written. */
  ageMs: number;
  /** Fields, with `now`, `now-<duration>` and `now+<duration>` turned into `RelativeTime`s. */
  data: Record<string, unknown>;
}

/** A time relative to when the action runs: `now-45m` written `45m` ago is `-90m` here. */
export class RelativeTime {
  readonly offsetMs: number;

  constructor(offsetMs: number) {
    this.offsetMs = offsetMs;
  }

  at(now: number): Date {
    return new Date(now + this.offsetMs);
  }
}

/** The events that start Codeman's workflow, as `<event>.<action>`. */
export const EVENTS = [
  "issues.labeled",
  "issues.unlabeled",
  "issues.closed",
  "issues.reopened",
  "issue_comment.created",
  "pull_request_review.submitted",
  "schedule",
  "workflow_dispatch",
] as const;
export type WorkflowEvent = (typeof EVENTS)[number];

/** The inputs of the workflow's manual run (templates/codeman.yml). */
export const DISPATCH_INPUTS = ["model", "task-budget", "monthly-budget", "max-runs", "batch"];

export interface RunWorkflow {
  kind: "run";
  repo: string;
  /** The last such event on the repository; `schedule` and `workflow_dispatch` make their own. */
  event: WorkflowEvent;
  inputs: Record<string, string>;
  /**
   * The runs its chain may start, beyond the first: the dispatches and the App's events since it
   * began, which GitHub runs at once (`RUN_CHAIN_RUNS` by default).
   */
  maxRuns: number;
}

/** How many runs a `run`'s chain may start by default. */
export const RUN_CHAIN_RUNS = 10;

export interface Advance {
  kind: "advance";
  repo: string;
  /**
   * Runs the repository's events not run yet, then follows `next-run` and `dispatch`, until this
   * holds.
   */
  until: Expectation;
  /** Fails when it still does not hold after so many runs. */
  maxRuns: number;
}

export interface Parallel {
  kind: "parallel";
  branches: Action[][];
}

export const FAKES = [
  "github",
  "openrouter",
  "runpod",
  "google",
  "llm",
  "npm",
  "huggingface",
] as const;
export type FakeName = (typeof FAKES)[number];

/** The template's jobs (templates/codeman.yml and codeman-task.yml). */
export const JOBS = [
  "forward-review",
  "select",
  "dispatch",
  "task",
  "next-run",
  "open-key",
  "agent",
  "close-key",
  "apply",
  "release-pod",
] as const;
export type JobName = (typeof JOBS)[number];

export type Fault =
  /** The shared fault of e2e/fakes/http.ts on a fake's route. */
  | { kind: "fault"; target: "http"; fake: FakeName; http: HttpFault }
  /** `podStart: never` is a pod that never serves; `lowBalance` makes pod creation answer 402. */
  | {
      kind: "fault";
      target: "runpod";
      runpod: {
        podStart?: "never" | "fail";
        lowBalance?: boolean;
        holdQueues?: boolean | string[];
      };
    }
  | {
      kind: "fault";
      target: "google";
      google: {
        refuseRepositories?: string[];
        disabledAccounts?: string[];
        expirySeconds?: number;
      };
    }
  | { kind: "fault"; target: "openrouter"; openrouter: { lags: Lags } }
  /** The fake Runpod's turn on a pod a ref names. */
  | { kind: "fault"; target: "pod"; pod: string; action: "restart" | "exit" | "fail" }
  /** A job ends with this conclusion instead of running, for one task or all. */
  | {
      kind: "fault";
      target: "job";
      job: JobName;
      issue: string | undefined;
      conclusion: "failure" | "cancelled";
      times: number | undefined;
    }
  | { kind: "fault"; target: "firestore"; down: boolean }
  /** Clears the faults of these fakes. */
  | { kind: "fault"; target: "clear"; fakes: FakeName[] };

export interface HttpFault {
  method: string | undefined;
  path: string;
  status: number | undefined;
  body: unknown;
  delayMs: number | undefined;
  drop: boolean;
  times: number | undefined;
}

export interface Apply {
  kind: "apply";
  /** `skip` cancels the `apply` job, `fail` fails it. */
  mode: "skip" | "fail";
  /** Every task's when undefined. */
  issue: string | undefined;
}

export interface Wait {
  kind: "wait";
  until: Expectation;
  timeoutMs: number;
}

export interface Expect extends Expectation {
  kind: "expect";
}

// Expectations: what `expect` checks, and what `wait` and `advance` wait for.

/**
 * Checks that all hold. `labels`, `comments`, `commits` and `pullRequest` are the issue's, which
 * `issue` names; `ledger` is the issue's task, or every run without it.
 */
export interface Expectation {
  issue: string | undefined;
  /** Each is on the issue. */
  labels: string[] | undefined;
  /** None is on the issue. */
  noLabels: string[] | undefined;
  comments: CommentMatch[] | undefined;
  commits: CommitMatch | undefined;
  pullRequest: PullRequestMatch | "none" | undefined;
  store: StoreMatch[] | undefined;
  ledger: LedgerMatch | undefined;
  fakes: FakeMatch[] | undefined;
  pods: PodMatch[] | undefined;
  engine: EngineMatch | undefined;
  /** No fake recorded a violation: a token it did not give, a turn no script covered… */
  violations: "none" | undefined;
}

/** Codeman's comments by their marker (src/status.ts, src/record.ts), or any comment. */
export const COMMENT_KINDS = ["status", "decisions", "run", "any"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export interface CommentMatch {
  kind: CommentKind;
  /** Texts the comment's body holds, all of them. */
  contains: string[];
  /** The comment's author. */
  by: string | undefined;
  /** How many comments match: at least one when undefined. */
  count: Pattern | undefined;
}

export interface CommitMatch {
  /** The task's branch when undefined. */
  branch: string | undefined;
  /** Commits on the branch beyond the default branch. */
  count: Pattern | undefined;
  /** Paths the branch adds or changes, against the default branch. */
  files: string[];
  /** Paths it must not hold. */
  noFiles: string[];
  /** Text a commit's message holds. */
  message: string | undefined;
}

export interface PullRequestMatch {
  ready: boolean | undefined;
  state: "open" | "closed" | undefined;
  /** Paths the pull request changes. */
  files: string[];
}

export type StoreMatch =
  | { doc: string; absent: boolean; fields: Record<string, Pattern> | undefined }
  | { collection: string; where: Record<string, Pattern> | undefined; count: Pattern | undefined };

export interface LedgerMatch {
  /** In USD, the sum of the runs' `cost`. */
  costAtMost: number | undefined;
  costAtLeast: number | undefined;
  runs: Pattern | undefined;
  /**
   * A Serverless endpoint's ID: the runs that used its worker split its time, as
   * docs/inference/serverless.md says: they overlapped, each closed run counts its share, and the
   * shares add up to the worker's billed time, not to the runs' own estimates.
   */
  splitOn: string | undefined;
}

/** The lists each fake's state has, from its control API. */
export const FAKE_LISTS: Readonly<Record<FakeName, readonly string[]>> = {
  github: ["events", "dispatches", "violations", "requests"],
  openrouter: ["keys", "generations", "requests"],
  runpod: ["jobs", "requests"],
  google: ["requests"],
  llm: ["turns", "violations", "requests"],
  npm: ["requests"],
  huggingface: ["requests"],
};

export interface FakeMatch {
  fake: FakeName;
  list: string;
  where: Record<string, Pattern> | undefined;
  /** At least one when undefined. */
  count: Pattern | undefined;
}

/** The fake Runpod's pods. `ref` names the one that matches; `pod` checks one named before. */
export interface PodMatch {
  ref: string | undefined;
  pod: string | undefined;
  status: string | undefined;
  where: Record<string, Pattern> | undefined;
  /** Without `ref` or `pod`: how many match, at least one when undefined. */
  count: Pattern | undefined;
}

/**
 * A pod's engine, read inside its container (expect.ts, session.ts): each field holds at least
 * these fields.
 */
export interface EngineMatch {
  /** The pod's ref; the only live pod when undefined. */
  pod: string | undefined;
  /** The gateway's `/admin/status`, with the pod's admin token. */
  gateway: Record<string, Pattern> | undefined;
  /** Ollama's `/api/ps`, through the tee. */
  ollama: Record<string, Pattern> | undefined;
  /**
   * vLLM's first model of `/v1/models`, such as `max_model_len`, and `metrics`, its `/metrics` by
   * sample (`vllmMetrics` in expect.ts).
   */
  vllm: Record<string, Pattern> | undefined;
}

/**
 * What a value must be: equal to a scalar; within a range (`{ at-least, at-most }`); an object
 * holding at least these fields; or a list of exactly these items, in order.
 */
export type Pattern =
  | { kind: "equals"; value: string | number | boolean | null }
  | { kind: "range"; atLeast: number | undefined; atMost: number | undefined }
  | { kind: "object"; fields: Record<string, Pattern> }
  | { kind: "list"; items: Pattern[] };
