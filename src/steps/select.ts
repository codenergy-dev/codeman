import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as core from "@actions/core";
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
import { stateOf } from "../state.ts";
import { renderStatus } from "../status.ts";
import {
  authorizedComments,
  authorizedReviews,
  type Candidate,
  type CommentLike,
  chooseTask,
  commandsAfter,
  commenters,
  findStatus,
  MAINTAINER_PERMISSIONS,
  pendingWork,
  type ReviewLike,
  replanRequests,
  resumeRequests,
  reviewCommands,
  type TaskContext,
  type TaskReview,
  taskSettings,
  toTask,
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

  const candidates: Candidate[] = [];
  for (const task of tasks) {
    const line = `#${task.number} ${oneLine(task.title)}`;
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
  const problems = sources.flatMap(({ command }) =>
    command.kind === "invalid" ? [`${command.text}: ${command.reason}`] : [],
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
    planPath: record?.planPath ?? `plans/${new Date().toISOString().slice(0, 10)}-${slug}.md`,
    record: record ?? null,
    replan,
    settled,
    statusCommentId: talk.status?.id ?? null,
    runUrl: runUrl(),
  };

  if (choice.action !== "record") {
    const state = choice.action === "plan" ? "planning" : "in-progress";
    await repo.setState(task.number, task.labels, state);
    context.statusCommentId = await repo.upsertComment(
      task.number,
      context.statusCommentId,
      renderStatus({
        state,
        record,
        model,
        runUrl: context.runUrl,
        message: startMessage(context),
      }),
    );
  }

  mkdirSync(dirname(taskFile()), { recursive: true });
  writeFileSync(taskFile(), JSON.stringify(context, null, 2));
  core.setOutput("task", String(task.number));
  core.setOutput("model", model);
  core.setOutput("base-sha", baseSha);
  core.setOutput("needs-agent", String(choice.action !== "record"));
  core.setOutput("task-budget", String(settings.value["task-budget"]));
  core.setOutput("monthly-budget", String(settings.value["monthly-budget"]));
  core.info(`Selected #${task.number} to ${choice.action}, with model ${model}.`);
}

interface Conversation {
  comments: CommentLike[];
  reviews: ReviewLike[];
  status: ReturnType<typeof findStatus>;
  maintainers: Set<string>;
}

function startMessage(task: TaskContext): string {
  if (task.action === "implement") {
    if (task.requests.some((request) => request.kind === "fix") || task.reviews.length > 0) {
      return "Codeman is working on the requested changes.";
    }
    return task.resume
      ? "Codeman is continuing the work, as requested."
      : "Codeman is implementing the plan.";
  }
  return task.replan.length > 0
    ? "Codeman is revising the plan, as requested."
    : "Codeman is reading the issue and writing a plan.";
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
