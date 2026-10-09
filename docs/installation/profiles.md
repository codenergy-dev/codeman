# Profiles

A repository can use different providers for different stages, such as OpenRouter's strongest model to plan and route, and a pod for the stages that write and test code. Add a list of profiles to `.codeman/settings.yml` (or to the organization's [shared settings](shared-settings.md)); the top-level settings apply where no profile does:

```yaml
model: anthropic/claude-sonnet-4.5     # the default: OpenRouter
profiles:
  - name: small-pod
    stages: [code, test]
    max-tasks: 2
    provider: runpod-pod
    gpu: NVIDIA RTX A6000
    model: qwen3-coder:30b
  - name: cheap-review
    stages: [review]
    model: deepseek/deepseek-v4.1-flash
```

1. Give each profile a `name`, and beside it the `stages` it is for: `plan`, `route`, `web`, `design`, `code`, `test` or `review` (see [stages](../tasks/stages.md)). A profile without `stages` applies to every stage, so put it last.
2. To work on several tasks at once, give a profile a count of the run's tasks: `tasks` for exactly that many, or `min-tasks` and `max-tasks` for a range, from 1 to 10. The largest count is how many tasks a run takes; with none, one at a time. Here, a run takes up to 2 tasks, and its code and test stages share a pod. A task that only a larger count serves waits for enough tasks; see [how many tasks a run takes](../settings/profiles.md#how-many-tasks-a-run-takes).
3. Put in each profile only what changes: `provider`, `model` and the provider's settings ([providers](../settings/providers.md)). Everything else, budgets included, stays at the top level and applies to every run.
4. Order them: the first profile whose conditions hold applies.
5. Add the secrets of every provider the settings and profiles name: a run needs its own provider's, and with `organization-monthly-budget`, every run reads the billing of the Runpod account when a Runpod provider is named, so a run on OpenRouter needs the Runpod key too. Without one, runs stop, and the task's panel names the missing secret.

The top-level `model` is optional: without it, every stage needs a profile with its own `model`, and a stage that none serves blocks the task that reaches it. Each profile must work with what it inherits from the top-level settings: a profile on pods needs a `gpu`, here or at the top level when it is on pods too, and a profile on another provider than the top level's needs its own `model`. The [example](../settings/profiles.md#example) plans on OpenRouter and runs 4 tasks on a full GPU, or up to 3 on a MIG partition. See [provider settings across layers](../settings/provider-settings-across-layers.md) for what a profile on another provider than the top level's keeps, and [profiles](../settings/profiles.md) for which profile applies, how profiles combine with the organization's settings, a manual run's inputs and a task's commands, and how they are checked.
