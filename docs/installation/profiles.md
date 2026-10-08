# Profiles

A repository can use different providers for different runs, such as OpenRouter's strongest model to plan and route, and a pod for the stages that write and test code. Add a list of profiles to `.codeman/settings.yml` (or to the organization's [shared settings](shared-settings.md)); the top-level settings apply where no profile does:

```yaml
model: anthropic/claude-sonnet-4.5     # the default: OpenRouter
profiles:
  - name: small-pod
    when:
      stages: [code, test]
    provider: runpod-pod
    gpu: NVIDIA RTX A6000
    model: qwen3-coder:30b
  - name: cheap-review
    when:
      stages: [review]
    model: deepseek/deepseek-v4.1-flash
```

1. Give each profile a `name`, and under `when` the `stages` it is for: `plan`, `route`, `web`, `design`, `code`, `test` or `review`; `parallel-tasks` is the other [condition](../settings/profiles.md). A profile without `when` applies to every run, so put it last.
2. Put in each profile only what changes: `provider`, `model` and the provider's settings ([providers](../settings/providers.md)). Everything else, budgets included, stays at the top level and applies to every run.
3. Order them: the first profile whose conditions hold applies.
4. Add the secrets of every provider the settings and profiles name: a run needs its own provider's, and with `organization-monthly-budget`, every run reads the billing of the Runpod account when a Runpod provider is named, so a run on OpenRouter needs the Runpod key too. Without one, runs stop, and the task's panel names the missing secret.

Each profile must work over the top-level settings: a profile on pods needs a `gpu`, here or at the top level when it is on pods too. See [provider settings across layers](../settings/provider-settings-across-layers.md) for what a profile on another provider than the top level's keeps, and [profiles](../settings/profiles.md) for which profile applies, how profiles combine with the organization's settings, a manual run's inputs and a task's commands, and how they are checked.
