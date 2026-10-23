# Comments

Codeman talks to maintainers through comments on each [task](../glossary.md#task)'s issue. This page says which comments it writes, what they hold, and in which language.

## Status and run comments

### The status comment

Codeman keeps one [status comment](../glossary.md#status-comment) per task up to date, as the task's panel. It shows:

- where the task is now, and what comes next;
- links to the plan and the pull request, and to the decisions;
- the workflows to review;
- the task's spend and the model;
- links to the last run and its report.

### The task record

A hidden block in the status comment stores the [task record](../glossary.md#task-record): branch, plan path, decisions, answers, last handled comment and review, pull request, runs in a row, spend, and the blob SHA of each staged workflow it listed ([accepting](../runs/changes.md#accepting)). It is gzip-compressed and in base64url, because the comment holds at most 65,536 characters.

> [!IMPORTANT]
> Codeman reads that block only from comments written by its own GitHub App, because anyone can post a comment containing it.

### The decisions comment

Once a task has decisions, a decisions comment shows them, with the recommendations, the answers and how to answer.

- Codeman renders it from the task record, edits it in place, and never reads it back. The record stays the only state, and an update that fails is repaired by the next one.
- The record keeps the comment's ID. If the comment was deleted, Codeman posts a new one.
- A revised plan's decisions get a new comment, and the earlier one stays as it was. When a revised plan has no decisions, the earlier comment says so.

### Run comments

Each run that moves the task also posts a new comment on the issue, so the issue keeps the task's history in order. A run comment holds:

1. a title that says what the run worked on (a [stage](stages.md), recorded answers or accepted workflows) and how it ended, such as "Design stage: skipped";
2. the agent's report;
3. the problems;
4. what comes next: the next stage, the maintainers' decisions, accepting workflows, a maintainer, or reviewing the pull request;
5. what the run spent.

A run of planning, routing or a routed stage that only waits to try again later updates the panel only. It waits because the monthly budget, or the organization's, is reached.

### Size limits

No comment Codeman writes exceeds the platform's limit: 65,536 characters on GitHub.

| Comment | When it does not fit |
| --- | --- |
| Decisions | Answered decisions are shown in one line each, then left out, then pending ones from the last, with a note that the plan has them all. |
| Status | It keeps its record and links and leaves out the rest, with a note. |

### What agents read back

The routing agent and each routed stage's agent read Codeman's earlier run comments on the task, oldest first, up to 20,000 characters. Older ones are dropped first.

- Only comments by the App with the run marker count.
- The agent treats them as data: the agents that wrote them read untrusted text.

### Safe rendering

| Text written by | Renders as |
| --- | --- |
| The agent | Safe Markdown: emphasis, code, lists, quotes and tables work, but HTML is escaped. Links and images show as their text followed by the URL. @mentions and issue references are broken with an invisible space, so they notify and link nothing. Its headings are lowered to level 5, so it cannot imitate Codeman's own, and a code block it leaves open is closed. Short fields stay on one line. |
| Users, such as free-text answers | Fully inert text |

## Conversation language

Codeman talks to maintainers in the task's language. That covers the fixed texts of the status and run comments, the pull request's description and review comments, and what the agent writes for them: summaries, reasons, decisions and reports. Code, comments, commit messages and documentation, the plan included, follow the [agent rules](../runs/agent.md#agent-rules) instead.

- With `language: auto` (the default), the planning agent reports the conversation's language, from the issue and the maintainer comments, and the task record keeps it. Until then, Codeman writes in English. Any other value of `language` wins over the reported one.
- Fixed texts come from catalogs in `src/i18n/`: English and Brazilian Portuguese. A language without a catalog uses its base language's (`pt-PT` uses Brazilian Portuguese), or else English. Numbers and dates follow the language.
- Commands, labels, file paths, the workflow's logs and technical details of an invalid agent result stay in English.
- The pull request's title is the issue's title.
