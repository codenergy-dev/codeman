import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import type { Repository } from "../github.ts";
import { parsePlanOutput } from "../output.ts";
import { applyCommands, pendingDecisions, type TaskRecord, writeAnswers } from "../record.ts";
import type { State } from "../state.ts";
import { renderStatus } from "../status.ts";
import { commandsAfter, type TaskContext } from "../tasks.ts";
import { oneLine, truncate } from "../text.ts";
import { checkPlanResult, decodeText } from "../validate.ts";
import { MAX_OUTPUT_BYTES } from "./agent.ts";
import { fileUrl, readTask, repository, resultDir } from "./common.ts";

/**
 * Validates what the earlier jobs produced and writes it to GitHub. Runs no LLM. Everything it
 * reads from the agent's result is treated as untrusted.
 */
export async function apply(): Promise<void> {
  const task = readTask();
  const repo = repository();
  if (task.action === "record") await recordAnswers(task, repo);
  else await applyPlan(task, repo);
}

async function applyPlan(task: TaskContext, repo: Repository): Promise<void> {
  const keyJob = core.getInput("key-job-result");
  const keyStatus = core.getInput("key-status");
  const agentJob = core.getInput("agent-job-result");

  if (keyJob !== "success") {
    return finish(repo, task, "blocked", {
      message: "Codeman could not create the OpenRouter key for this task. See the run log.",
    });
  }
  if (keyStatus !== "opened") {
    // Not the task's fault: go back to where it was, and try again in a later run.
    return finish(repo, task, task.fromState === "planning" ? "new" : task.fromState, {
      message: `${core.getInput("key-reason") || "No key was created."} Codeman will try again in a later run.`,
    });
  }
  if (agentJob !== "success") {
    return finish(repo, task, "blocked", {
      message:
        "The agent did not finish the plan. See the run log. Remove the `codeman:blocked` label to try again.",
    });
  }

  const dir = resultDir();
  const manifest = readJson(join(dir, "manifest.json"));
  const checked = checkPlanResult(manifest, task.planPath);
  if (!checked.ok) return blocked(repo, task, checked.error);

  const planFile = join(dir, "tree", task.planPath);
  if (!lstatSync(planFile).isFile()) return blocked(repo, task, `${task.planPath} is not a file.`);
  const plan = decodeText(readFileSync(planFile));
  if (plan === undefined) return blocked(repo, task, `${task.planPath} is not UTF-8 text.`);

  const outputFile = join(dir, "output.json");
  if (!existsSync(outputFile)) return blocked(repo, task, "The agent did not write output.json.");
  const output = parsePlanOutput(readFileSync(outputFile, "utf8").slice(0, MAX_OUTPUT_BYTES));
  if (!output.ok) return blocked(repo, task, output.error);

  await repo.commit({
    branch: task.branch,
    baseSha: task.baseSha,
    createBranch: !task.branchExists,
    changes: [{ path: task.planPath, content: Buffer.from(plan, "utf8") }],
    message: `Plan #${task.number}: ${truncate(oneLine(task.title), 60)}`,
  });

  const record: TaskRecord = {
    branch: task.branch,
    planPath: task.planPath,
    summary: output.value.summary,
    decisions: output.value.decisions,
    // Commands posted before this plan existed do not answer its decisions.
    processedCommentId: Math.max(0, ...task.comments.map((comment) => comment.id)),
  };
  const state = record.decisions.length > 0 ? "awaiting-decision" : "ready";
  const ignored = checked.value.ignored.map((path) => `Ignored a change to ${path}.`);
  await finish(repo, task, state, { record, errors: ignored });
}

async function recordAnswers(task: TaskContext, repo: Repository): Promise<void> {
  if (!task.record) return blocked(repo, task, "The task has no record of its decisions.");
  const sources = commandsAfter(task.comments, task.record.processedCommentId);
  const { record, errors } = applyCommands(task.record, sources);

  const plan = await repo.readFile(task.branch, task.planPath);
  if (plan === undefined) {
    return blocked(repo, task, `The plan ${task.planPath} is missing from ${task.branch}.`);
  }
  const updated = writeAnswers(plan, record);
  if (updated !== plan) {
    const head = await repo.branchSha(task.branch);
    if (!head) return blocked(repo, task, `The branch ${task.branch} is missing.`);
    await repo.commit({
      branch: task.branch,
      baseSha: head,
      createBranch: false,
      changes: [{ path: task.planPath, content: Buffer.from(updated, "utf8") }],
      message: `Record decisions for #${task.number}`,
    });
  }

  const pending = pendingDecisions(record).length;
  await finish(repo, task, pending === 0 ? "ready" : "awaiting-decision", {
    record,
    errors,
    message:
      pending === 0
        ? "All decisions are answered. The plan is ready to implement."
        : `${pending} decision(s) still need an answer.`,
  });
}

function blocked(repo: Repository, task: TaskContext, error: string): Promise<void> {
  core.error(oneLine(error));
  return finish(repo, task, "blocked", {
    message:
      "Codeman could not use the agent's result. Remove the `codeman:blocked` label to try again.",
    errors: [error],
  });
}

async function finish(
  repo: Repository,
  task: TaskContext,
  state: State | "new",
  view: { record?: TaskRecord; message?: string; errors?: string[] },
): Promise<void> {
  const record = view.record ?? task.record ?? undefined;
  await repo.setState(task.number, await repo.currentLabels(task.number), state);
  await repo.upsertComment(
    task.number,
    task.statusCommentId,
    renderStatus({
      state,
      record,
      model: task.model,
      runUrl: task.runUrl,
      planUrl: record ? fileUrl(task, record.planPath) : undefined,
      message: view.message,
      errors: view.errors,
    }),
  );
  core.info(`#${task.number} is now ${state}.`);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
