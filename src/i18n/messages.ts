import type { AgentMode } from "../inference/index.ts";
import type { DropReason } from "../policy.ts";
import type { CommandProblem } from "../problems.ts";
import type { Stage } from "../stages.ts";
import type { State } from "../state.ts";

/** How a run ended. */
export type RunOutcome =
  | "done"
  | "skipped"
  | "partial"
  | "blocked"
  | "awaiting-workflow"
  | "decisions"
  | "changes"
  | "out-of-time"
  | "failed";

/**
 * Every fixed text Codeman writes on issues and pull requests. Each catalog implements all of
 * them, so the type checker finds a missing one. Texts are trusted Markdown: they may hold
 * commands and links. Values in `${}` that come from users or the agent are made inert by the
 * caller.
 */
export interface Messages {
  /** The locale for numbers, such as `en-US`. */
  locale: string;

  // Formatting.
  money(amount: number): string;
  /** A token count, compact: `45.7K`. */
  tokens(count: number): string;
  /** With a third decimal: runs often cost less than a cent. */
  cost(amount: number): string;
  /** Tokens per second, with one decimal. */
  rate(perSecond: number): string;
  /** An ISO timestamp, in UTC. */
  dateTime(iso: string): string;
  /** "X of Y", for amounts. */
  of(part: string, whole: string): string;

  // Stages and runs.
  stage(stage: Stage | "plan" | "route"): string;
  /** What a run worked on and how it ended, such as "Design stage: skipped". */
  runTitle(run: {
    action: "plan" | "route" | "implement" | "record" | "accept";
    stage?: Stage | undefined;
    revised: boolean;
    outcome?: RunOutcome | undefined;
  }): string;

  // Status comment (the task's panel).
  heading(state: State | "new"): string;
  plan: string;
  pullRequest: string;
  decisions: string;
  recommended: string;
  chosenBy(by: string): string;
  answeredBy(by: string, text: string): string;
  howToAnswer: string;
  /** The status comment's link to the decisions comment. */
  decisionsLink(pending: number): string;
  /** The decisions comment of a task whose plan has no decisions now. */
  noDecisions: string;
  /** Decisions left out of the decisions comment, to fit the platform's comment size. */
  decisionsOmitted(count: number): string;
  /** Parts of the panel left out, to fit the platform's comment size. */
  panelCut: string;
  workflowsToReview: string;
  workflowsHelp: string;
  /** Pages under `docs/web/` fetched more than `days` days ago. */
  oldDocs: string;
  oldDocsHelp(days: number): string;
  daysOld(days: number): string;
  /** A page whose `updated_at` cannot be read. */
  noDate: string;
  morePages(count: number): string;
  spending: string;
  spent(cost: { run?: string | undefined; task: string; budget: string }): string;
  panelFooter(model: string, runUrl: string, reportUrl: string | undefined): string;

  /** For a labeled issue that a maintainer did not open. */
  refusedHeading: string;
  refused: string;

  // Run comments.
  nextStepLabel: string;
  /** What comes after a run that left the task in `state`. */
  nextStep(state: State | "new"): string;
  report: string;
  problems: string;
  costHeading: string;
  runFooter(model: string, spent: string | undefined, runUrl: string): string;

  // Spend table.
  tableHeader: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  /** The provider column: the provider and, on Runpod, the mode. */
  provider(mode: AgentMode): string;
  /** A note under the table: how a run's cost and the month are measured with `mode`. */
  spendNote(mode: AgentMode): string;
  earlierRuns(runs: number): string;
  /** The label of the row that totals every run of the task. */
  totalRow(runs: number): string;
  runsWithoutRow: string;

  // Pull request.
  fullPlan: string;
  changes: string;
  squashMessage: string;
  pullRequestFooter(spent: string | undefined, runUrl: string): string;
  draftSummary: string;
  readySummary(code: string | undefined, test: string | undefined): string;
  reviewHeading: string;
  reviewChanges: string;
  run: string;

  // Start of a run.
  startPlan(revising: boolean): string;
  startStage(stage: Stage): string;
  startRoute: string;
  startWithWorkflowResults: string;
  startWithChanges: string;
  startContinue: string;

  // How to go on.
  continueHint: string;
  /** After a stage's agent reported `blocked`, often over a request the plan does not cover. */
  stageBlockedHint: string;
  replanHint: string;
  removeLabelHint: string;

  // Keys and budget.
  noKey: string;
  taskBudgetSpent(spent: string, budget: string, minimum: string): string;
  monthlyBudgetReached(used: string, budget: string, limit: string): string;
  tryLater(reason: string): string;

  // Results.
  planUnfinished: string;
  noResult: string;
  couldNotUse: string;
  ignoredChange(path: string): string;
  /** A text of the agent's output was too long: `length` characters, cut to `max`. */
  cutText(field: string, length: number, max: number): string;
  droppedChange(path: string, reason: DropReason): string;
  outOfTime: string;
  partial: string;
  maxRuns(stage: Stage, runs: number, max: number): string;
  stageNeedsMaintainer(stage: Stage): string;
  agentReports(reason: string): string;
  missingWorkflows(paths: string): string;
  awaitingWorkflows(stage: Stage, paths: string, reason: string): string;
  /** A stage needs the runs of workflows that are still staged, so the task goes on meanwhile. */
  deferredWorkflows(stage: Stage, paths: string, reason: string, next: Stage | undefined): string;
  /** Review passed, and the staged workflows wait to be accepted. */
  acceptAfterReview(paths: string): string;
  stageDecisions(stage: Stage, count: number): string;
  reviewRounds(rounds: number, max: number): string;
  skipped(reason: string): string;
  workDone: string;

  // Routing.
  /** The stages the routing agent chose, as a list of stage names. */
  routeChosen(stages: string): string;
  routeLabel: string;
  leftOutLabel: string;
  /** The router's result could not be used: the stages run in their fixed order. */
  routeFallback(stages: string): string;

  // Accepting workflows.
  accepted(by: string, paths: string): string;
  acceptWaits: string;
  acceptResumes(stage: Stage): string;
  nothingStaged: string;
  stagedChanged: string;
  stagedChangedDetail(by: string, paths: string): string;

  // Answers.
  allAnswered: string;
  stillPending(count: number): string;
  commandProblem(problem: CommandProblem): string;
}
