import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import type { Change } from "../collect.ts";
import type { FileChange, Repository } from "../github.ts";
import { parseImplementOutput, parsePlanOutput } from "../output.ts";
import { checkChanges, DEFAULT_IGNORE, IGNORE_FILE } from "../policy.ts";
import { pullRequestBody, pullRequestTitle } from "../pull.ts";
import { applyCommands, pendingDecisions, type TaskRecord, writeAnswers } from "../record.ts";
import type { State } from "../state.ts";
import { renderStatus } from "../status.ts";
import { commandsAfter, type TaskContext } from "../tasks.ts";
import { oneLine, truncate } from "../text.ts";
import { checkPlanResult, decodeText, isManifest } from "../validate.ts";
import { MAX_OUTPUT_BYTES } from "./agent.ts";
import { fileUrl, pullUrl, readTask, repository, resultDir } from "./common.ts";

/**
 * Validates what the earlier jobs produced and writes it to GitHub. Runs no LLM. Everything it
 * reads from the agent's result is treated as untrusted.
 */
export async function apply(): Promise<void> {
  const task = readTask();
  const repo = repository();
  if (task.action === "record") await recordAnswers(task, repo);
  else if (await keyFailed(task, repo)) return;
  else if (task.action === "implement") await applyImplementation(task, repo);
  else await applyPlan(task, repo);
}

/** Handles a run in which no key was created. Returns true if it did. */
async function keyFailed(task: TaskContext, repo: Repository): Promise<boolean> {
  if (core.getInput("key-job-result") !== "success") {
    await finish(repo, task, "blocked", {
      message: `Codeman could not create the OpenRouter key for this task. See the run log. ${retryHint(task)}`,
    });
    return true;
  }
  if (core.getInput("key-status") !== "opened") {
    // Not the task's fault: go back to where it was, and try again in a later run.
    await finish(repo, task, task.fromState === "planning" ? "new" : task.fromState, {
      message: `${core.getInput("key-reason") || "No key was created."} Codeman will try again in a later run.`,
    });
    return true;
  }
  return false;
}

async function applyPlan(task: TaskContext, repo: Repository): Promise<void> {
  if (core.getInput("agent-job-result") !== "success") {
    return finish(repo, task, "blocked", {
      message: `The agent did not finish the plan. See the run log. ${retryHint(task)}`,
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

/**
 * Commits the agent's work to the task branch, whatever its outcome, so no work is lost; then
 * opens the pull request if the agent reports the task as done.
 */
async function applyImplementation(task: TaskContext, repo: Repository): Promise<void> {
  if (!task.record) return blocked(repo, task, "The task has no record of its plan.");
  const dir = resultDir();
  const manifest = readJson(join(dir, "manifest.json"));
  if (!isManifest(manifest)) {
    return finish(repo, task, "blocked", {
      message: `The agent produced no result. See the run log. ${retryHint(task)}`,
    });
  }
  const checked = checkChanges(manifest, {
    ignore: task.ignore,
    maxFiles: task.settings["max-files"],
    maxFileBytes: task.settings["max-file-bytes"],
    planPath: task.planPath,
  });
  if (!checked.ok) return blocked(repo, task, checked.error);
  const dropped = checked.value.dropped.map(
    ({ path, reason }) => `Dropped the change to ${path}: ${reason}.`,
  );

  const outputFile = join(dir, "output.json");
  const output = existsSync(outputFile)
    ? parseImplementOutput(readFileSync(outputFile, "utf8").slice(0, MAX_OUTPUT_BYTES))
    : { ok: false as const, error: "The agent did not write output.json." };

  const changes = readChanges(join(dir, "tree"), checked.value.accepted, task.settings);
  let head = task.baseSha;
  if (changes.length > 0) {
    head = await repo.commit({
      branch: task.branch,
      baseSha: head,
      createBranch: !task.branchExists,
      changes,
      message: output.ok ? output.value.commitMessage : `Work in progress on #${task.number}`,
    });
  }

  if (!output.ok) {
    if (manifest.timedOut) {
      return finish(repo, task, "in-progress", {
        message: "The agent ran out of time. Its work so far is committed; the next run continues.",
        errors: dropped,
      });
    }
    const exit = manifest.exitCode === 0 ? "" : ` The agent exited with code ${manifest.exitCode}.`;
    return blocked(repo, task, `${output.error}${exit}`, dropped);
  }

  const { status, summary, reason } = output.value;
  if (status === "partial") {
    return finish(repo, task, "in-progress", {
      message: "Work so far is committed to the task branch; the next run continues.",
      report: summary,
      errors: dropped,
    });
  }
  if (status === "blocked") {
    return finish(repo, task, "blocked", {
      message: `The agent needs a maintainer. ${retryHint(task)}`,
      report: summary,
      errors: [`The agent reports: ${reason ?? ""}`, ...dropped],
    });
  }

  if (task.ignore === null && (await repo.readFile(task.branch, IGNORE_FILE)) === undefined) {
    head = await repo.commit({
      branch: task.branch,
      baseSha: head,
      createBranch: false,
      changes: [{ path: IGNORE_FILE, content: Buffer.from(DEFAULT_IGNORE, "utf8") }],
      message: `Add ${IGNORE_FILE}\n\nThe paths Codeman's agent may not change. Review them before merging.`,
    });
  }
  const title = pullRequestTitle(output.value.commitMessage);
  const body = pullRequestBody({
    issue: task.number,
    planPath: task.planPath,
    planUrl: fileUrl(task, task.planPath),
    planSummary: task.record.summary,
    summary,
    commitMessage: output.value.commitMessage,
    runUrl: task.runUrl,
  });
  let pullRequest = await repo.findPullRequest(task.branch);
  if (pullRequest === undefined) {
    pullRequest = await repo.openPullRequest({
      head: task.branch,
      base: task.defaultBranch,
      title,
      body,
    });
  } else {
    await repo.updatePullRequest(pullRequest, { title, body });
  }
  await finish(repo, task, "done", {
    record: { ...task.record, pullRequest },
    message: "The work is done. Review the pull request.",
    report: summary,
    errors: dropped,
  });
}

/** Reads the accepted changes from the agent's result. Each file is checked again. */
function readChanges(
  tree: string,
  accepted: readonly Change[],
  settings: TaskContext["settings"],
): FileChange[] {
  return accepted.map((change) => {
    if (change.status === "deleted") return { path: change.path, content: null };
    const file = join(tree, change.path);
    const stats = lstatSync(file);
    if (!stats.isFile() || stats.size > settings["max-file-bytes"]) {
      throw new Error(`${oneLine(change.path)} changed after it was checked.`);
    }
    return {
      path: change.path,
      content: readFileSync(file),
      mode: change.mode === "100755" ? "100755" : "100644",
    };
  });
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
        ? "All decisions are answered. Codeman implements the plan in its next run."
        : `${pending} decision(s) still need an answer.`,
  });
}

/** How a maintainer sends a blocked task back to where it was. */
function retryHint(task: TaskContext): string {
  return task.action === "implement"
    ? "Replace the `codeman:blocked` label with `codeman:in-progress` to try again."
    : "Remove the `codeman:blocked` label to try again.";
}

function blocked(
  repo: Repository,
  task: TaskContext,
  error: string,
  more: readonly string[] = [],
): Promise<void> {
  core.error(oneLine(error));
  return finish(repo, task, "blocked", {
    message: `Codeman could not use the agent's result. ${retryHint(task)}`,
    errors: [error, ...more],
  });
}

async function finish(
  repo: Repository,
  task: TaskContext,
  state: State | "new",
  view: { record?: TaskRecord; message?: string; report?: string; errors?: string[] },
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
      pullRequestUrl: record?.pullRequest ? pullUrl(task, record.pullRequest) : undefined,
      message: view.message,
      report: view.report,
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
