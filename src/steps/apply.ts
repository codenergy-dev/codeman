import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import { usd } from "../budget.ts";
import type { Change } from "../collect.ts";
import type { FileChange, Repository } from "../github.ts";
import { parsePlanOutput, parseStageOutput } from "../output.ts";
import {
  checkChanges,
  DEFAULT_IGNORE,
  IGNORE_FILE,
  STAGED_WORKFLOWS_DIR,
  stagedPath,
  WORKFLOWS_DIR,
  workflowPath,
} from "../policy.ts";
import { pullRequestBody, pullRequestFooter, pullRequestTitle } from "../pull.ts";
import { applyCommands, pendingDecisions, type TaskRecord, writeAnswers } from "../record.ts";
import { nextStage, STAGE_STATE, type Stage } from "../stages.ts";
import type { State } from "../state.ts";
import { renderStatus } from "../status.ts";
import { commandsAfter, type TaskContext } from "../tasks.ts";
import { inertLines, oneLine, truncate } from "../text.ts";
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
  else if (task.action === "accept") await acceptWorkflows(task, repo);
  else if (await keyFailed(task, repo)) return;
  else if (task.action === "implement") await applyStage(task, repo);
  else await applyPlan(task, repo);
  core.setOutput("chain", String(chain));
}

/**
 * Whether to start another run once this one is applied. The next run's `select` finds out
 * whether any task can move, and stops without an LLM if none can. A run without a key moved
 * nothing: another one would pick the same task again, and again.
 */
export function chains(action: TaskContext["action"], keyJob: string, keyStatus: string): boolean {
  return (
    action === "record" || action === "accept" || (keyJob === "success" && keyStatus === "opened")
  );
}

/** Handles a run in which no key was created. Returns true if it did. */
async function keyFailed(task: TaskContext, repo: Repository): Promise<boolean> {
  if (core.getInput("key-job-result") !== "success") {
    await finish(repo, task, "blocked", {
      message: `Codeman could not create the OpenRouter key for this task. See the run log. ${retryHint(task)}`,
    });
    return true;
  }
  if (core.getInput("key-status") === "task-budget-spent") {
    await finish(repo, task, "blocked", {
      message: `${core.getInput("key-reason")} Then comment \`/codeman continue\`.`,
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
 * Commits a stage's work to the task branch, whatever its outcome, so no work is lost; then
 * moves the task to the next stage, or back, or to a human. Review commits nothing.
 */
async function applyStage(task: TaskContext, repo: Repository): Promise<void> {
  if (!task.record) return blocked(repo, task, "The task has no record of its plan.");
  const stage = task.stage ?? "code";
  const dir = resultDir();
  const manifest = readJson(join(dir, "manifest.json"));
  if (!isManifest(manifest)) {
    return finish(repo, task, "blocked", {
      message: `The agent produced no result. See the run log. ${retryHint(task)}`,
    });
  }
  // Review's merge and checks stay in its sandbox.
  const checked =
    stage === "review"
      ? { ok: true as const, value: { accepted: [], staged: [], dropped: [] } }
      : checkChanges(manifest, {
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
    ? parseStageOutput(readFileSync(outputFile, "utf8").slice(0, MAX_OUTPUT_BYTES), stage)
    : { ok: false as const, error: "The agent did not write output.json." };

  // Runs of this stage in a row that did not finish it; a request starts a new count.
  const fresh = task.resume || task.record.stage !== stage;
  const runs = (fresh ? 0 : (task.record.runs ?? 0)) + 1;
  const maxRuns = task.settings["max-runs"];
  const fixed = task.requests.some((request) => request.kind === "fix");
  // A run that awaits a workflow sets `awaiting` again; any other outcome ends the wait.
  const record: TaskRecord = {
    ...task.record,
    stage,
    runs,
    awaiting: undefined,
    reviewRounds: fixed ? 0 : task.record.reviewRounds,
  };
  const unfinished = (message: string, report?: string): Promise<void> =>
    runs >= maxRuns
      ? finish(repo, task, "blocked", {
          record,
          message: `${message} The ${stage} stage has run ${runs} times in a row without finishing (\`max-runs\` is ${maxRuns}). Comment \`/codeman continue <guidance>\` to allow ${maxRuns} more runs.`,
          report,
          errors: dropped,
        })
      : finish(repo, task, STAGE_STATE[stage], { record, message, report, errors: dropped });

  const tree = join(dir, "tree");
  const changes = [
    ...readChanges(tree, checked.value.accepted, task.settings),
    ...readChanges(tree, checked.value.staged, task.settings).map((change) => ({
      ...change,
      path: stagedPath(change.path),
    })),
  ];
  let head = task.baseSha;
  if (changes.length > 0) {
    head = await repo.commit({
      branch: task.branch,
      baseSha: head,
      createBranch: !task.branchExists,
      changes,
      message:
        (output.ok ? output.value.commitMessage : undefined) ??
        `${STAGE_NAMES[stage]} for #${task.number}`,
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
  switch (status) {
    case "partial":
      return unfinished("Work so far is committed to the task branch.", summary);
    case "blocked":
      return finish(repo, task, "blocked", {
        record,
        message: `The ${stage} stage needs a maintainer. ${retryHint(task)}`,
        report: summary,
        errors: [`The agent reports: ${reason ?? ""}`, ...dropped],
      });
    case "awaiting-workflow": {
      const workflows = output.value.workflows ?? [];
      const present = new Set([
        ...(await repo.filesUnder(head, WORKFLOWS_DIR)).keys(),
        ...[...(await repo.filesUnder(head, STAGED_WORKFLOWS_DIR)).keys()].map(workflowPath),
      ]);
      const missing = workflows.filter((path) => !present.has(path));
      if (missing.length > 0) {
        return blocked(
          repo,
          task,
          `The agent waits for workflows that are not on the branch: ${missing.join(", ")}.`,
          dropped,
          record,
        );
      }
      return finish(repo, task, "awaiting-workflow", {
        record: { ...record, runs: runs - 1, awaiting: workflows },
        message: `The ${stage} stage needs ${workflows.join(", ")} to run: ${reason ?? ""} Codeman goes on when their runs on the task branch finish. \`/codeman continue <guidance>\` goes on without them.`,
        report: summary,
        errors: dropped,
      });
    }
    case "decisions": {
      // Review's questions are answered before the code stage acts on its report.
      const offset = record.decisions.length;
      const added = (output.value.decisions ?? []).map((decision) => ({
        ...decision,
        id: decision.id + offset,
      }));
      if (stage === "review") await postReview(repo, task, record, summary, reason);
      return finish(repo, task, "awaiting-decision", {
        record: {
          ...record,
          decisions: [...record.decisions, ...added],
          stage: stage === "review" ? "code" : stage,
          runs: 0,
          handoff: stage === "review" ? { stage, text: truncate(summary, 4000) } : record.handoff,
        },
        message: `The ${stage} stage needs ${added.length} decision(s) from the maintainers.`,
        report: summary,
        errors: dropped,
      });
    }
    case "changes": {
      const rounds = (record.reviewRounds ?? 0) + 1;
      await postReview(repo, task, record, summary, reason);
      if (rounds > maxRuns) {
        return finish(repo, task, "blocked", {
          record: { ...record, reviewRounds: rounds },
          message: `Review sent the work back to the code stage ${rounds} times in a row (\`max-runs\` is ${maxRuns}). Comment \`/codeman continue <guidance>\` to go on.`,
          report: summary,
        });
      }
      return finish(repo, task, STAGE_STATE.code, {
        record: {
          ...record,
          stage: "code",
          runs: 0,
          reviewRounds: rounds,
          handoff: { stage, text: truncate(`${reason ?? ""}\n\n${summary}`, 4000) },
        },
        message: "Review asked for changes; the code stage works on them next.",
        report: summary,
      });
    }
  }

  if (stage !== "review") {
    // done or skipped: hand over to the next stage.
    const next = nextStage(stage) ?? "review";
    // Kept short: the record lives in the status comment, which GitHub limits in size.
    const text = truncate(status === "skipped" ? `Skipped: ${reason ?? ""}` : summary, 2000);
    const updated: TaskRecord = {
      ...record,
      stage: next,
      runs: 0,
      handoff: { stage, text },
      reports: { ...record.reports, [stage]: text },
      commitMessage:
        stage === "code" && output.value.commitMessage
          ? output.value.commitMessage
          : record.commitMessage,
    };
    if (stage === "code") {
      updated.pullRequest = await openPullRequest(repo, task, updated, "draft");
    }
    return finish(repo, task, STAGE_STATE[next], {
      record: updated,
      message: `${STAGE_NAMES[stage]} ${status === "skipped" ? "skipped" : "done"}. Next: ${next}.`,
      report: text,
      errors: dropped,
    });
  }

  // Review passed.
  if (task.ignore === null && (await repo.readFile(task.branch, IGNORE_FILE)) === undefined) {
    head = await repo.commit({
      branch: task.branch,
      baseSha: head,
      createBranch: false,
      changes: [{ path: IGNORE_FILE, content: Buffer.from(DEFAULT_IGNORE, "utf8") }],
      message: `Add ${IGNORE_FILE}\n\nThe paths Codeman's agent may not change. Review them before merging.`,
    });
  }
  const pullRequest = await openPullRequest(repo, task, record, "ready");
  const done: TaskRecord = {
    ...record,
    pullRequest,
    stage: undefined,
    runs: 0,
    reviewRounds: 0,
    handoff: undefined,
  };
  await postReview(repo, { ...task, record: done }, done, summary, undefined);
  await finish(repo, task, "done", {
    pullRequestWritten: true,
    record: done,
    message:
      "The work is done and reviewed. Review the pull request. To ask for changes, submit a review that requests them, or comment `/codeman fix <what to change>` on the pull request.",
    report: summary,
  });
}

const STAGE_NAMES: Record<Stage, string> = {
  design: "Design",
  code: "Code",
  test: "Tests",
  review: "Review",
};

/**
 * Opens the task's pull request, or updates it: a draft while stages still work on it, ready
 * for review once review passes. Repositories without draft pull requests get a regular one.
 */
async function openPullRequest(
  repo: Repository,
  task: TaskContext,
  record: TaskRecord,
  mode: "draft" | "ready",
): Promise<number> {
  const title = pullRequestTitle(record.commitMessage ?? task.title);
  const body = pullRequestBody({
    issue: task.number,
    planPath: task.planPath,
    planUrl: fileUrl(task, task.planPath),
    planSummary: record.summary,
    summary:
      mode === "ready"
        ? [
            `Code: ${record.reports?.code ?? "(no report)"}`,
            "",
            `Tests: ${record.reports?.test ?? "(no report)"}`,
          ].join("\n")
        : "Codeman is still working on this pull request: test and review come next. It becomes ready for review when they pass.",
    commitMessage: record.commitMessage ?? "",
    runUrl: task.runUrl,
    spent: spentLine(task, runCosts(task).task),
  });
  const existing = await repo.findPullRequest(task.branch);
  if (existing === undefined) {
    return repo.openPullRequest({
      head: task.branch,
      base: task.defaultBranch,
      title,
      body,
      draft: mode === "draft",
    });
  }
  await repo.updatePullRequest(existing, { title, body });
  if (mode === "ready") await repo.markReady(existing);
  return existing;
}

/** Posts the review report on the pull request, as inert text. */
async function postReview(
  repo: Repository,
  task: TaskContext,
  record: TaskRecord,
  report: string,
  changes: string | undefined,
): Promise<void> {
  const pullRequest = record.pullRequest ?? (await repo.findPullRequest(task.branch));
  if (pullRequest === undefined) return;
  const body = [
    "### Codeman review",
    "",
    inertLines(report),
    ...(changes ? ["", "#### Changes asked of the code stage", "", inertLines(changes)] : []),
    "",
    `<sub>[Run](${task.runUrl})</sub>`,
  ].join("\n");
  await repo.comment(pullRequest, body);
}

/**
 * Moves the staged workflows into `.github/workflows/` on the task branch, with a token that
 * may write workflows, if they are what the maintainer saw: the staged files must not have
 * changed since the comment that accepted them.
 */
async function acceptWorkflows(task: TaskContext, repo: Repository): Promise<void> {
  const accept = task.accept;
  if (!task.record || !accept) return blocked(repo, task, "Nothing to accept.");
  const done = (message: string, errors: string[] = []): Promise<void> =>
    finish(repo, task, task.fromState, {
      record: { ...task.record, acceptedCommentId: accept.id } as TaskRecord,
      message,
      errors,
      retry: true,
    });

  const head = await repo.branchSha(task.branch);
  const staged = head ? await repo.filesUnder(head, STAGED_WORKFLOWS_DIR) : new Map();
  if (staged.size === 0) return done("There are no staged workflows to accept.");
  const before = await repo.commitAt(task.branch, accept.createdAt);
  const seen = before ? await repo.filesUnder(before, STAGED_WORKFLOWS_DIR) : new Map();
  const changed = [...staged]
    .filter(([path, file]) => seen.get(path)?.sha !== file.sha)
    .map(([path]) => workflowPath(path));
  if (changed.length > 0 || !head) {
    return done("The staged workflows changed after they were accepted.", [
      `Changed after ${accept.author}'s comment: ${changed.join(", ")}. Read them again, then comment \`/codeman accept-workflows\` again.`,
    ]);
  }

  const moved = [...staged.keys()].map(workflowPath);
  await repository("workflow-token").commit({
    branch: task.branch,
    baseSha: head,
    createBranch: false,
    changes: [...staged].flatMap(([path, file]) => [
      { path: workflowPath(path), content: null, sha: file.sha, mode: file.mode },
      { path, content: null },
    ]),
    message: `Accept workflows for #${task.number}\n\nAccepted by ${accept.author} in comment ${accept.id}.`,
  });
  const waiting = task.fromState === "awaiting-workflow";
  await done(
    `${accept.author} accepted ${moved.join(", ")}, now in \`.github/workflows/\` on the task branch.${waiting ? " Codeman goes on when their runs finish." : ""}`,
  );
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
    /** This run already wrote the pull request's description. */
    pullRequestWritten?: boolean;
  },
): Promise<void> {
  const cost = runCosts(task);
  let record = view.record ?? task.record ?? undefined;
  if (record && cost.task !== undefined) record = { ...record, spent: cost.task };
  if (record && task.action !== "record" && !view.retry) {
    // Handled, whatever the outcome: a failing request must not start run after run.
    record = {
      ...record,
      processedCommentId: Math.max(record.processedCommentId, task.processed.commentId),
      processedReviewId: Math.max(record.processedReviewId ?? 0, task.processed.reviewId),
    };
  }
  const errors = [...(task.action === "record" ? [] : task.problems), ...(view.errors ?? [])];
  // Workflows the agent wrote that wait for a maintainer, as they are on the branch now.
  const staged =
    task.action === "implement" || task.action === "accept"
      ? [
          ...(
            await repo.filesUnder(task.branch, STAGED_WORKFLOWS_DIR).catch(() => new Map())
          ).keys(),
        ].map(workflowPath)
      : [];
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
      staged,
      cost: {
        run: cost.run,
        task: cost.task ?? record?.spent,
        budget: task.settings["task-budget"],
      },
    }),
  );
  if (record?.pullRequest && !view.pullRequestWritten) {
    await repo.updatePullRequestFooter(
      record.pullRequest,
      pullRequestFooter(task.runUrl, spentLine(task, record.spent)),
    );
  }
  core.info(`#${task.number} is now ${state}.`);
}

/**
 * What this run and the whole task have spent, in USD, as far as known: `open-key` reports the
 * task's spend before the run, and `close-key` the run's.
 */
function runCosts(task: TaskContext): { run?: number | undefined; task?: number | undefined } {
  const amount = (name: string): number | undefined => {
    const value = Number.parseFloat(core.getInput(name));
    return Number.isFinite(value) ? value : undefined;
  };
  const before = amount("task-spent");
  const run = amount("run-cost");
  if (before === undefined) return { task: task.record?.spent };
  return { run, task: before + (run ?? 0) };
}

function spentLine(task: TaskContext, spent: number | undefined): string | undefined {
  return spent === undefined ? undefined : `${usd(spent)} of ${usd(task.settings["task-budget"])}`;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
