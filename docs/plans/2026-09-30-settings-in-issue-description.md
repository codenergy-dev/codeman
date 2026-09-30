---
status: completed
created_at: 2026-09-30T17:30:00-03:00
updated_at: 2026-09-30T17:55:00-03:00
commit: 7dfd177
---

# Settings in the issue's description

## Goal

A maintainer can choose a task's settings when opening the issue, with `/codeman set <name> <value>` and `/codeman model <id>` lines in its description. The agent reads the description without those lines.

## Context

Today Codeman reads commands only in comments and review texts. The description goes to the agent as `ISSUE BODY`, command lines included, so a `/codeman set` line there changes nothing and adds noise to the agent's context. Choosing the model or the budget takes a comment right after opening the issue.

Only issues opened by maintainers are tasks, and the agent already takes the description as its task. A setting in the description is trusted as much as a setting in a maintainer's comment.

Settings are not recorded: each run reads them again from every maintainer comment. The description can be read the same way.

## Decisions

1. **Command lines in the text the agent reads.** Options: (a) remove every command line from the description before the agent reads it; (b) keep the description as written. Recommendation: (a).
   **Answer:** (a), from the responsible person: commands must not pollute the agent's context.
2. **Which commands count in the description.** Options: (a) only `set` and `model`; (b) every command. Recommendation: (a). A new issue has no plan, decisions or pull request, so the other commands have nothing to act on; they are reported as problems.
   **Answer:** (a), within the authorization to implement this plan.
3. **When problems in the description are reported.** Options: (a) in the task's first run, when it has no status record yet; (b) in every run while the description has them. Recommendation: (a). The description is written before the first run, and (b) repeats the same list in every run comment. An invalid setting added in a later edit is ignored silently, as a bad value never overrides a good one.
   **Answer:** (a) at first, within the authorization to implement this plan. Changed to (b) by the responsible person: the warning stays in every run while the description has a problem, so an invalid setting added in a later edit is reported too.
4. **Order against comments.** The description is older than every comment, so a `set` in a comment overrides the same setting in the description. No other option was considered.

## Steps

1. [x] `descriptionCommands` in `src/commands.ts` returns the description's commands (`set` and `model`; any other command line becomes a `not-in-description` problem) and its text without command lines. Command lines are found as in comments: lines that start with `/codeman`, outside fenced code blocks. Done when unit tests cover both.
2. [x] `taskSettings` takes the description's commands before the comments' ones. Done when a unit test shows a comment overriding the description.
3. [x] `select` uses them for the chosen task: settings, the text the agent reads (`TaskContext.body`), and the description's problems in every run. Issues that are not tasks are unaffected.
4. [x] The `not-in-description` problem has a text in each message catalog.
5. [x] `docs/architecture.md` (settings and commands) and `docs/installation.md` describe the description's commands.
6. [x] `npm run check` passes.

## Out of scope

- Removing command lines from comments and reviews before the agent reads them.
- Starting a run when an issue is opened or edited.
