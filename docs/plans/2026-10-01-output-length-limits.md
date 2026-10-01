---
status: completed
created_at: 2026-10-01T13:51:00-03:00
updated_at: 2026-10-01T14:40:00-03:00
commit: e32f4b1
---

# Output length limits

## Goal

A text in the agent's `output.json` that is too long no longer throws away a run. The agent knows the limits, gets a chance to fix its output in the same run, and Codeman cuts what is still too long instead of blocking the task. Maintainers can configure the limits.

## Context

A planning run was blocked with `decisions[1].options[1].label must be at most 300 characters.` The plan was written and paid for, but discarded. The limits in `src/output.ts` exist only in the validator: the prompt never states them, and its example asks for "First option and its trade-off" in each label, which invites a paragraph.

The limits bound what Codeman posts on GitHub. A comment holds at most 65,536 characters, and the status comment carries the decisions twice: rendered, and inside the task record in base64. The worst case of today's limits already exceeds it.

LLMs count characters poorly, even when told a limit. OpenCode 1.18.32 can continue the last session (`opencode run --continue`, which skips subagent sessions), so the agent job can send the agent back to its own output without a new run.

## Decisions

1. **Hidden margin.** Options: (a) tell the agent a limit and accept twice as many characters, unknown to it; (b) accept exactly what the agent is told. Recommendation: (a).
   **Answer:** (a), from the responsible person. Counts (decisions, options) get no margin: a list cannot be cut, and a maintainer who sets a count means it.
2. **Fix in the same run.** Options: (a) the agent job validates the output and continues the agent's session once with the problems; (b) a new run on the next trigger. Recommendation: (a): a new run explores the repository again, at full cost.
   **Answer:** (a), from the responsible person.
3. **Text still too long after the fix.** Options: (a) cut it to the accepted limit and report it under Problems; (b) block the task. Recommendation: (a). Other problems (types, keys, ids, counts) still block.
   **Answer:** (a), from the responsible person.
4. **Configurable limits.** Options: (a) repository settings, with ceilings Codeman enforces; (b) fixed limits. Recommendation: (a), in `.codeman/settings.yml` only, like `max-files`: not workflow inputs or `/codeman set`. The setting is the limit the agent is told.
   **Answer:** (a), from the responsible person.
5. **Total size.** Options: (a) a limit on all decisions of one output together, and a compressed task record; (b) split long comments. Recommendation: (a): split comments need several API calls per update, which are not atomic, and the record would span them.
   **Answer:** (a), from the responsible person. A dedicated decisions comment is a separate plan: [decisions comment](2026-10-01-decisions-comment.md).

## Steps

1. [x] Settings `max-decisions` (default 10, at most 10), `max-options` (4, from 2 to 6), `max-title-chars` (80, at most 200), `max-question-chars` (600, at most 1500), `max-label-chars` (150, at most 300) and `max-summary-chars` (2000, at most 4000) in `src/settings.ts`. Done when unit tests cover the defaults and the bounds.
2. [x] `src/output.ts` takes the limits from the settings. Text fields accept twice the setting and cut what is longer, reporting each cut; counts accept the setting. All decisions of one output together (titles, questions and labels) may have at most 50,000 characters (the agent is told 25,000). Done when unit tests cover the margin, cuts, counts and the total.
3. [x] The plan and stage prompts state the limits, and the examples ask for short labels, with trade-offs in the question. Done when prompt tests check the limits come from the settings.
4. [x] The agent job validates `output.json` after the harness exits. If it is missing, invalid or would be cut, and there is time left, it continues the session once with the problems, stated with the limits the agent was told. `HarnessOptions` gains `resume`, which OpenCode maps to `--continue`. A fix that fails or runs out of time leaves the first outcome. Done when unit tests cover the correction message and the OpenCode arguments.
5. [x] `apply` lists each cut under Problems, in the task's language. Done when the message catalogs have the text and a test covers it.
6. [x] The status comment stores the record gzip-compressed (`version` 2), and still reads uncompressed records. Decompression is capped. Done when unit tests read both formats.
7. [x] `docs/architecture.md` and `templates/settings.yml` describe the limits, the correction and the record format.
8. [x] `npm run check` passes.

## Out of scope

- Moving the decisions to a comment of their own, and a ceiling per comment: [decisions comment](2026-10-01-decisions-comment.md).
- Configuring the commit message's limit. It is told as 1,000 characters, so it still accepts 2,000 as before, but a longer one is now cut instead of blocking.
- Limits on workflow lists and spend rows, which stay as they are.
- More than one correction per run.
