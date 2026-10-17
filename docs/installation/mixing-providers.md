# Mixing providers

A repository can use different [providers](../glossary.md#inference-provider) for different [stages](../glossary.md#stage), such as OpenRouter's strongest model to plan and route, and a [pod](../glossary.md#pod) for the stages that write and test code. This page shows how; [profiles](../settings/profiles.md) is the reference.

Add a list of [profiles](../glossary.md#profile) to `.codeman/settings.yml`, or to the organization's [shared settings](shared-settings.md). The [top-level](../glossary.md#top-level) settings apply where no profile does:

```yaml
model: anthropic/claude-sonnet-4.5     # the default: OpenRouter
profiles:
  - name: small-pod
    stages: [code, test]
    max-tasks: 2
    provider: runpod-pod
    gpu: "NVIDIA RTX A6000"
    model: qwen3-coder:30b
  - name: cheap-review
    stages: [review]
    model: deepseek/deepseek-v4.1-flash
```

Here, the code and test stages run on a pod, up to 2 tasks at a time, and review runs on a cheaper OpenRouter model. Planning, routing and the other stages use the top level's model.

## Write the profiles

1. Give each profile a `name`, and beside it the `stages` it is for: `plan`, `route`, `web`, `design`, `code`, `test` or `review` (see [stages](../tasks/stages.md)). A profile without `stages` applies to every stage, so put it last.
2. To work on several tasks at once, give a profile a [count](../glossary.md#count) of the run's tasks: `tasks` for exactly that many, or `min-tasks` and `max-tasks` for a range, from 1 to 10. See [several tasks at once](#several-tasks-at-once).
3. Put in each profile only what changes: `provider`, `model` and the provider's settings ([providers](../settings/providers.md)). Everything else, budgets included, stays at the top level and applies to every run.
4. Order them: the first profile whose [conditions](../glossary.md#profile-condition) hold applies.

## Rules each profile must follow

| Rule | Otherwise |
| --- | --- |
| The top-level `model` is optional, but every stage needs a profile with its own `model` when there is none | A stage that none serves blocks the task that reaches it |
| A profile on pods needs a `gpu`, in the profile, or at the top level when the top level is on pods too | The first run stops with an error that names the profile |
| A profile on another provider than the top level's needs its own `model` | The first run stops with an error that names the profile |

Each profile must work with what it inherits from the top-level settings. What a profile on another provider than the top level's keeps is in [provider settings across layers](../settings/provider-settings-across-layers.md). How profiles are checked is in [checks](../settings/profiles.md#checks).

## Add the secrets

Add the secrets of every provider the settings and profiles name ([credentials](setup.md#secrets)). A run needs its own provider's. Without one, runs stop, and the task's panel names the missing secret.

> [!NOTE]
> With `organization-monthly-budget`, every run reads the billing of the Runpod account when a Runpod provider is named, or when a run of the organization's month used it. So a run on OpenRouter needs the Runpod key too.

## Several tasks at once

A [workflow run](../glossary.md#workflow-run) works on one task by default. A profile with a count, such as `max-tasks: 2`, lets a run work on that many at once, each with its own key and agent.

- The largest count is how many tasks a run takes. With none, one at a time.
- A task that only a larger count serves waits for enough tasks ([how many tasks a run takes](../settings/profiles.md#how-many-tasks-a-run-takes)).
- The run ends when its slowest task does.

What a count means depends on the provider:

| Provider | Tasks at once | Cost |
| --- | --- | --- |
| OpenRouter | Only finish sooner | Each task pays for its own tokens |
| A pod | A [batch](../glossary.md#batch): tasks with the same pod settings, of this and the pool's other repositories, share one pod ([batches across repositories](../runs/batches.md)) | They split the pod's cost by the second ([pods](runpod.md#pods)) |
| Serverless | Use the endpoint's workers at the same times | Each task counts the worker time its requests used. Time that tasks of any of the organization's repositories used the worker at once is split among them as they close. A run's own limit still counts it whole while it runs ([Serverless](../inference/serverless.md)) |

The budgets hold across the tasks: each run's limit is reserved in Codeman's [ledger](../glossary.md#ledger) before it opens, so tasks that open at once never pass a budget together ([budget](../budget/budget.md)).

## Learn more

- The [example](../settings/profiles.md#example) plans on OpenRouter and runs 4 tasks on a full GPU, or up to 3 on a MIG partition.
- [Profiles](../settings/profiles.md): which profile applies, and how profiles combine with the organization's settings, a manual run's inputs and a task's commands.
