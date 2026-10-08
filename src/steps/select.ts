import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { descriptionCommands } from "../commands.ts";
import { type Messages, messages, taskLanguage } from "../i18n/index.ts";
import { inferenceChoice } from "../inference/index.ts";
import type { WorkflowConventions } from "../platform/conventions.ts";
import type { CiRun, Comment, Review } from "../platform/types.ts";
import { IGNORE_FILE, unprotected } from "../policy.ts";
import type { CommandError } from "../problems.ts";
import { applyCommands, type CommandSource, pendingDecisions, type TaskRecord } from "../record.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { Services } from "../services.ts";
import {
  DEFAULTS,
  isSettingName,
  type PartialSettings,
  parseSetting,
  parseSettings,
  type RunConditions,
  resolveRun,
  SETTINGS_FILE,
  type Settings,
  type SettingsLayer,
  SHARED_SETTINGS,
  settingSources,
} from "../settings.ts";
import { STAGE_STATE, type Stage, stageOfState } from "../stages.ts";
import { type State, stateOf } from "../state.ts";
import { decisionsUrl, renderRefused, renderStatus, reportUrl } from "../status.ts";
import { ledgerRunId } from "../store/layout.ts";
import {
  type Action,
  acceptRequest,
  authorizedComments,
  authorizedReviews,
  type Candidate,
  chooseTasks,
  commandsAfter,
  commenters,
  findStatus,
  finishedRuns,
  openedByMaintainer,
  pendingWork,
  type Request,
  replanRequests,
  resumeRequests,
  reviewCommands,
  runHistory,
  type Task,
  type TaskContext,
  type TaskReview,
  taskSettings,
  toTask,
} from "../tasks.ts";
import { oneLine, slugify } from "../text.ts";
import { taskFile } from "./common.ts";

/**
 * Picks the tasks this run works on, up to `parallel-tasks`, and writes each one's context for
 * its jobs, and each run in the ledger. Runs no LLM, so it may hold a token that writes to
 * issues.
 */
export async function select(services: Services): Promise<void> {
  const { runtime, conventions } = services;
  // The backend first: a run that cannot record its runs marks no task (decision 4).
  const ledger = services.ledger("select");
  await ledger.check(runtime);
  const repo = services.platform();
  const ci = services.ci();
  const bot = repo.self();
  const inputs = inputSettings(runtime);
  // An organization's defaults, which the repository's file overrides. Empty when the workflow
  // file is older or the variable is not set.
  const shared = parseSettings(runtime.input("settings"), SHARED_SETTINGS);
  if (!shared.ok) throw new Error(shared.error);
  // Rules and settings come from the default branch, where the agent cannot change them.
  const defaultBranch = await repo.defaultBranch();
  const settingsText = await repo.readFile(defaultBranch, SETTINGS_FILE);
  const fileSettings =
    settingsText === undefined ? { ok: true as const, value: {} } : parseSettings(settingsText);
  if (!fileSettings.ok) throw new Error(fileSettings.error);
  const ignore = (await repo.readFile(defaultBranch, IGNORE_FILE)) ?? null;
  await warnUnprotected(runtime, conventions.workflows, ignore);

  const tasks = (await repo.listOptedIn()).map(toTask).filter((task) => task.kind === "issue");
  runtime.info(`Found ${tasks.length} open issue(s) labeled "codeman".`);

  // Permission per user, asked once per run.
  const permissions = new Map<string, Promise<boolean>>();
  const maintainersAmong = async (logins: readonly string[]): Promise<Set<string>> => {
    for (const login of logins) {
      if (!permissions.has(login)) permissions.set(login, repo.isMaintainer(login));
    }
    const maintainer = await Promise.all(logins.map((login) => permissions.get(login)));
    return new Set(logins.filter((_, index) => maintainer[index]));
  };

  // Everything maintainers said about a task: on the issue and on its pull request.
  const conversations = new Map<number, Promise<Conversation>>();
  const conversation = (number: number): Promise<Conversation> => {
    let loaded = conversations.get(number);
    if (!loaded) {
      loaded = (async () => {
        const comments = await repo.listComments(number);
        const status = findStatus(comments, bot);
        const pullRequest = status?.record?.pullRequest;
        const reviews = pullRequest ? await repo.listReviews(pullRequest) : [];
        if (pullRequest) comments.push(...(await repo.listChangeRequestComments(pullRequest)));
        const maintainers = await maintainersAmong(commenters([...comments, ...reviews]));
        return { comments, reviews, status, maintainers };
      })();
      conversations.set(number, loaded);
    }
    return loaded;
  };
  const newCommands = (talk: Conversation, reviews: readonly TaskReview[]): CommandSource[] => {
    const record = talk.status?.record;
    if (!record) return [];
    return [
      ...commandsAfter(
        authorizedComments(talk.comments, talk.maintainers),
        record.processedCommentId,
      ),
      ...reviewCommands(reviews),
    ];
  };

  // Only issues opened by maintainers are tasks. Others get a panel that says why, written once.
  const authors = await maintainersAmong([
    ...new Set(tasks.flatMap((task) => (task.author ? [task.author] : []))),
  ]);
  const refuse = async (task: Task): Promise<void> => {
    const talk = await conversation(task.number);
    const record = talk.status?.record;
    const language =
      taskSettings(authorizedComments(talk.comments, talk.maintainers)).language ??
      fileSettings.value.language ??
      shared.value.language ??
      "auto";
    const body = renderRefused(messages(taskLanguage(language, record?.language)), record);
    if (talk.status?.body !== body) {
      await repo.upsertComment(task.number, talk.status?.id ?? null, body);
    }
  };

  // Finished runs of the workflows each waiting task asked for.
  const workflowRuns = new Map<number, CiRun[]>();

  const candidates: Candidate[] = [];
  for (const task of tasks) {
    const line = `#${task.number} ${oneLine(task.title)}`;
    if (!openedByMaintainer(task, authors)) {
      runtime.warning(`${line}: not opened by a maintainer, so it is not a task. Left alone.`);
      await refuse(task);
      continue;
    }
    const result = stateOf(task.labels);
    if (!result.ok) {
      runtime.warning(`${line}: ${result.error}`);
      continue;
    }
    const candidate: Candidate = { number: task.number, state: result.state };
    if (result.state !== "new" && result.state !== "planning") {
      const talk = await conversation(task.number);
      const record = talk.status?.record;
      if (record) {
        const reviews = authorizedReviews(
          talk.reviews,
          [],
          talk.maintainers,
          record.processedReviewId ?? 0,
        );
        candidate.pending = pendingWork(newCommands(talk, reviews), result.state);
        candidate.planned = pendingDecisions(record).length === 0;
        candidate.accept =
          acceptRequest(
            authorizedComments(talk.comments, talk.maintainers),
            record.acceptedCommentId ?? 0,
          ) !== undefined;
        if (result.state === "awaiting-workflow" && record.awaiting?.length) {
          const head = await repo.branchSha(record.branch);
          const runs = head
            ? finishedRuns(await ci.runsForCommit(head), record.awaiting)
            : undefined;
          if (runs) workflowRuns.set(task.number, runs);
          candidate.workflowsDone = runs !== undefined;
        }
      }
    }
    candidates.push(candidate);
    runtime.info(`${line} [${result.state}]${candidate.pending ? ` (${candidate.pending})` : ""}`);
  }

  const parallel = firstSet([inputs, fileSettings.value, shared.value], "parallel-tasks");
  const choices = chooseTasks(candidates, parallel ?? DEFAULTS["parallel-tasks"]);
  if (choices.length === 0) {
    runtime.output("action", "none");
    runtime.info("Nothing to do.");
    return;
  }
  // A profile may depend on how many of the run's tasks run an agent at once.
  const agents = choices.filter((choice) => runsAgent(choice.action)).length;
  if (choices.length > 1) {
    const list = choices.map((choice) => `#${choice.number} (${choice.action})`).join(", ");
    runtime.info(`Picked ${choices.length} tasks, of up to ${parallel}: ${list}.`);
  }

  /** Reads one picked task and resolves its settings; `start` marks it as started. */
  const prepare = async (choice: { number: number; action: Action }): Promise<Picked> => {
    const task = tasks.find((candidate) => candidate.number === choice.number);
    if (!task) throw new Error(`Task #${choice.number} disappeared.`);
    const pending = candidates.find((candidate) => candidate.number === task.number)?.pending;
    const talk = await conversation(task.number);
    const record = talk.status?.record;
    const maintainerComments = authorizedComments(talk.comments, talk.maintainers).sort(
      (a, b) => a.id - b.id,
    );
    const reviewComments = record?.pullRequest
      ? await repo.listReviewComments(record.pullRequest)
      : [];
    const reviews = authorizedReviews(
      talk.reviews,
      reviewComments,
      talk.maintainers,
      record?.processedReviewId ?? 0,
    );
    const sources = newCommands(talk, reviews);
    // A new plan keeps the answers given so far and says what to change.
    const replan = choice.action === "plan" ? replanRequests(sources) : [];
    const settled =
      choice.action === "plan" && record
        ? applyCommands(record, sources).record.decisions.filter((decision) => decision.answer)
        : [];
    const resume = pending === "resume";
    const newRequests = choice.action === "implement" ? resumeRequests(sources) : [];
    const route =
      choice.action === "implement" ? routing(task.labels, record, newRequests) : undefined;
    const action = route ? "route" : choice.action;
    // A route's stages read the requests its router handled, then any newer ones.
    const window = action === "implement" ? record?.route?.requests : undefined;
    const windowReviews = window
      ? authorizedReviews(
          talk.reviews,
          reviewComments,
          talk.maintainers,
          window.after.reviewId,
        ).filter((review) => review.id <= window.upTo.reviewId)
      : [];
    const windowSources = window
      ? [
          ...commandsAfter(maintainerComments, window.after.commentId).filter(
            (source) => source.commentId <= window.upTo.commentId,
          ),
          ...reviewCommands(windowReviews),
        ]
      : [];
    const requests = [...resumeRequests(windowSources), ...newRequests];
    // Without a route, a stage goes on where the task was.
    const stage: Stage | undefined =
      action !== "implement"
        ? undefined
        : (record?.stage ?? stageOfState(fromStateOf(task.labels)) ?? firstStage(task.labels));
    // Settings may also come from the description, which the agent reads without command lines.
    const description = descriptionCommands(task.body);
    // Problems in the description are reported in every run, until a maintainer fixes them.
    const problems: CommandError[] = [
      ...description.commands,
      ...sources.map(({ command }) => command),
    ].flatMap((command) =>
      command.kind === "invalid" ? [{ text: command.text, problem: command.problem }] : [],
    );
    const fromState = stateOf(task.labels);
    if (!fromState.ok) throw new Error(fromState.error);

    const slug = slugify(task.title);
    const branch = record?.branch ?? `codeman/${task.number}-${slug}`;
    const branchSha = await repo.branchSha(branch);
    const baseSha = branchSha ?? (await repo.branchSha(defaultBranch));
    if (!baseSha) throw new Error(`Branch ${defaultBranch} not found.`);
    let own = taskSettings(maintainerComments, description.commands);
    const below = [inputs, fileSettings.value, shared.value];
    // The profile depends on what the agent works on, and on how many agents the run has.
    const agentWork = action === "plan" || action === "route" ? action : stage;
    const runConditions: RunConditions | undefined = agentWork
      ? { stage: agentWork, tasks: agents }
      : undefined;
    let resolved = resolveRun([own, ...below], runConditions);
    if (!resolved.ok && (own.model !== undefined || own.gpu !== undefined)) {
      // A task's model or GPU that does not fit the run's provider stops this task only: the run
      // goes on without them, and says why.
      const { model: _model, gpu: _gpu, ...rest } = own;
      const fallback = resolveRun([rest, ...below], runConditions);
      if (fallback.ok) {
        problems.push({ problem: { kind: "settings-rejected", error: resolved.error } });
        resolved = fallback;
        own = rest;
      }
    }
    if (!resolved.ok) throw new Error(resolved.error);
    for (const line of settingSources([own, ...below])) runtime.info(line);
    const { profile, accounts } = resolved.value;
    const settings = resolved.value.settings;
    if (profile) runtime.info(`Profile \`${profile}\` applies to this run.`);
    const model = settings.model;

    const context: TaskContext = {
      version: 1,
      action,
      owner: repo.repository.owner,
      repo: repo.repository.name,
      number: task.number,
      title: task.title,
      body: description.text,
      url: task.url,
      comments: maintainerComments,
      reviews: [...windowReviews, ...reviews],
      requests,
      resume,
      accept:
        choice.action === "accept"
          ? acceptRequest(maintainerComments, record?.acceptedCommentId ?? 0)
          : undefined,
      workflowRuns: action === "implement" ? workflowRuns.get(task.number) : undefined,
      history: action === "implement" || route ? runHistory(talk.comments, bot) : undefined,
      stage,
      route,
      processed: {
        commentId: Math.max(
          record?.processedCommentId ?? 0,
          ...maintainerComments.map((comment) => comment.id),
        ),
        reviewId: Math.max(record?.processedReviewId ?? 0, ...reviews.map((review) => review.id)),
      },
      problems,
      fromState: fromState.state,
      model,
      settings,
      ignore,
      defaultBranch,
      branch,
      branchExists: branchSha !== undefined,
      baseSha,
      planPath:
        record?.planPath ?? `docs/plans/${new Date().toISOString().slice(0, 10)}-${slug}.md`,
      record: record ?? null,
      replan,
      settled,
      statusCommentId: talk.status?.id ?? null,
      runUrl: runtime.run.url,
    };

    const needsAgent = action === "plan" || action === "route" || action === "implement";
    /** Marks the task as started, and writes its context for its jobs. */
    const start = async (): Promise<void> => {
      if (needsAgent) {
        const t = messages(taskLanguage(settings.language, record?.language));
        const state = stage ? STAGE_STATE[stage] : route ? "routing" : "planning";
        await repo.setState(task.number, task.labels, state);
        context.statusCommentId = await repo.upsertComment(
          task.number,
          context.statusCommentId,
          renderStatus({
            t,
            conventions,
            state,
            record,
            model,
            runUrl: context.runUrl,
            message: startMessage(t, context),
            cost: { task: record?.spent, budget: settings["task-budget"] },
            reportUrl: reportUrl(record, (id) => repo.commentUrl(task.url, id)),
            decisionsUrl: decisionsUrl(record, (id) => repo.commentUrl(task.url, id)),
          }),
        );
      }
      mkdirSync(dirname(taskFile(runtime, task.number)), { recursive: true });
      writeFileSync(taskFile(runtime, task.number), JSON.stringify(context, null, 2));
    };
    runtime.info(`Selected #${task.number} to ${action}, with model ${model}.`);
    return {
      number: task.number,
      action,
      needsAgent,
      stage: stage ?? (action === "plan" || action === "route" ? action : ""),
      baseSha,
      model,
      settings,
      record: record ?? null,
      profile,
      accounts,
      context,
      start,
    };
  };

  // Every task first, so that a task whose settings stop the run leaves the others unmarked.
  const picked: Picked[] = [];
  for (const choice of choices) picked.push(await prepare(choice));
  for (const one of picked) await one.start();
  const runOf = (one: Picked) => ledgerRunId(runtime.run.id, runtime.run.attempt, one.number);
  const outputs = picked.map((one) => taskOutputs(one, runOf(one)));
  // The jobs of each task, a leg of the run's matrix, take its outputs from this list.
  runtime.output("tasks", JSON.stringify(outputs));
  // The first task's, as one output each, and its context as `task.json`, for workflow files
  // from before parallel tasks.
  const [first] = outputs;
  const [firstPicked] = picked;
  if (first && firstPicked) {
    for (const [name, value] of Object.entries(first)) runtime.output(name, value);
    runtime.output("model", firstPicked.model);
    writeFileSync(taskFile(runtime), JSON.stringify(firstPicked.context, null, 2));
  }
  // After GitHub's writes: a ledger that fails fails the job, and its tasks run nothing.
  for (const one of picked) {
    ledger.pick(runOf(one), {
      action: one.action,
      stage: one.stage,
      agent: one.needsAgent,
      model: one.model,
      provider: one.settings.provider,
      profile: one.profile,
    });
  }
  await ledger.flush(runtime);
}

/** A task `select` picked, as its jobs need it. */
interface Picked {
  number: number;
  action: TaskContext["action"];
  needsAgent: boolean;
  /** What the agent works on: `plan`, `route` or a stage; empty without an agent. */
  stage: string;
  baseSha: string;
  model: string;
  settings: Settings;
  record: TaskRecord | null;
  profile: string | undefined;
  /** The account of every provider the settings name. */
  accounts: string[];
  context: TaskContext;
  start: () => Promise<void>;
}

/**
 * A task's outputs, which its jobs read from the `tasks` list. The run's tasks open their keys at
 * once; Codeman's ledger keeps them within the budgets together.
 */
function taskOutputs(task: Picked, run: string): Record<string, string> {
  const choice = inferenceChoice(task.settings, task.record, {
    profile: task.profile,
    accounts: task.accounts,
  });
  return {
    task: String(task.number),
    action: task.action,
    "needs-agent": String(task.needsAgent),
    stage: task.stage,
    "base-sha": task.baseSha,
    "task-budget": String(task.settings["task-budget"]),
    "monthly-budget": String(task.settings["monthly-budget"]),
    // Only the organization's settings set it; empty when they do not.
    "organization-monthly-budget": String(task.settings["organization-monthly-budget"] ?? ""),
    inference: JSON.stringify(choice),
    // The run's document in the ledger, which the key jobs add to; none without an agent.
    "ledger-run": task.needsAgent ? run : "",
  };
}

/** Whether an action runs the agent: all but recording answers and accepting workflows. */
function runsAgent(action: Action): boolean {
  return action !== "record" && action !== "accept";
}

/** A value of the first layer that sets it. */
function firstSet<Name extends keyof SettingsLayer>(
  layers: readonly SettingsLayer[],
  name: Name,
): SettingsLayer[Name] | undefined {
  return layers.find((layer) => layer[name] !== undefined)?.[name];
}

/**
 * Whether the routing agent runs instead of a stage, and why: after decisions are answered (or
 * a plan has none), which leaves the task ready; after a `fix` request, or review asking for
 * changes, which leaves it routing; and on `continue` after the router blocked the task. The
 * fallback is the first stage of the fixed order, for when its result cannot be used.
 */
export function routing(
  labels: readonly string[],
  record: TaskRecord | undefined,
  requests: readonly Request[],
): TaskContext["route"] {
  const state = fromStateOf(labels);
  if (requests.some((request) => request.kind === "fix")) {
    return { trigger: "fix", fallback: "code" };
  }
  if (record?.route?.stages.length === 0) {
    return { trigger: "continue", fallback: record.stage ?? "design" };
  }
  if (state === "routing" && record?.handoff?.stage === "review") {
    return { trigger: "changes", fallback: "code" };
  }
  if (state === "ready" || state === "routing") {
    return { trigger: "decisions", fallback: record?.stage ?? "design" };
  }
  return undefined;
}

/** Where work starts without a recorded stage: design, or code once a task was done. */
function firstStage(labels: readonly string[]): Stage {
  return fromStateOf(labels) === "done" ? "code" : "design";
}

function fromStateOf(labels: readonly string[]): State | "new" {
  const result = stateOf(labels);
  return result.ok ? result.state : "new";
}

interface Conversation {
  comments: Comment[];
  reviews: Review[];
  status: ReturnType<typeof findStatus>;
  maintainers: Set<string>;
}

function startMessage(t: Messages, task: TaskContext): string {
  if (task.action === "route") return t.startRoute;
  if (task.action === "implement") {
    if (task.workflowRuns?.length) return t.startWithWorkflowResults;
    if (task.requests.some((request) => request.kind === "fix") || task.reviews.length > 0) {
      return t.startWithChanges;
    }
    return task.resume ? t.startContinue : t.startStage(task.stage ?? "code");
  }
  return t.startPlan(task.replan.length > 0);
}

/** Settings given as workflow inputs. Empty inputs fall back to the settings file. */
function inputSettings(runtime: Runtime): PartialSettings {
  const settings: PartialSettings = {};
  for (const name of ["model", "task-budget", "monthly-budget", "max-runs"]) {
    const text = runtime.input(name);
    if (text === "" || !isSettingName(name)) continue;
    const parsed = parseSetting(name, text);
    if (!parsed.ok) throw new Error(`Input ${parsed.error}`);
    Object.assign(settings, { [name]: parsed.value });
  }
  return settings;
}

/** Warns about each path Codeman proposes to protect that the repository's rules allow. */
async function warnUnprotected(
  runtime: Runtime,
  workflows: WorkflowConventions,
  ignore: string | null,
): Promise<void> {
  if (ignore === null) {
    runtime.info(
      `The repository has no ${IGNORE_FILE}; Codeman uses its own and proposes it in the next pull request.`,
    );
    return;
  }
  const paths = unprotected(ignore, workflows);
  for (const path of paths) {
    runtime.warning(
      `${IGNORE_FILE} lets the agent change ${oneLine(path)}, which Codeman proposes to protect.`,
    );
  }
  if (paths.length > 0) {
    await runtime.summary(
      "Paths the agent may change",
      `${IGNORE_FILE} does not protect these paths, which Codeman proposes to protect:`,
      paths,
    );
  }
}
