# OpenRouter

With `provider: openrouter`, the default, each [agent run](../glossary.md#agent-run) gets its own OpenRouter key, its [task key](../glossary.md#task-key), limited to what remains of the task's [budget](../budget/budget.md). OpenRouter bills tokens, so a run's cost is exact: what its key used.

## The run's key

| Property | Value |
| --- | --- |
| Name | `codeman/<owner>/<repo>/<issue>/<run>`; the last segment is the [workflow run](../glossary.md#workflow-run)'s ID |
| Limit | The run's [budget reservation](../glossary.md#reservation) in the [ledger](../glossary.md#ledger) |
| Expiry | The action's `key-expiry-hours` input after its creation: 24 hours by default, which the templates do not change |
| At the end | Disabled, not deleted, so its usage still counts |

`open-key` passes the key to the agent job encrypted ([the key between jobs](#the-key-between-jobs)).

The agent reads images when OpenCode's model catalog says the model does: Codeman registers OpenRouter's models without capabilities of its own, so the catalog's apply ([provider.ts](../web/opencode/opencode-packages-opencode-src-provider-provider-ts-at-545f51d.md#a-model-from-the-configuration)).

## How it works

### Closing a run

After the agent, `close-key`:

1. **Disables the key.**
2. **Reads its cost**, until it stops changing, since OpenRouter counts the last requests a little late. If the cost still reads zero while analytics already has the run's tokens, it waits up to about a minute more.
3. **Reads its usage figures** from analytics ([usage figures](#usage-figures)).
4. **Refreshes the task's earlier runs** in the ledger ([below](#refreshing-earlier-runs)).
5. **Reports, from the ledger,** the task's total and what each run spent. That includes a [Serverless](serverless.md) run's cost that a later close on its endpoint lowered.

With that report, `apply`:

- refreshes each row's cost in the [spend table](../budget/spend.md#the-spend-table), so a run that read its cost too soon gets it right on the task's next run, whatever that run's provider;
- shows what the task spent at the end of the pull request's description;
- keeps the task's total in the [task record](../glossary.md#task-record).

### Refreshing earlier runs

A run can read its cost before OpenRouter has counted all of it, and a run whose reservation expired never read it at all. So later runs take each earlier run's cost from its key:

- The job lists the task's keys. In the ledger, it replaces the cost of each earlier run of the task with what its key says now, matched by run ID: the end of the key's name.
- `close-key` of an OpenRouter run always does this.
- `open-key` and `close-key` of a run on another [inference provider](../glossary.md#inference-provider) do it too, when the task has an OpenRouter run that ended.

> [!NOTE]
> Refreshing needs OpenRouter's management key in the job, which the templates pass to both key jobs. Without it, the costs stay as the ledger has them. Failing to read the keys only warns.

### Usage figures

`close-key` reads these from OpenRouter's analytics (`POST /api/v1/analytics/query`, filtered by the key's hash), as OpenRouter counts them. They never come from the [harness](../glossary.md#harness), whose counts differ.

| Figure | From analytics | Note |
| --- | --- | --- |
| Input tokens | `tokens_prompt` | Cached prompt tokens included |
| Output tokens | `tokens_completion` | The completion tokens |
| Requests | `request_count` | |
| Tokens per second | `avg_throughput` | Mean completion tokens per second |
| Context length | `tokens_prompt` by `generation_id`, largest first | The input tokens of the run's largest request, cached ones included |

- Analytics and billing may count a request at different times, so `close-key` asks again for up to about a minute. A run whose tokens are not there by then shows "—".
- Analytics keeps throughput and single requests for 31 days, longer than any key lives.

### The key between jobs

Values passed between jobs appear in plain text in the logs of the job that reads them. So `open-key` passes the key encrypted with AES-256-GCM, using a key derived from `CODEMAN_KEY_ENCRYPTION_SECRET`, as it does a self-hosted run's [run token](../glossary.md#run-token) ([secrets](../security/secrets.md)).
