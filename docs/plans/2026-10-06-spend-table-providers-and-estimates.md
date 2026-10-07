---
status: completed
created_at: 2026-10-06T20:43:40-03:00
updated_at: 2026-10-06T22:33:45-03:00
commit: 3f6983b
---

# Spend table: providers and estimates

## Goal

The spend table says which provider served each run, and, under it, how each provider's figures are measured, so that a reader knows which figures are exact and which are estimates.

## Context

The figures in the table are measured differently for each inference ([architecture](../architecture.md#budget), [self-hosted inference](../architecture.md#spend)):

| Inference | A run's cost | The month |
| --- | --- | --- |
| OpenRouter | The run key's usage, exact; refreshed by later runs | This month's usage of the repository's keys |
| Runpod pod | The pod's time at its price; the task's total refreshed from Runpod's billing, or the pod's whole life when higher | The whole Runpod account's billing, plus what its live pods cost beyond it |
| Runpod Serverless | Estimated: each request's span plus the idle timeout after it, at the flex price | The whole Runpod account's billing, which includes a Serverless run an hour or more late |

Since the [Serverless cost plan](2026-10-06-serverless-cost-from-worker-state.md), a Serverless run's estimate counts those spans only while the endpoint's `/health` reports a worker running.

The table does not say which inference a run used, and the "Monthly budget" column reads as exact. On 2026-10-06 the month read US$ 4.43 at two Serverless runs in a row, while the first had already cost US$ 0.67 (step 8 of the [self-hosted inference plan](2026-10-02-self-hosted-inference.md)). The responsible person chose to state this rather than correct it: Runpod bills endpoints late in any case, and an estimate of runs not yet billed could count some twice.

A row of the record holds no inference today (`SpendRow` in [`src/spend.ts`](../../src/spend.ts)); the rows of tasks run before this change have none. The `monthly-budget` setting keeps its name: it is a limit, and only how the month is measured is approximate.

## Decisions

1. **What the new column shows.** Options:
   - (a) The provider: `OpenRouter` or `Runpod`.
   - (b) The provider and, for Runpod, the mode: `OpenRouter`, `Runpod (pod)`, `Runpod (Serverless)`.

   Recommendation: (b). A pod's cost and a Serverless run's are measured differently, and the notes under the table depend on it.

   **Answer:** (b).
2. **The month column's name.** Options:
   - (a) "Month (estimated)" / "Mês (estimado)". The cell stays "US$ 4.43 of US$ 20.00".
   - (b) "Monthly estimate" / "Estimativa mensal".
   - (c) "Monthly budget" / "Orçamento mensal" as today, with the notes alone.

   Recommendation: (a). The cell is what was spent against the budget; "estimated" says the spent part is approximate, and the budget itself is not.

   **Answer:** (a).
3. **Which notes go under the table.** Options:
   - (a) One note for each inference that appears in the table's rows: how its cost and its month are measured, in a sentence or two.
   - (b) Every inference's note, always.

   Recommendation: (a). Most tasks use one inference; notes about others would be noise. A run comment, which shows its own row, gets its row's note.

   **Answer:** (a).

The responsible person answered every decision on 2026-10-06 with its recommendation.

## Steps

1. The record keeps each row's inference (`openrouter`, `pod` or `serverless`), from the run's choice of inference (`select`'s `inference` output), set by `apply`. A row without it, recorded before, shows "—". Done when `record` and `apply` tests cover a new row, an old one and a task whose rows differ. **Done on 2026-10-06**: `SpendRow.inference` in [`src/spend.ts`](../../src/spend.ts), optional, so older records read as they are. `apply` takes it from the task's settings that `select` hands over, with `inferenceChoice` and `agentMode`, as the agent job does; that is the choice `select` outputs as `inference`, so `apply` needs no new input and older workflow files keep working.
2. The table: the new column after the model, the month column's new name and the notes, in English and Portuguese. Done when `spend` and `status` tests cover each inference, an old row and a mixed table. **Done on 2026-10-06**: the column is "Provider" / "Provedor". The notes come from `spendNotes`, in a fixed order (OpenRouter, pod, Serverless), each a paragraph between the table and the line with what the task spent.
3. Docs: [`docs/architecture.md`](../architecture.md) (Budget and Spend: the column, the notes, and that the month is an estimate on Runpod). Done when they describe the table as it is. **Done on 2026-10-06**.
4. Rebuild `dist/` and run `npm run check`. Done when it passes. **Done on 2026-10-06**.

## End-to-end test

On a repository with Codeman installed from this commit:

1. **OpenRouter.** Run a task to its first stage. The status comment's spend table has a "Provider" column that reads `OpenRouter` in each row and a "Month (estimated)" column, and under the table the OpenRouter note alone. Each run comment's table has the same column and the same note.
2. **Runpod pod.** With `inference: self-hosted` and the default `gpu-mode`, run a task. Its rows read `Runpod (pod)`, and the note under the table says the month is an estimate over the whole Runpod account. Run comments have that note too.
3. **Runpod Serverless.** With `gpu-mode: serverless`, run a task. Its rows read `Runpod (Serverless)`, and the note says the run's cost is an estimate and the month counts Serverless runs an hour or more late.
4. **Older rows.** Let a task whose earlier runs predate this change run its agent once more. Its older rows read "—" in the provider column and add no note; the new run's row reads its provider, and its note appears under the table.
5. **Portuguese.** On a task in Portuguese, the column reads "Provedor", the month "Mês (estimado)", and the notes are in Portuguese.

## Out of scope

- Estimating Serverless runs that Runpod has not billed yet.
- Renaming the `monthly-budget` setting.
- A month per repository on Runpod: the account is the unit Runpod bills.
