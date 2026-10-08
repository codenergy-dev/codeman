# Comments

## Status and run comments

Codeman keeps one status comment per task up to date, as the task's panel: where the task is now and what comes next, plan and pull request links, a link to the decisions, workflows to review, the task's spend, the model, and links to the last run and its report. A hidden block in it stores the task record (branch, plan path, decisions, answers, last handled comment and review, pull request, runs in a row, spend), gzip-compressed and in base64url, because the comment holds at most 65,536 characters. Records written before compression are still read. Codeman reads that block only from comments written by its own GitHub App, because anyone can post a comment containing it.

Once a task has decisions, a decisions comment shows them, with the recommendations, the answers and how to answer. Codeman renders it from the task record, edits it in place, and never reads it back: the record stays the only state, and an update that fails is repaired by the next one. The record keeps its ID; if it was deleted, Codeman posts a new one. A revised plan's decisions get a new comment, and the earlier one stays as it was; when a revised plan has no decisions, the earlier comment says so. Tasks from before this comment existed get it in their next run.

No comment Codeman writes exceeds the platform's limit: 65,536 characters on GitHub. When the decisions do not fit, answered ones are shown in one line each, then left out, then pending ones from the last, with a note that the plan has them all. When the panel does not fit, it keeps its record and links and leaves out the rest, with a note.

Each run that moves the task also posts a new comment on the issue, so the issue keeps the task's history in order: its title says what the run worked on (a [stage](stages.md), recorded answers or accepted workflows) and how it ended (such as "Design stage: skipped"); then come the agent's report, problems, what comes next (the next stage, the maintainers' decisions, accepting workflows, a maintainer, or reviewing the pull request), and what the run spent. A run that only waits to try again later, because the monthly budget is reached, updates the panel only.

The routing agent and each routed stage's agent read Codeman's earlier run comments on the task, oldest first, up to 20,000 characters (older ones are dropped first). Only comments by the App with the run marker count, and the agent treats them as data: the agents that wrote them read untrusted text.

Text written by the agent is rendered as safe Markdown: emphasis, code, lists, quotes and tables work, but HTML is escaped, links and images show as their text followed by the URL, and @mentions and issue references are broken with an invisible space, so they notify and link nothing. Its headings are lowered to level 5, so it cannot imitate Codeman's own, and a code block it leaves open is closed. Short fields stay on one line. Text written by users, such as free-text answers, is rendered fully inert.

## Conversation language

Codeman talks to maintainers in the task's language: the fixed texts of the status and run comments, the pull request's description and review comments, and what the agent writes for them (summaries, reasons, decisions, reports). Code, comments, commit messages and documentation, the plan included, follow the [agent rules](../runs/agent.md#agent-rules) instead.

- With `language: auto` (the default), the planning agent reports the conversation's language, from the issue and the maintainer comments, and the task record keeps it. Until then, Codeman writes in English. Any other value of `language` wins over the reported one.
- Fixed texts come from catalogs in `src/i18n/`: English and Brazilian Portuguese. A language without a catalog uses its base language's (`pt-PT` uses Brazilian Portuguese), or else English. Numbers and dates follow the language.
- Commands, labels, file paths, the workflow's logs and technical details of an invalid agent result stay in English.
- The pull request's title is the issue's title.
