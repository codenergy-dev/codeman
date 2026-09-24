import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as core from "@actions/core";
import { isModelId } from "../commands.ts";
import { applyCommands } from "../record.ts";
import { stateOf } from "../state.ts";
import { renderStatus } from "../status.ts";
import {
  authorizedComments,
  type Candidate,
  type CommentLike,
  chooseTask,
  commandsAfter,
  DECIDING,
  findStatus,
  pendingWork,
  replanRequests,
  type TaskContext,
  taskModel,
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
  const defaultModel = core.getInput("model", { required: true });
  if (!isModelId(defaultModel)) throw new Error(`"${defaultModel}" is not an OpenRouter model ID.`);

  const tasks = (await repo.listOptedIn()).map(toTask).filter((task) => task.kind === "issue");
  core.info(`Found ${tasks.length} open issue(s) labeled "codeman".`);

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
        pending = pendingWork(commandsAfter(authorizedComments(all), record.processedCommentId));
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
  const maintainerComments = authorizedComments(all);
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
  const defaultBranch = await repo.defaultBranch();
  const branchSha = await repo.branchSha(branch);
  const baseSha = branchSha ?? (await repo.branchSha(defaultBranch));
  if (!baseSha) throw new Error(`Branch ${defaultBranch} not found.`);
  const model = taskModel(maintainerComments, defaultModel);

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

  if (choice.action === "plan") {
    await repo.setState(task.number, task.labels, "planning");
    context.statusCommentId = await repo.upsertComment(
      task.number,
      context.statusCommentId,
      renderStatus({
        state: "planning",
        record,
        model,
        runUrl: context.runUrl,
        message:
          replan.length > 0
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
  core.info(`Selected #${task.number} to ${choice.action}, with model ${model}.`);
}
