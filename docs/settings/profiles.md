# Profiles

`profiles` is a list of profiles, each with a `name`, optional conditions under `when`, and the settings it changes: only `provider`, `model` and the provider's settings. Budgets and limits stay at the top level. The choice was made in the [inference profiles plan](../plans/2026-10-06-parallel-tasks-and-inference-profiles.md) (decisions 4 to 6), and the names in the [provider settings plan](../plans/2026-10-08-provider-settings.md).

```yaml
model: deepseek/deepseek-v4.1-flash      # when no profile applies
profiles:
  - name: small-pod
    when:
      stages: [code, test]
    provider: runpod-pod
    gpu: NVIDIA RTX A6000
    model: qwen3-coder:30b
```

- **Conditions.** `stages` lists what the agent works on: `plan` (planning), `route` (routing), or a stage (`web`, `design`, `code`, `test`, `review`). Planning and routing are not stages, but the condition takes them too ([agent runs](../tasks/stages.md#agent-runs)). `parallel-tasks: N` holds when at least N of the run's tasks run an agent (recording answers and accepting workflows do not), whatever the `parallel-tasks` setting allows. A profile without conditions always applies.
- **Which applies.** `select` takes the first profile, in the list's order, whose conditions all hold for the run, and its values replace the top-level ones; with none, the top-level settings apply. What a profile that names another provider than the top level's keeps of its provider settings is in [provider settings across layers](provider-settings-across-layers.md). Runs without an agent (recording answers, accepting workflows) use the top-level settings. The run's log names the profile, and the spend table's model and provider columns show what each run used.
- **Layers.** The list is one value: a layer that sets `profiles` overrides its base's list whole, so a repository's file with `profiles` replaces the organization's list, and `profiles: []` removes it. A profile's base is the top level, a manual run's inputs included, and its values override it: a manual run's `model` applies only to runs whose profile sets none. A task's `/codeman set model` is for the top level's provider: it overrides the profiles on that provider, a profile on another provider keeps its own model, and where it does not fit the top level's provider, it is reported as a problem, and the run goes on without it ([the model](provider-settings-across-layers.md#the-model)). A task's `/codeman set gpu` applies to the runs whose provider accepts it, and is reported as a problem when none of the settings' providers does.
- **Checks.** The top-level settings, and each profile with what it inherits from them, must fit their providers on their own, whichever stage runs: a mistake stops the first run, with an error that names the profile. A profile that names another provider than the top level's must set its own `model`, which neither a manual run's input nor a task's command makes up for.
- **Budgets.** The task and the months count every run in the ledger, whatever served it; with an organization's budget, `open-key` reads the billing of the Runpod account when a profile names a Runpod provider. See [budget](../budget/budget.md).
