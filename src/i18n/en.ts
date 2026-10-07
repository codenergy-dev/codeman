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

const STAGES = {
  plan: "plan",
  route: "routing",
  web: "web",
  design: "design",
  code: "code",
  test: "test",
  review: "review",
};

const number = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const en: Messages = {
  locale: "en-US",

  money: (amount) => `US$ ${number(2).format(amount)}`,
  tokens: (count) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(count),
  cost: (amount) => `US$ ${number(3).format(amount)}`,
  rate: (perSecond) => number(1).format(perSecond),
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
      case "route":
        return outcome === "done" ? "Next stages chosen" : `Routing: ${ended}`;
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
      routing: "Choosing the next stages",
      researching: "Recording third-party documentation",
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
  decisionsLink: (pending) => (pending === 0 ? "all answered" : `${pending} waiting for an answer`),
  noDecisions: "The plan has no decisions now.",
  decisionsOmitted: (count) =>
    `${count} decision(s) are not shown here, to fit GitHub's size limit for comments. The plan has them all.`,
  panelCut:
    "Part of this panel is not shown, to fit GitHub's size limit for comments. The last run comment has the details.",
  workflowsToReview: "Workflows to review",
  workflowsHelp:
    "The agent wrote these workflows. They are staged under `.codeman/workflows/` on the task branch and do not run. A workflow runs with the repository's secrets, so read them in the pull request or on the branch first. To move them into `.github/workflows/`, comment `/codeman accept-workflows`.",
  oldDocs: "Third-party documentation to refresh",
  oldDocsHelp: (days) =>
    `These pages in \`docs/web/\` were fetched more than ${days} days ago, or have no valid \`updated_at\`. Codeman does not refresh them on its own. To refresh some, ask for it in a task, such as with \`/codeman fix Refresh docs/web/<third-party>/\`: the routing agent sends it to the web stage.`,
  daysOld: (days) => `${days} days`,
  noDate: "no valid `updated_at`",
  morePages: (count) => `And ${count} more.`,
  spending: "Spending",
  spent: ({ run, task, budget }) =>
    `Spent: ${run ? `${run} this run, ` : ""}${task} of ${budget} for the task`,
  refusedHeading: "Not a task",
  refused:
    "Codeman works only on issues opened by someone with write access to the repository. The agent reads the issue's title and body as its task, and whoever opened the issue can edit them at any time. To go on, a maintainer opens a new issue with this content, in their own words, and labels it `codeman`. Then remove the `codeman` label from this one.",
  panelFooter: (model, runUrl, reportUrl) =>
    `<sub>Model: \`${model}\` (change it with \`/codeman set model <id>\`) · [Last run](${runUrl})${reportUrl ? ` · [Last report](${reportUrl})` : ""}</sub>`,

  nextStepLabel: "Next step",
  nextStep: (state) =>
    ({
      new: "Codeman tries again in a later run.",
      planning: "the plan.",
      "awaiting-decision": "your decisions, in the task's decisions comment.",
      ready: "the routing agent, which chooses the stages that run next.",
      routing: "the routing agent, which chooses the stages that run next.",
      researching: "the web stage.",
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
    "Provider",
    "Time",
    "Input tokens",
    "Output tokens",
    "Context",
    "Tok/s",
    "Cost",
    "Key limit",
    "Task budget",
    "Month (estimated)",
  ],
  provider: (mode) =>
    ({ openrouter: "OpenRouter", pod: "Runpod (pod)", serverless: "Runpod (Serverless)" })[mode],
  spendNote: (mode) =>
    ({
      openrouter:
        "**OpenRouter**: a run's cost is what its key used, exact, and later runs refresh it.",
      pod: "**Runpod (pod)**: a run's cost is its pod's time at the pod's price; the task also counts its pod's time between runs, refreshed later from Runpod's billing.",
      serverless:
        "**Runpod (Serverless)**: a run's cost is an estimate of the time Runpod bills its workers, which counts in the month as soon as the run ends.",
    })[mode],
  monthNote:
    "**Month**: what the repository's runs count this month in Codeman's ledger before the run, an estimate: each run's cost as above, and the whole limit of each run still open. The organization's monthly budget, when it has one, counts every repository's runs and Runpod's billing by the hour.",
  earlierRuns: (runs) => `Earlier runs (${runs})`,
  totalRow: (runs) => `Total (${runs} ${runs === 1 ? "run" : "runs"})`,
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
      web: "Codeman is recording the third-party documentation the task relies on.",
      design: "Codeman is designing: flows and screens, if the task needs them.",
      code: "Codeman is writing the code.",
      test: "Codeman is testing the work.",
      review: "Codeman is reviewing the work.",
    })[stage],
  startRoute: "Codeman's routing agent is choosing the stages that run next.",
  startWithWorkflowResults: "Codeman is going on with the results of the workflows it asked for.",
  startWithChanges: "Codeman is working on the requested changes.",
  startContinue: "Codeman is continuing the work, as requested.",

  continueHint: "Comment `/codeman continue <guidance>` to try again.",
  stageBlockedHint:
    "Comment `/codeman continue <guidance>` to try again, or `/codeman replan <what to change>` to revise the plan, for example to widen its scope.",
  replanHint: "Comment `/codeman replan <what to change>` to try again.",
  removeLabelHint: "Remove the `codeman:blocked` label to try again.",

  noKey:
    "Codeman could not give this run access to its model (an OpenRouter key, or a GPU). See the run log.",
  missingCredentials:
    "Codeman could not give this run access to its model: the workflow does not pass the secret of a provider the run needs, its own or one whose billing counts in the organization's month.",
  taskBudgetSpent: (spent, budget, minimum) =>
    `The task has spent ${spent} of its ${budget} budget, and a run needs at least ${minimum}. A maintainer can raise it with \`/codeman set task-budget <usd>\`, then comment \`/codeman continue\`.`,
  monthlyBudgetReached: (used, budget, limit) =>
    `The monthly budget is reached: ${used} used of ${budget}, and this run may use up to ${limit}.`,
  organizationBudgetReached: (used, budget, limit) =>
    `The organization's monthly budget is reached: ${used} used of ${budget}, and this run may use up to ${limit}.`,
  tryLater: (reason) => `${reason} Codeman will try again in a later run.`,

  planUnfinished: "The agent did not finish the plan. See the run log.",
  noResult: "The agent produced no result. See the run log.",
  couldNotUse: "Codeman could not use the agent's result.",
  ignoredChange: (path) => `Ignored a change to ${path}.`,
  cutText: (field, length, max) =>
    `${field} had ${length} characters, too many; Codeman cut it to ${max}.`,
  droppedChange: (path, reason) => {
    const why = {
      "invalid-path": "not a valid path in the repository",
      "codeman-settings": "Codeman's own settings",
      protected: "protected by .codemanignore",
      "not-a-file": "not a regular file",
      "too-large": `larger than ${reason.kind === "too-large" ? reason.max : 0} bytes`,
      "workflow-deletion": "deleting a workflow is left to a maintainer",
      "web-stage-only": "the web stage changes only docs/web/",
      "web-docs": "only the web stage changes docs/web/",
      "invalid-web-page": reason.kind === "invalid-web-page" ? reason.problem : "",
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
  deferredWorkflows: (stage, paths, reason, next) =>
    `The ${STAGES[stage]} stage needs ${paths} to run: ${reason} The workflows are staged and wait for a maintainer, so the task goes on ${next ? `to the ${STAGES[next]} stage meanwhile, up to the end of its route` : "to the end of its route meanwhile"}. Once they are accepted and their runs finish, the ${STAGES[stage]} stage goes on with their results.`,
  acceptAfterReview: (paths) =>
    `Review passed. The task waits for the staged workflows to be accepted: ${paths}. Read them, with review's report on the pull request, and comment \`/codeman accept-workflows\`. The pull request stays a draft until then, since merged now they would never run.`,
  stageDecisions: (stage, count) =>
    `The ${STAGES[stage]} stage needs ${count} decision(s) from the maintainers.`,
  reviewRounds: (rounds, max) =>
    `Review sent the work back to the code stage ${rounds} times in a row (\`max-runs\` is ${max}). Comment \`/codeman continue <guidance>\` to go on.`,
  skipped: (reason) => `Skipped: ${reason}`,
  routeChosen: (stages) => `The routing agent chose these stages, in order: ${stages}.`,
  routeLabel: "Route",
  leftOutLabel: "Left out",
  routeFallback: (stages) =>
    `Codeman could not use the routing agent's result, so the stages run in their fixed order: ${stages}.`,
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
      case "not-in-description":
        return "Only `set` and `model` work in the issue's description. Write other commands in a comment.";
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
          model: `\`${problem.name}\` must be a model ID, such as \`provider/model\` on OpenRouter or \`qwen3-coder:30b\` on Ollama.`,
          language: `\`${problem.name}\` must be \`auto\` or a language tag, such as \`pt-BR\`.`,
          number: `\`${problem.name}\` must be a positive number.`,
          integer: `\`${problem.name}\` must be a positive whole number.`,
          choice: `\`${problem.name}\` must be one of ${(problem.values ?? []).map((value) => `\`${value}\``).join(", ")}.`,
          "gpu-type": `\`${problem.name}\` must be a GPU type, such as \`NVIDIA RTX A6000\`.`,
          endpoint: `\`${problem.name}\` must be an endpoint's ID, letters and digits.`,
        }[problem.type];
      case "settings-rejected":
        return `The task's settings were not applied: ${problem.error}`;
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
