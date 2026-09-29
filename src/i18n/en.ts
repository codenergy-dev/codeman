import type { Messages } from "./messages.ts";

const OUTCOMES = {
  done: "done",
  skipped: "skipped",
  partial: "unfinished",
  blocked: "blocked",
  "awaiting-workflow": "waiting for workflows",
  decisions: "decisions needed",
  changes: "changes requested",
  "out-of-time": "out of time",
  failed: "failed",
};

const STAGES = { plan: "plan", design: "design", code: "code", test: "test", review: "review" };

const number = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const en: Messages = {
  locale: "en-US",

  money: (amount) => `US$ ${number(2).format(amount)}`,
  tokens: (count) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(count),
  cost: (amount) => `US$ ${number(3).format(amount)}`,
  dateTime: (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`,
  of: (part, whole) => `${part} of ${whole}`,

  stage: (stage) => STAGES[stage],
  runTitle: ({ action, stage, revised, outcome }) => {
    const ended = outcome ? OUTCOMES[outcome] : "";
    switch (action) {
      case "plan":
        return outcome === "done"
          ? revised
            ? "Plan: revised"
            : "Plan: written"
          : `Plan: ${ended}`;
      case "implement":
        return `${capitalize(STAGES[stage ?? "code"])} stage${ended ? `: ${ended}` : ""}`;
      case "record":
        return "Answers recorded";
      case "accept":
        return outcome === "failed" ? "Workflows not accepted" : "Workflows accepted";
    }
  },

  heading: (state) =>
    ({
      new: "Waiting to start",
      planning: "Writing the plan",
      "awaiting-decision": "Waiting for your decisions",
      ready: "Ready to implement",
      designing: "Designing",
      coding: "Writing the code",
      testing: "Testing",
      reviewing: "Reviewing",
      "in-progress": "Implementing",
      "awaiting-workflow": "Waiting for a workflow",
      blocked: "Blocked",
      done: "Done",
    })[state],
  plan: "Plan",
  pullRequest: "Pull request",
  decisions: "Decisions",
  recommended: "recommended",
  chosenBy: (by) => `chosen by ${by}`,
  answeredBy: (by, text) => `Answered by ${by}: ${text}`,
  howToAnswer:
    "Answer with `/codeman decide 1 a` (several at once: `/codeman decide 1 a 2 b`), or accept every recommendation with `/codeman approve`. To answer in your own words, use `/codeman answer 1 <text>`; to have the plan revised, use `/codeman replan <what to change>`. Only people with write access to the repository can answer.",
  workflowsToReview: "Workflows to review",
  workflowsHelp:
    "The agent wrote these workflows. They are staged under `.codeman/workflows/` on the task branch and do not run. A workflow runs with the repository's secrets, so read them in the pull request or on the branch first. To move them into `.github/workflows/`, comment `/codeman accept-workflows`.",
  spending: "Spending",
  spent: ({ run, task, budget }) =>
    `Spent: ${run ? `${run} this run, ` : ""}${task} of ${budget} for the task`,
  panelFooter: (model, runUrl, reportUrl) =>
    `<sub>Model: \`${model}\` (change it with \`/codeman set model <id>\`) · [Last run](${runUrl})${reportUrl ? ` · [Last report](${reportUrl})` : ""}</sub>`,

  nextStepLabel: "Next step",
  nextStep: (state) =>
    ({
      new: "Codeman tries again in a later run.",
      planning: "the plan.",
      "awaiting-decision": "your decisions, in the task's status comment.",
      ready: "the implementation, in the next run.",
      designing: "the design stage.",
      coding: "the code stage.",
      testing: "the test stage.",
      reviewing: "the review stage.",
      "in-progress": "the implementation.",
      "awaiting-workflow": "the workflows: accept them, or wait for their runs.",
      blocked: "a maintainer: see above how to go on.",
      done: "your review of the pull request.",
    })[state],
  report: "Report",
  problems: "Problems",
  costHeading: "Cost",
  runFooter: (model, spent, runUrl) =>
    `<sub>Model: \`${model}\`${spent ? ` · ${spent}` : ""} · [Run](${runUrl})</sub>`,

  tableHeader: [
    "Run",
    "Stage",
    "Model",
    "Time",
    "Input tokens",
    "Output tokens",
    "Cost",
    "Key limit",
    "Task budget",
    "Monthly budget",
  ],
  usedTokens: (input, output, time) =>
    `Tokens: ${input} input and ${output} output, in ${time} of agent time.`,
  earlierRuns: (runs) => `Earlier runs (${runs})`,
  runsWithoutRow: "Runs without a row",

  fullPlan: "Full plan",
  changes: "Changes",
  squashMessage: "Suggested squash commit message",
  pullRequestFooter: (spent, runUrl) =>
    `<sub>Opened by Codeman${spent ? ` · Spent: ${spent}` : ""} · [Last run](${runUrl})</sub>`,
  draftSummary:
    "Codeman is still working on this pull request: test and review come next. It becomes ready for review when they pass.",
  readySummary: (code, test) => `Code: ${code ?? "(no report)"}\n\nTests: ${test ?? "(no report)"}`,
  reviewHeading: "Codeman review",
  reviewChanges: "Changes asked of the code stage",
  run: "Run",

  startPlan: (revising) =>
    revising
      ? "Codeman is revising the plan, as requested."
      : "Codeman is reading the issue and writing a plan.",
  startStage: (stage) =>
    ({
      design: "Codeman is designing: flows and screens, if the task needs them.",
      code: "Codeman is writing the code.",
      test: "Codeman is testing the work.",
      review: "Codeman is reviewing the work.",
    })[stage],
  startWithWorkflowResults: "Codeman is going on with the results of the workflows it asked for.",
  startWithChanges: "Codeman is working on the requested changes.",
  startContinue: "Codeman is continuing the work, as requested.",

  continueHint: "Comment `/codeman continue <guidance>` to try again.",
  replanHint: "Comment `/codeman replan <what to change>` to try again.",
  removeLabelHint: "Remove the `codeman:blocked` label to try again.",

  noKey: "Codeman could not create the OpenRouter key for this task. See the run log.",
  taskBudgetSpent: (spent, budget, minimum) =>
    `The task has spent ${spent} of its ${budget} budget, and a run needs at least ${minimum}. A maintainer can raise it with \`/codeman set task-budget <usd>\`, then comment \`/codeman continue\`.`,
  monthlyBudgetReached: (used, budget, limit) =>
    `The monthly budget is reached: ${used} used of ${budget}, and this run may use up to ${limit}.`,
  tryLater: (reason) => `${reason} Codeman will try again in a later run.`,

  planUnfinished: "The agent did not finish the plan. See the run log.",
  noResult: "The agent produced no result. See the run log.",
  couldNotUse: "Codeman could not use the agent's result.",
  ignoredChange: (path) => `Ignored a change to ${path}.`,
  droppedChange: (path, reason) => {
    const why = {
      "invalid-path": "not a valid path in the repository",
      "codeman-settings": "Codeman's own settings",
      protected: "protected by .codemanignore",
      "not-a-file": "not a regular file",
      "too-large": `larger than ${reason.kind === "too-large" ? reason.max : 0} bytes`,
      "workflow-deletion": "deleting a workflow is left to a maintainer",
    }[reason.kind];
    return `Dropped the change to ${path}: ${why}.`;
  },
  outOfTime: "The agent ran out of time. Its work so far is committed.",
  partial: "Work so far is committed to the task branch.",
  maxRuns: (stage, runs, max) =>
    `The ${STAGES[stage]} stage has run ${runs} times in a row without finishing (\`max-runs\` is ${max}). Comment \`/codeman continue <guidance>\` to allow ${max} more runs.`,
  stageNeedsMaintainer: (stage) => `The ${STAGES[stage]} stage needs a maintainer.`,
  agentReports: (reason) => `The agent reports: ${reason}`,
  missingWorkflows: (paths) =>
    `The agent waits for workflows that are not on the branch: ${paths}.`,
  awaitingWorkflows: (stage, paths, reason) =>
    `The ${STAGES[stage]} stage needs ${paths} to run: ${reason} Codeman goes on when their runs on the task branch finish. \`/codeman continue <guidance>\` goes on without them.`,
  stageDecisions: (stage, count) =>
    `The ${STAGES[stage]} stage needs ${count} decision(s) from the maintainers.`,
  reviewRounds: (rounds, max) =>
    `Review sent the work back to the code stage ${rounds} times in a row (\`max-runs\` is ${max}). Comment \`/codeman continue <guidance>\` to go on.`,
  skipped: (reason) => `Skipped: ${reason}`,
  workDone:
    "The work is done and reviewed. Review the pull request. To ask for changes, submit a review that requests them, or comment `/codeman fix <what to change>` on the pull request.",

  accepted: (by, paths) =>
    `${by} accepted ${paths}, now in \`.github/workflows/\` on the task branch.`,
  acceptWaits: "Codeman goes on when their runs finish.",
  acceptResumes: (stage) => `The ${STAGES[stage]} stage goes on.`,
  nothingStaged: "There are no staged workflows to accept.",
  stagedChanged: "The staged workflows changed after they were accepted.",
  stagedChangedDetail: (by, paths) =>
    `Changed after ${by}'s comment: ${paths}. Read them again, then comment \`/codeman accept-workflows\` again.`,

  allAnswered: "All decisions are answered. Codeman implements the plan in its next run.",
  stillPending: (count) => `${count} decision(s) still need an answer.`,
  commandProblem: (problem) => {
    switch (problem.kind) {
      case "takes-no-arguments":
        return `\`${problem.command}\` takes no arguments.`;
      case "unknown-command":
        return "Unknown command. Use `decide`, `approve`, `answer`, `replan`, `fix`, `continue`, `accept-workflows`, `set` or `model`.";
      case "answer-needs-number":
        return "`answer` needs a decision number, such as `answer 2 <text>`.";
      case "answer-needs-text":
        return "`answer` needs text after the decision number.";
      case "decide-needs-answers":
        return "`decide` needs answers such as `1 a` or `1=a`.";
      case "not-an-answer":
        return `\`${problem.arg}\` is not an answer such as \`1 a\` or \`1=a\`.`;
      case "set-which":
        return `\`set\` changes one of ${problem.names.map((name) => `\`${name}\``).join(", ")} for this task.`;
      case "set-one-value":
        return `\`set ${problem.name}\` needs one value.`;
      case "invalid-setting":
        return {
          model: `\`${problem.name}\` must be an OpenRouter model ID, such as \`provider/model\`.`,
          language: `\`${problem.name}\` must be \`auto\` or a language tag, such as \`pt-BR\`.`,
          number: `\`${problem.name}\` must be a positive number.`,
          integer: `\`${problem.name}\` must be a positive whole number.`,
        }[problem.type];
      case "text-too-long":
        return `The text must have at most ${problem.max} characters.`;
      case "no-decision":
        return `Decision ${problem.id} does not exist.`;
      case "no-option":
        return `Decision ${problem.id} has no option \`${problem.option}\`.`;
    }
  },
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
