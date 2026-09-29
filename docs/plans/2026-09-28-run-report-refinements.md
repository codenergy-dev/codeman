---
status: completed
created_at: 2026-09-28T22:05:00-03:00
updated_at: 2026-09-28T22:50:00-03:00
commit: 32d122b
---

# Run report refinements

## Goal

The run comments read clearly: the agent's report renders as Markdown, each comment says what the run did and what comes next, and the spend table also shows how long each agent ran and how many tokens it used.

## Context

An end-to-end test on a private test repository, with the Brazilian Portuguese catalog, went from plan to `codeman:done`. Three things to improve:

1. **Raw Markdown.** The agent's report is rendered inert (`inertLines` in `src/text.ts`): every Markdown character is escaped, so `**Checagens**` and `` `npm test` `` show their syntax. The goal of inert rendering is safety: no HTML, no links that hide their target, no images (which load a URL from every reader's browser), no @mentions. Bold, code and lists are not risks.
2. **Confusing wording.** A run comment reads:

   > Codeman: Etapa de design
   > Agora: Escrevendo o código.
   >
   > Etapa de design pulada. A seguir: código.

   "Agora" is the task's state after the run, which is already the next stage, so the comment seems to contradict itself, and the outcome ("pulada") appears only in the message.
3. **Time and tokens.** The spend table has no duration and no token counts. The agent job knows when the harness started and stopped. Token counts are not in OpenRouter's key usage (only the cost), but OpenCode's JSON events report them: each `step_finish` event carries the step's `part`, which in OpenCode has `tokens` (`input`, `output`, `reasoning`, `cache.read`, `cache.write`). The documentation does not describe these events, so the shape must be confirmed on the pinned version (1.18.32).

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a), except decision 3. For decision 3 the responsible person chose OpenRouter's analytics API over the harness's events, whose counts they have seen differ from what OpenRouter bills. Evaluated:

- `POST /api/v1/analytics/query` takes a management key, metrics such as `tokens_prompt` and `tokens_completion`, a time range with seconds precision, and a filter on `api_key_id`, which accepts the key's 64-character hash. Count metrics may come back as strings. `GET /api/v1/analytics/meta` lists the metrics and dimensions.
- `GET /api/v1/activity` only covers completed UTC days, so it cannot report a run that just ended.
- The documentation says nothing about how soon a request shows up in analytics.

So `close-key`, which already holds the management key and waits for the key's usage to settle, queries the key's tokens over its lifetime. While the counts are still zero for a key that has a cost, it retries for up to about a minute; after that the row shows "—". Input is `tokens_prompt` and output is `tokens_completion`, as OpenRouter counts them (decision 4).

1. **Markdown in the agent's texts.** Options:
   - (a) A safe subset: keep emphasis, code spans, code blocks, lists, quotes, tables and headings. Escape HTML, turn links and images into plain text (`[text](url)` shows as `text (url)`), and keep @mentions and issue references inert. Headings are lowered to level 5 or below, so a report cannot imitate Codeman's own headings, and an unclosed code block is closed at the end of the report. Applies to the agent's multi-line texts: reports in run comments, review comments and the pull request's "Changes". One-line texts (summary, decision titles, questions and options) get the same rules, without block elements.
   - (b) Keep them inert.

   Recommendation: (a). Readable reports with the same protections. Bare URLs already show as links today, and they show their full target.
2. **Run comment wording.** Options:
   - (a) The title says what ran and how it ended; the message follows only when it adds something (a reason, what to do); a last line says what comes next. For example:

     > **Codeman · Etapa de design: pulada**
     >
     > (report)
     >
     > **Próximo passo:** etapa de código.

     "Próximo passo" follows the task's new state: the next stage, your decisions, accepting the workflows, a maintainer (with how to go on), or your review of the pull request.
   - (b) Keep the layout, and rename "Agora" to "Estado da tarefa".

   Recommendation: (a). Each comment reads on its own, in order. The status comment keeps showing the current state in its title.
3. **Where token counts come from.** Options:
   - (a) The agent job adds up the `tokens` of the harness's `step_finish` events, through a new `usage` method of the harness interface (only OpenCode today). The counts are informational: the agent runs as the same user as the harness and could in theory write fake events. Budgets and costs keep coming from OpenRouter.
   - (b) OpenRouter's generation endpoint, one request per generation. Needs each generation's ID, which also comes from the harness, and many more requests.

   Recommendation: (a).
4. **Which tokens count.** Options:
   - (a) Input: everything sent to the model, cache reads and writes included. Output: everything it generated, reasoning included.
   - (b) Separate columns for cached input and for reasoning.

   Recommendation: (a). Two columns, as asked. The cost already reflects the cache discounts.
5. **How token counts read.** Options:
   - (a) Compact, in the task's language: `45,7 mil` and `1,2 mi` in Brazilian Portuguese, `45.7K` and `1.2M` in English.
   - (b) Full numbers with separators: `45.712`, `1.234.567`.

   Recommendation: (a). Easier to compare at a glance, like the durations.

Durations follow what was asked, with no decision needed: under a minute in seconds (`45 s`), under an hour in minutes and seconds (`1 min 10 s`, and `12 min` when the seconds are 0), and from an hour on in hours and minutes (`1 h 5 min`).

## Steps

1. `safeMarkdown` and `safeInline` in `src/text.ts`, used where `inertLines` and `inlineText` render agent text today (per decision 1). User texts, such as free-text answers, keep the inert rendering. Done when tests cover HTML, links, images, autolinks, mentions, headings, unclosed code blocks and tables.
2. Apply passes each run's outcome to `finish`; `renderRun` renders the title, message and next step (per decision 2), with the texts in both catalogs. Done when the run comment tests cover each stage outcome and each next step.
3. The agent job measures the harness's run time and writes it in the manifest. `close-key` queries the key's tokens from OpenRouter's analytics and outputs them; the template passes them to apply. Done when the analytics query is tested with a fake API: rows as strings, several rows, no rows, a failed request, and the retries.
4. Apply adds duration and tokens to the spend row; the table gains the columns Time, Input tokens and Output tokens, and under it the totals of tokens and time next to the spend. Folded rows keep their sums. Done when the spend tests cover formatting in both languages and old rows without these fields ("—").
5. Update `docs/architecture.md` (Budget, Status and run comments, Untrusted input).
6. Rebuild `dist/`, run the tests and Biome. Done when all pass.
7. The responsible person runs a task and checks the comments and the table against the key's numbers on OpenRouter's dashboard. If the tokens show "—" because analytics lags too much, the plan reopens.

## Out of scope

- Rendering maintainers' own texts (free-text answers) as Markdown.
- Token counts for runs recorded before this change.

## Outcome

Steps 1 to 6 are done. `safeInline` and `safeMarkdown` in `src/text.ts` render the agent's texts; apply passes each run's outcome to `finish`, and the catalogs give the title and the next step; `close-key` reads the key's tokens through `OpenRouter.keyTokens`, and the agent job writes the agent's time in the manifest. The workflow template changed (`close-key` outputs the tokens, apply receives them), so target repositories must update their workflow file; with an older one, the tokens show "—". The "Next step" line replaced the separate "done, next" and "review asked for changes" messages, which said the same thing. Step 7 is left to the responsible person.
