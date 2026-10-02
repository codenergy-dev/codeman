import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_RUN_BUDGET, runLimit } from "../budget.ts";
import type { Change } from "../collect.ts";
import { type Messages, messages, type RunOutcome, taskLanguage } from "../i18n/index.ts";
import { type Cut, MARGIN, outputLimits, parsePlanOutput, parseStageOutput } from "../output.ts";
import type { Conventions } from "../platform/conventions.ts";
import type { Platform } from "../platform/platform.ts";
import type { FileChange } from "../platform/types.ts";
import {
  checkChanges,
  defaultIgnore,
  IGNORE_FILE,
  STAGED_WORKFLOWS_DIR,
  stagedPath,
  workflowPath,
} from "../policy.ts";
import type { CommandError } from "../problems.ts";
import { pullRequestBody, pullRequestFooter, pullRequestTitle, replaceFooter } from "../pull.ts";
import {
  applyCommands,
  nextDecisionId,
  pendingDecisions,
  planRecord,
  type TaskRecord,
  writeAnswers,
} from "../record.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { Services } from "../services.ts";
import { addRow, parseCosts, refreshCosts, type SpendRow } from "../spend.ts";
import { nextStage, STAGE_STATE, type Stage } from "../stages.ts";
import type { State } from "../state.ts";
import { decisionsUrl, renderDecisions, renderRun, renderStatus, reportUrl } from "../status.ts";
import { commandsAfter, type TaskContext } from "../tasks.ts";
import { oneLine, safeMarkdown, truncate } from "../text.ts";
import { checkPlanResult, decodeText, isManifest } from "../validate.ts";
import { MAX_OUTPUT_BYTES } from "./agent.ts";
import { readTask, resultDir } from "./common.ts";

/**
 * Validates what the earlier jobs produced and writes it to the platform. Runs no LLM. Everything it
 * reads from the agent's result is treated as untrusted.
 */
export async function apply(services: Services): Promise<void> {
  const { runtime } = services;
  const task = readTask(runtime);
  const io: Io = {
    repo: services.platform(),
    runtime,
    conventions: services.conventions,
    jobs: jobResults(runtime),
    resultDir: resultDir(runtime),
    workflowsPlatform: () => services.platform("workflows"),
  };
  const chain = chains(task.action, io.jobs.keyJob, io.jobs.keyStatus);
  if (task.action === "record") await recordAnswers(task, io);
  else if (task.action === "accept") await acceptWorkflows(task, io);
  else if (await keyFailed(task, io)) return;
  else if (task.action === "implement") await applyStage(task, io);
  else await applyPlan(task, io);
  runtime.output("chain", String(chain));
}

/** What apply works with. */
interface Io {
  repo: Platform;
  runtime: Runtime;
  conventions: Conventions;
  jobs: JobResults;
  /** Where the agent job's result is: `manifest.json`, `output.json` and `tree/`. */
  resultDir: string;
  /** The platform with credentials that may write workflows, to accept staged ones. */
  workflowsPlatform: () => Platform;
}

/** What the earlier jobs report, from the step's inputs. Older workflow files lack some. */
export interface JobResults {
  /** The result of the key job: `success`, `failure`, `skipped` or `cancelled`. */
  keyJob: string;
  /** Its status output: `opened`, `over-budget` or `task-budget-spent`. */
  keyStatus: string;
  /** The result of the agent job. */
  agentJob: string;
  taskSpent?: number | undefined;
  monthSpent?: number | undefined;
  keyLimit?: number | undefined;
  runCost?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  /** What each run of the task spent, by run ID, as `close-key` read it. */
  taskCosts?: Record<string, number> | undefined;
}

export function jobResults(runtime: Runtime): JobResults {
  const amount = (name: string): number | undefined => {
    const value = Number.parseFloat(runtime.input(name));
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    keyJob: runtime.input("key-job-result"),
    keyStatus: runtime.input("key-status"),
    agentJob: runtime.input("agent-job-result"),
    taskSpent: amount("task-spent"),
    monthSpent: amount("month-spent"),
    keyLimit: amount("key-limit"),
    runCost: amount("run-cost"),
    inputTokens: amount("input-tokens"),
    outputTokens: amount("output-tokens"),
    taskCosts: parseCosts(runtime.input("task-costs")),
  };
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
async function keyFailed(task: TaskContext, io: Io): Promise<boolean> {
  const t = say(task);
  if (io.jobs.keyJob !== "success") {
    await finish(io, task, "blocked", {
      outcome: "failed",
      message: `${t.noKey} ${retryHint(t, task)}`,
    });
    return true;
  }
  const status = io.jobs.keyStatus;
  const spent = io.jobs.taskSpent ?? 0;
  const budget = task.settings["task-budget"];
  if (status === "task-budget-spent") {
    await finish(io, task, "blocked", {
      outcome: "blocked",
      message: t.taskBudgetSpent(t.money(spent), t.money(budget), t.money(MIN_RUN_BUDGET)),
    });
    return true;
  }
  if (status !== "opened") {
    // Not the task's fault: go back to where it was, and try again in a later run.
    const reason =
      status === "over-budget"
        ? t.monthlyBudgetReached(
            t.money(io.jobs.monthSpent ?? 0),
            t.money(task.settings["monthly-budget"]),
            t.money(runLimit(budget, spent) ?? 0),
          )
        : t.noKey;
    await finish(io, task, task.fromState === "planning" ? "new" : task.fromState, {
      message: t.tryLater(reason),
      retry: true,
    });
    return true;
  }
  return false;
}

async function applyPlan(task: TaskContext, io: Io): Promise<void> {
  if (io.jobs.agentJob !== "success") {
    const t = say(task);
    return finish(io, task, "blocked", {
      outcome: "failed",
      message: `${t.planUnfinished} ${retryHint(t, task)}`,
    });
  }

  const dir = io.resultDir;
  const manifest = readJson(join(dir, "manifest.json"));
  const checked = checkPlanResult(manifest, task.planPath);
  if (!checked.ok) return blocked(io, task, checked.error);

  const planFile = join(dir, "tree", task.planPath);
  if (!lstatSync(planFile).isFile()) return blocked(io, task, `${task.planPath} is not a file.`);
  const plan = decodeText(readFileSync(planFile));
  if (plan === undefined) return blocked(io, task, `${task.planPath} is not UTF-8 text.`);

  const outputFile = join(dir, "output.json");
  if (!existsSync(outputFile)) return blocked(io, task, "The agent did not write output.json.");
  const output = parsePlanOutput(
    readFileSync(outputFile, "utf8").slice(0, MAX_OUTPUT_BYTES),
    outputLimits(task.settings),
    nextDecisionId(task.record),
  );
  if (!output.ok) return blocked(io, task, output.error);

  // A revised plan keeps the settled decisions, numbered before its own.
  const record = planRecord(task.record, {
    branch: task.branch,
    planPath: task.planPath,
    summary: output.value.summary,
    decisions: [...task.settled, ...output.value.decisions],
    // Commands posted before this plan existed do not answer its decisions.
    processedCommentId: task.processed.commentId,
    processedReviewId: task.processed.reviewId,
    language: output.value.language ?? task.record?.language,
  });
  await io.repo.commit({
    branch: task.branch,
    baseSha: task.baseSha,
    createBranch: !task.branchExists,
    // The settled decisions' answers, in the plan from the start.
    changes: [{ path: task.planPath, content: Buffer.from(writeAnswers(plan, record), "utf8") }],
    message: `Plan #${task.number}: ${truncate(oneLine(task.title), 60)}`,
  });

  const state = pendingDecisions(record).length > 0 ? "awaiting-decision" : "ready";
  const t = say(task, record);
  const ignored = checked.value.ignored.map((path) => t.ignoredChange(path));
  await finish(io, task, state, {
    outcome: "done",
    record,
    errors: [...ignored, ...cutTexts(t, output.value.cuts)],
  });
}

/**
 * Commits a stage's work to the task branch, whatever its outcome, so no work is lost; then
 * moves the task to the next stage, or back, or to a human. Review commits nothing.
 */
async function applyStage(task: TaskContext, io: Io): Promise<void> {
  if (!task.record) return blocked(io, task, "The task has no record of its plan.");
  const stage = task.stage ?? "code";
  const t = say(task);
  const dir = io.resultDir;
  const manifest = readJson(join(dir, "manifest.json"));
  if (!isManifest(manifest)) {
    return finish(io, task, "blocked", {
      outcome: "failed",
      message: `${t.noResult} ${retryHint(t, task)}`,
    });
  }
  // Review's merge and checks stay in its sandbox.
  const checked =
    stage === "review"
      ? { ok: true as const, value: { accepted: [], staged: [], dropped: [] } }
      : checkChanges(manifest, {
          ignore: task.ignore,
          workflows: io.conventions.workflows,
          maxFiles: task.settings["max-files"],
          maxFileBytes: task.settings["max-file-bytes"],
          planPath: task.planPath,
        });
  if (!checked.ok) return blocked(io, task, checked.error);
  // What the maintainers should know of: dropped changes, and texts of the output that were cut.
  const warnings = checked.value.dropped.map(({ path, reason }) => t.droppedChange(path, reason));

  const outputFile = join(dir, "output.json");
  const output = existsSync(outputFile)
    ? parseStageOutput(
        readFileSync(outputFile, "utf8").slice(0, MAX_OUTPUT_BYTES),
        stage,
        outputLimits(task.settings),
        io.conventions.workflows,
      )
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
  const unfinished = (
    outcome: "partial" | "out-of-time",
    message: string,
    report?: string,
  ): Promise<void> =>
    finish(io, task, runs >= maxRuns ? "blocked" : STAGE_STATE[stage], {
      outcome,
      record,
      message: runs >= maxRuns ? `${message} ${t.maxRuns(stage, runs, maxRuns)}` : message,
      report,
      errors: warnings,
    });

  const tree = join(dir, "tree");
  const changes = [
    ...readChanges(tree, checked.value.accepted, task.settings),
    ...readChanges(tree, checked.value.staged, task.settings).map((change) => ({
      ...change,
      path: stagedPath(change.path, io.conventions.workflows),
    })),
  ];
  let head = task.baseSha;
  if (changes.length > 0) {
    head = await io.repo.commit({
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
      return unfinished("out-of-time", t.outOfTime);
    }
    const exit = manifest.exitCode === 0 ? "" : ` The agent exited with code ${manifest.exitCode}.`;
    return blocked(io, task, `${output.error}${exit}`, warnings, record);
  }

  warnings.push(...cutTexts(t, output.value.cuts));
  const { status, summary, reason } = output.value;
  switch (status) {
    case "partial":
      return unfinished("partial", t.partial, summary);
    case "blocked":
      return finish(io, task, "blocked", {
        outcome: "blocked",
        record,
        message: `${t.stageNeedsMaintainer(stage)} ${retryHint(t, task)}`,
        report: summary,
        errors: [t.agentReports(reason ?? ""), ...warnings],
      });
    case "awaiting-workflow": {
      const workflows = output.value.workflows ?? [];
      const staged = new Set(
        [...(await io.repo.filesUnder(head, STAGED_WORKFLOWS_DIR)).keys()].map((path) =>
          workflowPath(path, io.conventions.workflows),
        ),
      );
      const present = new Set([
        ...(await io.repo.filesUnder(head, io.conventions.workflows.dir)).keys(),
        ...staged,
      ]);
      const missing = workflows.filter((path) => !present.has(path));
      if (missing.length > 0) {
        return blocked(io, task, t.missingWorkflows(missing.join(", ")), warnings, record);
      }
      const deferring = defer(record, stage, workflows, staged);
      if (deferring) {
        const next = nextStage(stage) ?? "review";
        return handOver(
          "awaiting-workflow",
          summary,
          deferring,
          t.deferredWorkflows(stage, workflows.join(", "), reason ?? "", next),
        );
      }
      return finish(io, task, "awaiting-workflow", {
        outcome: "awaiting-workflow",
        record: { ...record, runs: runs - 1, awaiting: workflows },
        message: t.awaitingWorkflows(stage, workflows.join(", "), reason ?? ""),
        report: summary,
        errors: warnings,
      });
    }
    case "decisions": {
      // Review's questions are answered before the code stage acts on its report.
      const offset = record.decisions.length;
      const added = (output.value.decisions ?? []).map((decision) => ({
        ...decision,
        id: decision.id + offset,
      }));
      if (stage === "review") await postReview(io, t, task, record, summary, reason);
      return finish(io, task, "awaiting-decision", {
        outcome: "decisions",
        record: {
          ...record,
          decisions: [...record.decisions, ...added],
          stage: stage === "review" ? "code" : stage,
          runs: 0,
          handoff: stage === "review" ? { stage, text: truncate(summary, 4000) } : record.handoff,
        },
        message: t.stageDecisions(stage, added.length),
        report: summary,
        errors: warnings,
      });
    }
    case "changes": {
      const rounds = (record.reviewRounds ?? 0) + 1;
      await postReview(io, t, task, record, summary, reason);
      if (rounds > maxRuns) {
        return finish(io, task, "blocked", {
          outcome: "changes",
          record: { ...record, reviewRounds: rounds },
          message: t.reviewRounds(rounds, maxRuns),
          report: summary,
          errors: warnings,
        });
      }
      return finish(io, task, STAGE_STATE.code, {
        outcome: "changes",
        record: {
          ...record,
          stage: "code",
          runs: 0,
          reviewRounds: rounds,
          handoff: { stage, text: truncate(`${reason ?? ""}\n\n${summary}`, 4000) },
        },
        report: summary,
        errors: warnings,
      });
    }
  }

  if (stage !== "review") {
    return status === "skipped"
      ? handOver("skipped", reason ?? "", record, undefined, t.skipped(reason ?? ""))
      : handOver("done", summary, record);
  }

  // Review passed.
  if (task.ignore === null && (await io.repo.readFile(task.branch, IGNORE_FILE)) === undefined) {
    head = await io.repo.commit({
      branch: task.branch,
      baseSha: head,
      createBranch: false,
      changes: [
        {
          path: IGNORE_FILE,
          content: Buffer.from(defaultIgnore(io.conventions.workflows), "utf8"),
        },
      ],
      message: `Add ${IGNORE_FILE}\n\nThe paths Codeman's agent may not change. Review them before merging.`,
    });
  }
  const staged = [...(await io.repo.filesUnder(head, STAGED_WORKFLOWS_DIR)).keys()].map((path) =>
    workflowPath(path, io.conventions.workflows),
  );
  const next = afterReview(t, record, staged);
  const pullRequest = await openPullRequest(
    io,
    task,
    record,
    next.state === "done" ? "ready" : "draft",
  );
  const reviewed = { ...next.record, pullRequest };
  await postReview(io, t, { ...task, record: reviewed }, reviewed, summary, undefined);
  await finish(io, task, next.state, {
    outcome: "done",
    pullRequestWritten: true,
    record: reviewed,
    message: next.message,
    report: summary,
    errors: warnings,
  });

  /**
   * Hands the task over to the next stage, with this stage's report as its notes. When code
   * ends, the pull request opens as a draft.
   */
  async function handOver(
    outcome: "done" | "skipped" | "awaiting-workflow",
    report: string,
    base: TaskRecord,
    message?: string,
    notes = report,
  ): Promise<void> {
    const next = nextStage(stage) ?? "review";
    // Kept short: the record lives in the status comment, which the platform limits in size.
    const text = truncate(notes, 2000);
    const updated: TaskRecord = {
      ...base,
      stage: next,
      runs: 0,
      handoff: { stage, text },
      reports: { ...base.reports, [stage]: text },
      commitMessage:
        stage === "code" && output.ok && output.value.commitMessage
          ? output.value.commitMessage
          : base.commitMessage,
    };
    if (stage === "code") {
      updated.pullRequest = await openPullRequest(io, task, updated, "draft");
    }
    return finish(io, task, STAGE_STATE[next], {
      outcome,
      record: updated,
      message,
      report,
      errors: warnings,
    });
  }
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
  io: Io,
  task: TaskContext,
  record: TaskRecord,
  mode: "draft" | "ready",
): Promise<number> {
  const t = say(task, record);
  const title = pullRequestTitle(task.title);
  const body = pullRequestBody({
    t,
    conventions: io.conventions,
    closes: io.repo.closingReference(task.number),
    planPath: task.planPath,
    planUrl: io.repo.fileUrl(task.branch, task.planPath),
    planSummary: record.summary,
    summary:
      mode === "ready"
        ? t.readySummary(record.reports?.code, record.reports?.test)
        : t.draftSummary,
    commitMessage: record.commitMessage ?? "",
    runUrl: task.runUrl,
    spent: spentLine(t, task, runCosts(io, task).task),
  });
  const existing = await io.repo.findChangeRequest(task.branch);
  if (existing === undefined) {
    return io.repo.openChangeRequest({
      head: task.branch,
      base: task.defaultBranch,
      title,
      body,
      draft: mode === "draft",
    });
  }
  await io.repo.updateChangeRequest(existing, { title, body });
  if (mode === "ready") await io.repo.markReady(existing);
  return existing;
}

/** Posts the review report on the pull request, as safe Markdown. */
async function postReview(
  io: Io,
  t: Messages,
  task: TaskContext,
  record: TaskRecord,
  report: string,
  changes: string | undefined,
): Promise<void> {
  const pullRequest = record.pullRequest ?? (await io.repo.findChangeRequest(task.branch));
  if (pullRequest === undefined) return;
  const body = [
    `### ${t.reviewHeading}`,
    "",
    safeMarkdown(report, io.conventions.markdown),
    ...(changes
      ? ["", `#### ${t.reviewChanges}`, "", safeMarkdown(changes, io.conventions.markdown)]
      : []),
    "",
    `<sub>[${t.run}](${task.runUrl})</sub>`,
  ].join("\n");
  await io.repo.commentOnChangeRequest(pullRequest, body);
}

/** Updates the last line of Codeman's description, if a human has not removed it. */
async function updateFooter(repo: Platform, number: number, footer: string): Promise<void> {
  const { title, body } = await repo.getChangeRequest(number);
  const updated = replaceFooter(body, footer);
  if (updated !== body) await repo.updateChangeRequest(number, { title, body: updated });
}

/**
 * Moves the staged workflows into the workflow directory on the task branch, with a token that
 * may write workflows, if they are what the maintainer saw: the staged files must not have
 * changed since the comment that accepted them.
 */
async function acceptWorkflows(task: TaskContext, io: Io): Promise<void> {
  const accept = task.accept;
  if (!task.record || !accept) return blocked(io, task, "Nothing to accept.");
  const t = say(task);
  const done = (message: string, errors: string[] = []): Promise<void> =>
    finish(io, task, task.fromState, {
      outcome: "failed",
      record: { ...task.record, acceptedCommentId: accept.id } as TaskRecord,
      message,
      errors,
      retry: true,
    });

  const head = await io.repo.branchSha(task.branch);
  const staged = head ? await io.repo.filesUnder(head, STAGED_WORKFLOWS_DIR) : new Map();
  if (staged.size === 0) return done(t.nothingStaged);
  const before = await io.repo.commitAt(task.branch, accept.createdAt);
  const seen = before ? await io.repo.filesUnder(before, STAGED_WORKFLOWS_DIR) : new Map();
  const changed = [...staged]
    .filter(([path, file]) => seen.get(path)?.sha !== file.sha)
    .map(([path]) => workflowPath(path, io.conventions.workflows));
  if (changed.length > 0 || !head) {
    return done(t.stagedChanged, [t.stagedChangedDetail(accept.author, changed.join(", "))]);
  }

  const moved = [...staged.keys()].map((path) => workflowPath(path, io.conventions.workflows));
  await io.workflowsPlatform().commit({
    branch: task.branch,
    baseSha: head,
    createBranch: false,
    changes: [...staged].flatMap(([path, file]) => [
      {
        path: workflowPath(path, io.conventions.workflows),
        content: null,
        sha: file.sha,
        mode: file.mode,
      },
      { path, content: null },
    ]),
    message: `Accept workflows for #${task.number}\n\nAccepted by ${accept.author} in comment ${accept.id}.`,
  });
  const next = afterAccept(t, task.fromState, task.record, accept.author, moved);
  const record: TaskRecord = { ...next.record, acceptedCommentId: accept.id };
  // Review already passed, and nothing waits for the workflows' runs: the work is done.
  if (next.state === "done") record.pullRequest = await openPullRequest(io, task, record, "ready");
  await finish(io, task, next.state, {
    outcome: "done",
    record,
    message: `${t.accepted(accept.author, moved.join(", "))} ${next.message}`.trim(),
    retry: true,
    pullRequestWritten: next.state === "done",
  });
}

/**
 * The record of a stage that waits for workflows still staged, which cannot run before a
 * maintainer accepts them: review goes first, and the stage goes on with their results after
 * the accept. Undefined when every awaited workflow is already accepted.
 */
export function defer(
  record: TaskRecord,
  stage: Stage,
  workflows: readonly string[],
  staged: ReadonlySet<string>,
): TaskRecord | undefined {
  return workflows.some((path) => staged.has(path))
    ? { ...record, deferred: { stage, workflows: [...workflows] } }
    : undefined;
}

/**
 * Where a task goes once review passed. Staged workflows would be merged where they never
 * run, so they wait for the accept, and the pull request stays a draft. A stage that deferred
 * their runs, when they were accepted meanwhile, waits for them now.
 */
export function afterReview(
  t: Messages,
  record: TaskRecord,
  staged: readonly string[],
): { state: State; record: TaskRecord; message: string } {
  const reviewed: TaskRecord = {
    ...record,
    stage: undefined,
    runs: 0,
    reviewRounds: 0,
    handoff: undefined,
  };
  if (staged.length > 0) {
    return {
      state: "awaiting-workflow",
      record: { ...reviewed, reviewed: true },
      message: t.acceptAfterReview(staged.join(", ")),
    };
  }
  const deferred = record.deferred;
  if (deferred) {
    return {
      state: "awaiting-workflow",
      record: {
        ...reviewed,
        stage: deferred.stage,
        awaiting: deferred.workflows,
        deferred: undefined,
      },
      message: t.acceptWaits,
    };
  }
  return { state: "done", record: reviewed, message: t.workDone };
}

/**
 * Where a task goes once a maintainer accepted its staged workflows:
 * - after review passed, to the runs a stage deferred, or else to done;
 * - a task that waits for them goes on when their runs finish;
 * - a blocked stage resumes, with a fresh run count, since accepting answers what it most
 *   likely waited for.
 */
export function afterAccept(
  t: Messages,
  state: State | "new",
  record: TaskRecord,
  by: string,
  workflows: string[],
): { state: State | "new"; record: TaskRecord; message: string } {
  const accepted = { ...record, accepted: { by, workflows } };
  if (state === "awaiting-workflow" && record.reviewed) {
    const reviewed = { ...accepted, reviewed: undefined };
    const deferred = record.deferred;
    if (!deferred) {
      return { state: "done", record: { ...reviewed, accepted: undefined }, message: t.workDone };
    }
    return {
      state,
      record: {
        ...reviewed,
        stage: deferred.stage,
        awaiting: deferred.workflows,
        deferred: undefined,
        runs: 0,
      },
      message: t.acceptWaits,
    };
  }
  if (state === "awaiting-workflow") {
    return { state, record: accepted, message: t.acceptWaits };
  }
  if (state === "blocked" && record.stage) {
    return {
      state: STAGE_STATE[record.stage],
      record: { ...accepted, runs: 0 },
      message: t.acceptResumes(record.stage),
    };
  }
  return { state, record: accepted, message: "" };
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

async function recordAnswers(task: TaskContext, io: Io): Promise<void> {
  if (!task.record) return blocked(io, task, "The task has no record of its decisions.");
  const sources = commandsAfter(task.comments, task.record.processedCommentId);
  const { record, errors } = applyCommands(task.record, sources);

  const plan = await io.repo.readFile(task.branch, task.planPath);
  if (plan === undefined) {
    return blocked(io, task, `The plan ${task.planPath} is missing from ${task.branch}.`);
  }
  const updated = writeAnswers(plan, record);
  if (updated !== plan) {
    const head = await io.repo.branchSha(task.branch);
    if (!head) return blocked(io, task, `The branch ${task.branch} is missing.`);
    await io.repo.commit({
      branch: task.branch,
      baseSha: head,
      createBranch: false,
      changes: [{ path: task.planPath, content: Buffer.from(updated, "utf8") }],
      message: `Record decisions for #${task.number}`,
    });
  }

  const pending = pendingDecisions(record).length;
  const t = say(task);
  await finish(io, task, pending === 0 ? "ready" : "awaiting-decision", {
    record,
    errors: errors.map((error) => commandError(t, error)),
    message: pending === 0 ? t.allAnswered : t.stillPending(pending),
  });
}

/** Each cut text of the agent's output, in the task's language. */
function cutTexts(t: Messages, cuts: readonly Cut[]): string[] {
  return cuts.map((cut) => t.cutText(cut.field, cut.length, cut.limit * MARGIN));
}

/** How a maintainer sends a blocked task back to work. */
function retryHint(t: Messages, task: TaskContext): string {
  if (task.action === "implement") return t.continueHint;
  if (task.record) return t.replanHint;
  return t.removeLabelHint;
}

/** The task's messages, in the language of its settings, or else of its record. */
function say(task: TaskContext, record: TaskRecord | null | undefined = task.record): Messages {
  return messages(taskLanguage(task.settings.language, record?.language));
}

/** A problem with a command, in the task's language. */
export function commandError(t: Messages, error: CommandError): string {
  return `${error.text ? `${error.text}: ` : ""}${t.commandProblem(error.problem)}`;
}

function blocked(
  io: Io,
  task: TaskContext,
  error: string,
  more: readonly string[] = [],
  record?: TaskRecord,
): Promise<void> {
  io.runtime.error(oneLine(error));
  const t = say(task, record);
  return finish(io, task, "blocked", {
    outcome: "failed",
    record,
    message: `${t.couldNotUse} ${retryHint(t, task)}`,
    errors: [error, ...more],
  });
}

async function finish(
  io: Io,
  task: TaskContext,
  state: State | "new",
  view: {
    /** How the run ended, for its comment's title. */
    outcome?: RunOutcome;
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
  const cost = runCosts(io, task);
  const spend = spendRow(io, task, cost.run);
  let record = view.record ?? task.record ?? undefined;
  if (record && cost.task !== undefined) record = { ...record, spent: cost.task };
  if (record && spend) record = { ...record, spending: addRow(record.spending, spend) };
  // Earlier runs may have read their cost before OpenRouter counted it.
  const costs = io.jobs.taskCosts;
  if (record?.spending && costs) {
    record = {
      ...record,
      spending: refreshCosts(record.spending, costs, (url) => io.runtime.runIdOf(url)),
    };
  }
  // A stage ran and saw the accepted workflows.
  if (record && task.action === "implement" && !view.retry)
    record = { ...record, accepted: undefined };
  if (record && task.action !== "record" && !view.retry) {
    // Handled, whatever the outcome: a failing request must not start run after run.
    record = {
      ...record,
      processedCommentId: Math.max(record.processedCommentId, task.processed.commentId),
      processedReviewId: Math.max(record.processedReviewId ?? 0, task.processed.reviewId),
    };
  }
  const t = say(task, record);
  const problems = task.action === "record" ? [] : task.problems;
  const errors = [...problems.map((error) => commandError(t, error)), ...(view.errors ?? [])];
  // Workflows the agent wrote that wait for a maintainer, as they are on the branch now.
  const staged =
    task.action === "implement" || task.action === "accept"
      ? [
          ...(
            await io.repo.filesUnder(task.branch, STAGED_WORKFLOWS_DIR).catch(() => new Map())
          ).keys(),
        ].map((path) => workflowPath(path, io.conventions.workflows))
      : [];
  const spent = {
    run: cost.run,
    task: cost.task ?? record?.spent,
    budget: task.settings["task-budget"],
  };
  await io.repo.setState(task.number, await io.repo.currentLabels(task.number), state);
  // A run that waits to try again moved nothing: only the panel says so.
  const quiet = view.retry && (task.action === "plan" || task.action === "implement");
  if (!quiet) {
    const id = await io.repo.comment(
      task.number,
      renderRun({
        t,
        conventions: io.conventions,
        title: t.runTitle({
          action: task.action,
          stage: task.stage,
          revised: !!task.record,
          outcome: view.outcome,
        }),
        state,
        model: task.model,
        runUrl: task.runUrl,
        message: view.message,
        report: view.report,
        errors,
        cost: spent,
        spend,
      }),
    );
    if (record) record = { ...record, reportCommentId: id };
  }
  // Before the panel, which records the comment's ID. Once a task has one, it stays current.
  if (record && (record.decisions.length > 0 || record.decisionsCommentId)) {
    const id = await io.repo.upsertComment(
      task.number,
      record.decisionsCommentId ?? null,
      renderDecisions({ t, conventions: io.conventions, state, record }),
    );
    record = { ...record, decisionsCommentId: id };
  }
  await io.repo.upsertComment(
    task.number,
    task.statusCommentId,
    renderStatus({
      t,
      conventions: io.conventions,
      state,
      record,
      model: task.model,
      runUrl: task.runUrl,
      planUrl: record ? io.repo.fileUrl(task.branch, record.planPath) : undefined,
      pullRequest: record?.pullRequest
        ? {
            reference: io.repo.changeRequestReference(record.pullRequest),
            url: io.repo.changeRequestUrl(record.pullRequest),
          }
        : undefined,
      message: view.message,
      staged,
      cost: spent,
      reportUrl: reportUrl(record, (id) => io.repo.commentUrl(task.url, id)),
      decisionsUrl: decisionsUrl(record, (id) => io.repo.commentUrl(task.url, id)),
    }),
  );
  if (record?.pullRequest && !view.pullRequestWritten) {
    await updateFooter(
      io.repo,
      record.pullRequest,
      pullRequestFooter(t, task.runUrl, spentLine(t, task, record.spent)),
    );
  }
  io.runtime.info(`#${task.number} is now ${state}.`);
}

/**
 * What this run and the whole task have spent, in USD, as far as known: `close-key` reports what
 * each run of the task spent, read last; older workflow files have only `open-key`'s task spend
 * before the run and `close-key`'s run cost.
 */
function runCosts(
  io: Io,
  task: TaskContext,
): { run?: number | undefined; task?: number | undefined } {
  const { taskSpent: before, runCost: run, taskCosts: costs } = io.jobs;
  if (costs) {
    const id = io.runtime.runIdOf(task.runUrl);
    const total = Object.values(costs).reduce((sum, value) => sum + value, 0);
    return { run: (id === undefined ? undefined : costs[id]) ?? run, task: total };
  }
  if (before === undefined) return { task: task.record?.spent };
  return { run, task: before + (run ?? 0) };
}

/** The spend table's row for a run that opened a key; older workflow files lack some inputs. */
function spendRow(io: Io, task: TaskContext, cost: number | undefined): SpendRow | undefined {
  if (io.jobs.keyStatus !== "opened") return undefined;
  if (task.action !== "plan" && task.action !== "implement") return undefined;
  return {
    runUrl: task.runUrl,
    at: new Date().toISOString(),
    stage: task.action === "plan" ? "plan" : (task.stage ?? "code"),
    model: task.model,
    cost,
    keyLimit: io.jobs.keyLimit,
    taskBudget: task.settings["task-budget"],
    monthlyBudget: task.settings["monthly-budget"],
    monthSpent: io.jobs.monthSpent,
    durationMs: agentDuration(io.resultDir),
    inputTokens: io.jobs.inputTokens,
    outputTokens: io.jobs.outputTokens,
  };
}

/** How long the agent ran, as the agent job measured it outside the sandbox. */
function agentDuration(dir: string): number | undefined {
  const manifest = readJson(join(dir, "manifest.json"));
  const ms = isManifest(manifest) ? manifest.durationMs : undefined;
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

function spentLine(t: Messages, task: TaskContext, spent: number | undefined): string | undefined {
  return spent === undefined
    ? undefined
    : t.of(t.money(spent), t.money(task.settings["task-budget"]));
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
