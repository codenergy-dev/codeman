import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as core from "@actions/core";
import { type Messages, messages, taskLanguage } from "../i18n/index.ts";
import { IGNORE_FILE, unprotected } from "../policy.ts";
import { applyCommands, type CommandSource, pendingDecisions } from "../record.ts";
import {
  isSettingName,
  type PartialSettings,
  parseSetting,
  parseSettings,
  resolveSettings,
  SETTINGS_FILE,
} from "../settings.ts";
import { STAGE_STATE, type Stage, stageOfState } from "../stages.ts";
import { type State, stateOf } from "../state.ts";
import { renderRefused, renderStatus, reportUrl } from "../status.ts";
import {
  acceptRequest,
  authorizedComments,
  authorizedReviews,
  type Candidate,
  type CommentLike,
  chooseTask,
  commandsAfter,
  commenters,
  findStatus,
  finishedRuns,
  MAINTAINER_PERMISSIONS,
  openedByMaintainer,
  pendingWork,
  type ReviewLike,
  replanRequests,
  resumeRequests,
  reviewCommands,
  runHistory,
  type Task,
  type TaskContext,
  type TaskReview,
  taskSettings,
  toTask,
  type WorkflowRun,
} from "../tasks.ts";
import { oneLine, slugify } from "../text.ts";
import { repository, runUrl, taskFile } from "./common.ts";

/**
 * Picks the one task this run works on and writes its context for the next jobs. Runs no LLM,
 * so it may hold a token that writes to issues.
 */
export async function select(): Promise<void> {
  const repo = repository();
  const bot = `${core.getInput("app-slug", { required: true })}[bot]`;
  const inputs = inputSettings();
  // Rules and settings come from the default branch, where the agent cannot change them.
  const defaultBranch = await repo.defaultBranch();
  const settingsText = await repo.readFile(defaultBranch, SETTINGS_FILE);
  const fileSettings =
    settingsText === undefined ? { ok: true as const, value: {} } : parseSettings(settingsText);
  if (!fileSettings.ok) throw new Error(fileSettings.error);
  const ignore = (await repo.readFile(defaultBranch, IGNORE_FILE)) ?? null;
  await warnUnprotected(ignore);

  const tasks = (await repo.listOptedIn()).map(toTask).filter((task) => task.kind === "issue");
  core.info(`Found ${tasks.length} open issue(s) labeled "codeman".`);

  // Permission per user, asked once per run.
  const permissions = new Map<string, Promise<string>>();
  const maintainersAmong = async (logins: readonly string[]): Promise<Set<string>> => {
    for (const login of logins) {
      if (!permissions.has(login)) permissions.set(login, repo.permission(login));
    }
    const levels = await Promise.all(logins.map((login) => permissions.get(login)));
    return new Set(logins.filter((_, index) => MAINTAINER_PERMISSIONS.has(levels[index] ?? "")));
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
        if (pullRequest) comments.push(...(await repo.listComments(pullRequest)));
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
      "auto";
    const body = renderRefused(messages(taskLanguage(language, record?.language)), record);
    if (talk.status?.body !== body) {
      await repo.upsertComment(task.number, talk.status?.id ?? null, body);
    }
  };

  // Finished runs of the workflows each waiting task asked for.
  const workflowRuns = new Map<number, WorkflowRun[]>();

  const candidates: Candidate[] = [];
  for (const task of tasks) {
    const line = `#${task.number} ${oneLine(task.title)}`;
    if (!openedByMaintainer(task, authors)) {
      core.warning(`${line}: not opened by a maintainer, so it is not a task. Left alone.`);
      await refuse(task);
      continue;
    }
    const result = stateOf(task.labels);
    if (!result.ok) {
      core.warning(`${line}: ${result.error}`);
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
            ? finishedRuns(await repo.runsForCommit(head), record.awaiting)
            : undefined;
          if (runs) workflowRuns.set(task.number, runs);
          candidate.workflowsDone = runs !== undefined;
        }
      }
    }
    candidates.push(candidate);
    core.info(`${line} [${result.state}]${candidate.pending ? ` (${candidate.pending})` : ""}`);
  }

  const choice = chooseTask(candidates);
  core.setOutput("action", choice?.action ?? "none");
  if (!choice) {
    core.info("Nothing to do.");
    return;
  }

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
  const requests = choice.action === "implement" ? resumeRequests(sources) : [];
  // A fix changes code; anything else goes on where the task was.
  const stage: Stage | undefined =
    choice.action !== "implement"
      ? undefined
      : requests.some((request) => request.kind === "fix")
        ? "code"
        : (record?.stage ?? stageOfState(fromStateOf(task.labels)) ?? firstStage(task.labels));
  const problems = sources.flatMap(({ command }) =>
    command.kind === "invalid" ? [{ text: command.text, problem: command.problem }] : [],
  );
  const fromState = stateOf(task.labels);
  if (!fromState.ok) throw new Error(fromState.error);

  const slug = slugify(task.title);
  const branch = record?.branch ?? `codeman/${task.number}-${slug}`;
  const branchSha = await repo.branchSha(branch);
  const baseSha = branchSha ?? (await repo.branchSha(defaultBranch));
  if (!baseSha) throw new Error(`Branch ${defaultBranch} not found.`);
  const settings = resolveSettings(taskSettings(maintainerComments), inputs, fileSettings.value);
  if (!settings.ok) throw new Error(settings.error);
  const model = settings.value.model;

  const context: TaskContext = {
    version: 1,
    action: choice.action,
    owner: repo.owner,
    repo: repo.repo,
    number: task.number,
    title: task.title,
    body: task.body,
    url: task.url,
    comments: maintainerComments,
    reviews,
    requests,
    resume,
    accept:
      choice.action === "accept"
        ? acceptRequest(maintainerComments, record?.acceptedCommentId ?? 0)
        : undefined,
    workflowRuns: choice.action === "implement" ? workflowRuns.get(task.number) : undefined,
    history: choice.action === "implement" ? runHistory(talk.comments, bot) : undefined,
    stage,
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
    settings: settings.value,
    ignore,
    defaultBranch,
    branch,
    branchExists: branchSha !== undefined,
    baseSha,
    planPath: record?.planPath ?? `docs/plans/${new Date().toISOString().slice(0, 10)}-${slug}.md`,
    record: record ?? null,
    replan,
    settled,
    statusCommentId: talk.status?.id ?? null,
    runUrl: runUrl(),
  };

  const needsAgent = choice.action === "plan" || choice.action === "implement";
  if (needsAgent) {
    const t = messages(taskLanguage(settings.value.language, record?.language));
    const state = stage ? STAGE_STATE[stage] : "planning";
    await repo.setState(task.number, task.labels, state);
    context.statusCommentId = await repo.upsertComment(
      task.number,
      context.statusCommentId,
      renderStatus({
        t,
        state,
        record,
        model,
        runUrl: context.runUrl,
        message: startMessage(t, context),
        cost: { task: record?.spent, budget: settings.value["task-budget"] },
        reportUrl: reportUrl(task.url, record),
      }),
    );
  }

  mkdirSync(dirname(taskFile()), { recursive: true });
  writeFileSync(taskFile(), JSON.stringify(context, null, 2));
  core.setOutput("task", String(task.number));
  core.setOutput("model", model);
  core.setOutput("base-sha", baseSha);
  core.setOutput("needs-agent", String(needsAgent));
  core.setOutput("stage", stage ?? (choice.action === "plan" ? "plan" : ""));
  core.setOutput("task-budget", String(settings.value["task-budget"]));
  core.setOutput("monthly-budget", String(settings.value["monthly-budget"]));
  core.info(`Selected #${task.number} to ${choice.action}, with model ${model}.`);
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
  comments: CommentLike[];
  reviews: ReviewLike[];
  status: ReturnType<typeof findStatus>;
  maintainers: Set<string>;
}

function startMessage(t: Messages, task: TaskContext): string {
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
function inputSettings(): PartialSettings {
  const settings: PartialSettings = {};
  for (const name of ["model", "task-budget", "monthly-budget", "max-runs"]) {
    const text = core.getInput(name);
    if (text === "" || !isSettingName(name)) continue;
    const parsed = parseSetting(name, text);
    if (!parsed.ok) throw new Error(`Input ${parsed.error}`);
    Object.assign(settings, { [name]: parsed.value });
  }
  return settings;
}

/** Warns about each path Codeman proposes to protect that the repository's rules allow. */
async function warnUnprotected(ignore: string | null): Promise<void> {
  if (ignore === null) {
    core.info(
      `The repository has no ${IGNORE_FILE}; Codeman uses its own and proposes it in the next pull request.`,
    );
    return;
  }
  const paths = unprotected(ignore);
  for (const path of paths) {
    core.warning(
      `${IGNORE_FILE} lets the agent change ${oneLine(path)}, which Codeman proposes to protect.`,
    );
  }
  if (paths.length > 0) {
    await core.summary
      .addHeading("Paths the agent may change", 3)
      .addRaw(
        `${IGNORE_FILE} does not protect these paths, which Codeman proposes to protect:`,
        true,
      )
      .addList(paths)
      .write();
  }
}
