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
  const chain = chains(task.action, core.getInput("key-job-result"), core.getInput("key-status"));
  if (task.action === "record") await recordAnswers(task, repo);
  else if (await keyFailed(task, repo)) return;
  else if (task.action === "implement") await applyImplementation(task, repo);
  else await applyPlan(task, repo);
  core.setOutput("chain", String(chain));
}

/**
 * Whether to start another run once this one is applied. The next run's `select` finds out
 * whether any task can move, and stops without an LLM if none can. A run without a key moved
 * nothing: another one would pick the same task again, and again.
 */
export function chains(action: TaskContext["action"], keyJob: string, keyStatus: string): boolean {
  return action === "record" || (keyJob === "success" && keyStatus === "opened");
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
      retry: true,
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
    processedCommentId: task.processed.commentId,
    processedReviewId: task.processed.reviewId,
    pullRequest: task.record?.pullRequest,
    runs: 0,
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

  // Runs in a row that did not finish; a `fix` or `continue` request starts a new count.
  const runs = (task.resume ? 0 : (task.record.runs ?? 0)) + 1;
  const maxRuns = task.settings["max-runs"];
  const record: TaskRecord = { ...task.record, runs };
  const unfinished = (message: string, report?: string): Promise<void> =>
    runs >= maxRuns
      ? finish(repo, task, "blocked", {
          record,
          message: `${message} The agent has run ${runs} times in a row without finishing the task (\`max-runs\` is ${maxRuns}). Comment \`/codeman continue <guidance>\` to allow ${maxRuns} more runs.`,
          report,
          errors: dropped,
        })
      : finish(repo, task, "in-progress", { record, message, report, errors: dropped });

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
      return unfinished("The agent ran out of time. Its work so far is committed.");
    }
    const exit = manifest.exitCode === 0 ? "" : ` The agent exited with code ${manifest.exitCode}.`;
    return blocked(repo, task, `${output.error}${exit}`, dropped, record);
  }

  const { status, summary, reason } = output.value;
  if (status === "partial") {
    return unfinished("Work so far is committed to the task branch.", summary);
  }
  if (status === "blocked") {
    return finish(repo, task, "blocked", {
      record,
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
    record: { ...record, pullRequest, runs: 0 },
    message:
      "The work is done. Review the pull request. To ask for changes, submit a review that requests them, or comment `/codeman fix <what to change>` on the pull request.",
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

/** How a maintainer sends a blocked task back to work. */
function retryHint(task: TaskContext): string {
  if (task.action === "implement") return "Comment `/codeman continue <guidance>` to try again.";
  if (task.record) return "Comment `/codeman replan <what to change>` to try again.";
  return "Remove the `codeman:blocked` label to try again.";
}

function blocked(
  repo: Repository,
  task: TaskContext,
  error: string,
  more: readonly string[] = [],
  record?: TaskRecord,
): Promise<void> {
  core.error(oneLine(error));
  return finish(repo, task, "blocked", {
    record,
    message: `Codeman could not use the agent's result. ${retryHint(task)}`,
    errors: [error, ...more],
  });
}

async function finish(
  repo: Repository,
  task: TaskContext,
  state: State | "new",
  view: {
    record?: TaskRecord | undefined;
    message?: string;
    report?: string | undefined;
    errors?: string[];
    /** The run could not start: leave the new requests for the next one. */
    retry?: boolean;
  },
): Promise<void> {
  let record = view.record ?? task.record ?? undefined;
  if (record && task.action !== "record" && !view.retry) {
    // Handled, whatever the outcome: a failing request must not start run after run.
    record = {
      ...record,
      processedCommentId: Math.max(record.processedCommentId, task.processed.commentId),
      processedReviewId: Math.max(record.processedReviewId ?? 0, task.processed.reviewId),
    };
  }
  const errors = [...(task.action === "record" ? [] : task.problems), ...(view.errors ?? [])];
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
      errors,
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
