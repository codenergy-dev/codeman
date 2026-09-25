import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as core from "@actions/core";
import { IGNORE_FILE, unprotected } from "../policy.ts";
import { applyCommands } from "../record.ts";
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
  type Candidate,
  type CommentLike,
  chooseTask,
  commandsAfter,
  commenters,
  DECIDING,
  findStatus,
  MAINTAINER_PERMISSIONS,
  pendingWork,
  replanRequests,
  type TaskContext,
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

  // Permission per commenter, asked once per run.
  const permissions = new Map<string, Promise<string>>();
  const maintainersAmong = async (all: readonly CommentLike[]): Promise<Set<string>> => {
    const logins = commenters(all);
    for (const login of logins) {
      if (!permissions.has(login)) permissions.set(login, repo.permission(login));
    }
    const levels = await Promise.all(logins.map((login) => permissions.get(login)));
    return new Set(logins.filter((_, index) => MAINTAINER_PERMISSIONS.has(levels[index] ?? "")));
  };

  const candidates: Candidate[] = [];
  const comments = new Map<number, CommentLike[]>();
  for (const task of tasks) {
    const line = `#${task.number} ${oneLine(task.title)}`;
    const result = stateOf(task.labels);
    if (!result.ok) {
      core.warning(`${line}: ${result.error}`);
      continue;
    }
    let pending: Candidate["pending"];
    if (DECIDING.has(result.state)) {
      const all = await repo.listComments(task.number);
      comments.set(task.number, all);
      const record = findStatus(all, bot)?.record;
      if (record) {
        const maintainers = await maintainersAmong(all);
        pending = pendingWork(
          commandsAfter(authorizedComments(all, maintainers), record.processedCommentId),
        );
      }
    }
    candidates.push({ number: task.number, state: result.state, pending });
    core.info(`${line} [${result.state}]`);
  }

  const choice = chooseTask(candidates);
  core.setOutput("action", choice?.action ?? "none");
  if (!choice) {
    core.info("Nothing to do.");
    return;
  }

  const task = tasks.find((candidate) => candidate.number === choice.number);
  if (!task) throw new Error(`Task #${choice.number} disappeared.`);
  const all = comments.get(task.number) ?? (await repo.listComments(task.number));
  const status = findStatus(all, bot);
  const maintainerComments = authorizedComments(all, await maintainersAmong(all));
  // A new plan keeps the answers given so far and says what to change.
  const sources =
    choice.action === "plan" && status?.record
      ? commandsAfter(maintainerComments, status.record.processedCommentId)
      : [];
  const record = status?.record;
  const replan = replanRequests(sources);
  const settled = record
    ? applyCommands(record, sources).record.decisions.filter((decision) => decision.answer)
    : [];
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
    statusCommentId: status?.id ?? null,
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
        message:
          choice.action === "implement"
            ? "Codeman is implementing the plan."
            : replan.length > 0
              ? "Codeman is revising the plan, as requested."
              : "Codeman is reading the issue and writing a plan.",
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
