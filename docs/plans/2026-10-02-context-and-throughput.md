---
status: completed
created_at: 2026-10-02T18:10:00-03:00
updated_at: 2026-10-02T21:38:00-03:00
commit: d0637c8
---

# Context length and throughput

## Goal

Each row of the spend table also shows the run's context length (the most input tokens in one request of the run's key) and its throughput (the mean tokens per second over the key's requests), both read from OpenRouter's analytics API. A last row totals every column over all the task's runs.

## Context

Maintainers choose a model per task, and cost alone does not tell them whether a model is fast enough, or how close a stage came to the model's context window. Two figures answer that:

- **Context length**: the largest prompt the agent sent in one request. It grows with the conversation, so it shows how close a run came to the window, and which stages need a model with a larger one.
- **Tokens per second**: how fast the model generated, averaged over the run's requests.

They must come from OpenRouter, not from the harness. OpenCode's own counts differ from OpenRouter's (its costs often diverge, for example), and the spend table already takes cost and tokens from OpenRouter, so every figure in a row has one source.

What OpenRouter's analytics API offers (`POST /api/v1/analytics/query`, management key, checked against its schema on 2026-10-02):

- `avg_throughput`: completion tokens per second, averaged over requests; also `p50_`, `p90_`, `p95_` and `p99_` variants. Throughput metrics cover at most 31 days.
- `tokens_prompt` per request, by grouping on the `generation_id` dimension (also limited to 31 days) and ordering by `tokens_prompt`, descending, with `limit: 1`. There is no `max` aggregate.
- `request_count`, to weigh a run's mean when adding up a task.

Keys live at most 48 hours and `close-key` reads them right after the run, so the 31-day limit does not matter. `close-key` already reads the key's tokens from the same API ([architecture](../inference/openrouter.md)), with retries while analytics catches up; the new figures follow the same path: `close-key` outputs, `apply` inputs, a spend row.

`tokens_prompt` includes cached prompt tokens, like the input column. The context length is therefore the prompt the model saw, not what was billed at full price.

## Decisions

Answered on 2026-10-02 by the responsible person: the recommendation of each, and a totals row (decision 3).

1. **Where the figures show.** Options:
   - (a) Two new columns in the spend table, "Context" and "Tok/s", in the status comment and in each run comment, plus the task's maximum context and mean throughput under the table.
   - (b) As (a), plus a third column with the run's request count.
   - (c) Only under the table and in the run comment, with no new columns.

   Recommendation: (a). The table already has ten columns, and GitHub scrolls wide tables. The request count is kept in the record, for the task's mean, without its own column.
2. **The task's throughput.** Options:
   - (a) The mean over every request of the task: each run's mean weighted by its request count.
   - (b) The mean of the runs' means.

   Recommendation: (a). It is "the mean of the requests" across the task, and a short run with three requests does not weigh as much as a long one.
3. **A totals row**, asked for by the responsible person: a last row, after the folded and the "runs without a record" rows, totals each column over all the task's runs. Agent time, input and output tokens and cost are summed; the cost then equals the task's total from OpenRouter. Context length is the largest of the task, and throughput the mean of decision 2, since neither adds up. The key's limit and the budgets are limits, not amounts, and stay empty. The totals row replaces the lines under the table that repeat it (the task's spend, tokens and agent time); what it does not show stays there.

## Steps

1. Verify the API on the test account: run the two queries below for a finished key and compare them with what OpenRouter's activity page shows for its generations. Done when both match, or this plan is updated with what differs.
   - `avg_throughput` and `request_count`, filtered by `api_key_id`, with no dimension and no granularity, returns one row for the key.
   - `tokens_prompt` grouped by `generation_id`, filtered by `api_key_id`, ordered by `tokens_prompt` descending with `limit: 1`, returns the largest prompt.
2. `OpenRouter` in [`src/budget.ts`](../../src/budget.ts) gets `keyStats(hash, since, until)`: requests, mean throughput and largest prompt, undefined while analytics has no rows. Done when unit tests cover the request bodies, counts sent as strings, and an empty answer.
3. `close-key` reads them after the tokens, with the same retries, and outputs `max-input-tokens`, `tokens-per-second` and `requests`. A failure is only logged, as for tokens. Done when `keys` tests cover a read, a late read and a failure.
4. `action.yml` and [`templates/codeman.yml`](../../templates/codeman.yml) declare and pass the outputs to `apply`. Done when both agree.
5. `SpendRow` gets `maxInputTokens`, `tokensPerSecond` and `requests`; folding keeps the largest context and a request-weighted throughput (decision 2). The table renders them (decision 1), with "—" for missing values, as with an older workflow file. Done when `spend` tests cover new rows, folded rows, old records and missing values.
6. The totals row (decision 3), in the status comment's table; a run comment's table has one row and gets none. The lines under the table keep only what the row does not show. Done when `spend` and `status` tests cover it with and without folded rows and the difference row, in both catalogs.
7. Update [`docs/architecture.md`](../README.md) (Budget). Done when it describes both figures, where they come from, and the totals row.
8. Rebuild `dist/`, run `npm run check`. Done when it passes.
9. The responsible person updates the test repository's workflow file and checks the figures after a few runs against OpenRouter's activity page.

## Outcome

Steps 2 to 8 are done; steps 1 and 9 are left to the responsible person, who holds the management key and the test repository.

- `OpenRouter.keyStats` ([`src/budget.ts`](../../src/budget.ts)) makes the two queries of step 1 as OpenRouter's documentation describes them, without having run them against the API. It does not depend on getting one row: several rows are weighed by their requests, and the largest prompt is the largest of any row returned. If step 1 finds that the queries differ, `keyStats` and this plan change together.
- `close-key` outputs `requests`, `max-input-tokens` and `tokens-per-second`; with an older workflow file, both columns show "—".
- The line under the table that repeated the task's tokens and agent time is gone. The line with what the task spent stays, because it also shows the task's budget, which the totals row leaves empty.
- The run comment's table has no totals row: it has one row.

## Out of scope

- Refreshing these figures for earlier rows, as costs are refreshed. Tokens are not refreshed either.
- Latency, time to first token and the percentile variants.
- Figures from the harness's logs.
- The same figures for self-hosted inference; [`2026-10-02-self-hosted-inference`](2026-10-02-self-hosted-inference.md) computes them there.
