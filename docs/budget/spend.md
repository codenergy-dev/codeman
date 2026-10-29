# Spend

This page explains what a task's spend table shows, and how self-hosted runs count in the [budgets](budget.md).

## The spend table

The [status comment](../glossary.md#status-comment) has a spend table, with one row per [agent run](../glossary.md#agent-run). Each run comment shows its own row.

### Columns

| Column | Shows |
| --- | --- |
| When | When the run ran |
| Stage | The run's [stage](../glossary.md#stage) |
| Model | The run's model |
| Provider | Where the model was served: `OpenRouter`, `Runpod (pod)`, `Runpod (Serverless)` or `Salad (pod)`, for the [providers](../settings/providers.md) `openrouter`, `runpod-pod`, `runpod-serverless` and `salad-pod` |
| Time | How long the agent ran, as the agent job measures it, outside the sandbox |
| Input and output tokens | As the provider or the [gateway](../glossary.md#gateway) counts them |
| Context length | The input tokens of the run's largest request |
| Tokens per second | The mean completion tokens per second |
| Cost | What the run spent: exact on OpenRouter, measured or estimated on Runpod, estimated on Salad ([self-hosted runs](#self-hosted-runs)) |
| Limit | The key's limit: the run's [budget reservation](../glossary.md#reservation) |
| Task budget | The task's `task-budget` |
| Month (estimated) | What the repository's runs counted this month in the [ledger](../glossary.md#ledger) before the run, of the monthly budget |

The month counts estimates and open runs' limits, so its column is named "Month (estimated)". The `monthly-budget` setting it is spent against keeps its name.

### Notes under the table

- A note for each provider in its rows says how a run's cost is measured, since only OpenRouter's is exact.
- A last note says how the month is counted.
- A run comment has its own row's notes.
- Under the table goes what the task spent of its budget.

### Special rows

- **Folded rows.** The [task record](../glossary.md#task-record) keeps the last 30 rows. Older ones fold into one, with their sums, and their costs are no longer refreshed.
- **Re-runs.** A run with several rows, after a re-run of the whole workflow, keeps them as they are.
- **The difference.** The task's total comes from the ledger. When the rows add up to less, a row shows the difference: a run whose `apply` failed has no row, and a pod's time between runs is in no run's row.
- **The total.** A last row totals every run of the task. Agent time, tokens and cost are summed, so its cost is the task's total. The context length is the largest of the task. Tokens per second is the mean over every request: each run's mean, weighted by its requests. Limits and budgets are left empty.

## Self-hosted runs

### What counts where

| Spend | Task | Repository's month | Organization's month |
| --- | --- | --- | --- |
| An OpenRouter run's cost | Yes | Yes | Yes |
| A pod run's time, at the pod's price | Yes | Yes | Yes, reconciled with Runpod's billing; Salad's as it is |
| A task's pod time between its runs (`podCost`) | Yes | Yes | Yes, reconciled with Runpod's billing; Salad's as it is |
| A Serverless run's share of the worker's estimated time | Yes | Yes | Yes, reconciled with the billing |
| A pod's [untracked time](../glossary.md#untracked-time) | No | No | Yes, split among the pool's organizations |
| A pod that terminated itself | No | No | Once Runpod bills it; never on Salad |

A task whose runs use several providers, through [profiles](../settings/profiles.md) or a change of `provider`, adds them up in the ledger.

### The months

A pod run counts its time at the pod's price, and a Serverless run its estimate, in the ledger as soon as they close. So they count in the repository's month at once.

The organization's month reconciles Runpod's with its billing by the hour (`GET /v2/billing`), which also counts the time no run accounts for ([budget](budget.md#reconciling-with-gpu-billing)).

Salad has no billing API ([plan for Salad pods](../plans/2026-10-29-add-salad-pods.md), decision 5), so its account is not hourly:

- A Salad run's cost is an estimate: the pod's time at the listed price of its GPU class and priority. It counts from the group's creation, so it includes the image's download, which Salad does not bill, and never falls short of the bill on that account.
- The organization's month counts those estimates as they are. It reads no Salad billing, so a run on another provider needs no Salad key for the month's past Salad runs.
- A pod's time that no run accounts for counts only when a Codeman job ends the pod ([untracked time](#untracked-time)).

Runpod cannot list terminated pods, and pods serve the organization, or its [pool](../glossary.md#pool-of-organizations), rather than one repository. So the whole account's billing counts in the organization's month. With a pool, it counts in its organizations' months, split by what each estimated.

> [!WARNING]
> Use a Runpod account dedicated to Codeman, for the pool's repositories: the organization's month counts everything the account bills. On Salad, a dedicated organization keeps Salad's own usage page Codeman's alone, the only place to compare the estimates with the bill.

### A task's pods

Providers bill pods, not tasks. So the task's record lists its pods, the last 20, whose billing `close-key` reads at each of the task's runs.

- A pod's cost is its billing. For the run's own pod, it is its whole life so far at its rate, when that is higher. That includes a kept pod's time between runs, which Runpod bills late.
- `close-key` records it in the ledger: `podCost`, on the task's last run on the pod.
- The task counts, for each pod, the higher of that cost and its runs' costs on it. The spend table shows the difference in its row for what the task spent outside its runs.
- A run whose pod served it alone gets the pod's cost as its own.
- [Serverless](../inference/serverless.md) runs count their share of the worker's estimated time.
- The minutes between a task's last run and its pod's termination count as the pod's untracked time, in the organization's month.

### Shared pods

A run's cost is its share of the pod. When `close-key` cannot read it from the gateway, it is the pod's time since the run started, capped at the run's limit, as an estimate it warns of ([pods](../inference/pods.md#closing-a-run)).

Runpod bills the pod as a whole. So a task counts, for a shared pod, what the gateway measured for it as of each of its closes: its runs' shares and the [kept time](../glossary.md#kept-time) it was given.

- The record marks such a pod (`shared`). `close-key` then no longer reads its billing, since the gateway, which knew who used each second, is gone with the pod.
- The tasks' counts therefore add up to no more than the pod's bill.
- They leave out the time a task kept the pod after its last close, unless it runs on the pod again, and the time after the last task left it. Both count as the pod's untracked time.

### Untracked time

When a Codeman job terminates a pod, it records on the pod's document ([decision 4 of the pod registry plan](../plans/2026-10-07-pod-registry.md)):

- the pod's life at its price;
- what the ledger's runs on it count;
- the difference, its untracked time.

The untracked time is:

- the time after its tasks' last closes, kept or not;
- the time a pod whose runs were all stopped waits for their closes;
- all of a pod that never served a run.

It counts in the organization's month at once, spread over the pod's life and reconciled with the billing like the runs. No repository's month and no task counts it.

A pod that the pool's organizations shared splits it among them, in proportion to what their runs counted on it (`untrackedBy`). When none counted anything, it all goes to the organization that created the pod ([decision 14 of the plan for GPU batches across repositories](../plans/2026-10-13-gpu-batches-across-repositories.md)).

A pod that terminated itself has no known end, and its time counts once Runpod bills it. A Salad pod that ended itself counts only what its runs counted, since Salad has no billing to read.

### In the spend table

Self-hosted rows name `Runpod (pod)`, `Runpod (Serverless)` or `Salad (pod)`. The notes under the table say how their figures are measured:

- A pod run's cost is its pod's time at its price. The task also counts its pod's time between runs, refreshed from billing.
- A Serverless run's cost is an estimate. It counts in the month as soon as the run ends, and shrinks when other runs that used the worker at the same times close.
- A Salad pod run's cost is an estimate, at Salad's listed price for its GPU and priority, the image's free download included. Nothing refreshes it.
- The month is the repository's, from the ledger.

## How it works

`select` passes the key jobs, in its `inference` output, the task's pods and its record's total, with the rest of its choice:

- the run's provider and its settings;
- its profile;
- the account of every provider the settings name.
