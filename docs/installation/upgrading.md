# Upgrading

## Old setting names

Settings written before the [provider settings plan](../plans/2026-10-08-provider-settings.md) stop the run with an error that gives the new name. In `.codeman/settings.yml`, the organization's `CODEMAN_SETTINGS` and each profile:

- `inference: openrouter` becomes `provider: openrouter`, or goes, since it is the default.
- `inference: self-hosted` with `gpu-mode: pod` (or no `gpu-mode`) becomes `provider: runpod-pod`, and `gpu-type` becomes `gpu`.
- `inference: self-hosted` with `gpu-mode: serverless` becomes `provider: runpod-serverless`, and `serverless-endpoint` becomes `endpoint`.
- `gpu-provider` and `gpu-mode` go.
- `inference-profiles` becomes `profiles`.

A task that changed its GPU with `/codeman set gpu-type` needs `/codeman set gpu` instead: the old command is reported as a problem that gives the new name.

## A model per provider

Since the [model per provider plan](../plans/2026-10-08-model-per-provider.md), a repository's file or a profile that names another provider than the one it inherits must set its own `model`; the first run stops with an error that names it otherwise. Add the model the new provider serves, such as `model: qwen3-coder:30b` to a profile with `provider: runpod-pod` that inherits OpenRouter from the top level. A task's `/codeman set model` now applies only to the runs on the top level's provider ([the model](../settings/provider-settings-across-layers.md#the-model)).

## Profiles pick the tasks

Since the [plan for profiles that pick the tasks](../plans/2026-10-08-profiles-pick-the-tasks.md), a profile's conditions sit at its first level, the profiles' counts decide how many tasks a run takes, and no setting is required. Settings written before stop the run with an error that says what to write instead. In `.codeman/settings.yml`, the organization's `CODEMAN_SETTINGS` and each profile:

| Before | Now |
| --- | --- |
| `when:` with `stages: [code]` under it | `stages: [code]` in the profile, beside its `name` |
| `parallel-tasks: N` under a profile's `when` (at least N tasks) | `min-tasks: N` in the profile; or `tasks: N` for exactly N, `max-tasks` for at most |
| `parallel-tasks: N` at the top level | `max-tasks: N` (or `tasks: N`) in a profile: the largest count a profile names is how many tasks a run takes. A profile with only a `name` and `max-tasks: N` is enough: it changes nothing else |
| `parallel-tasks: 1`, or none | Nothing: one task at a time when no profile has a count |
| `model` required at the top level | Optional: without it, only profiles serve agent runs, and each sets its own `model` |

For example:

```yaml
# Before
model: deepseek/deepseek-v4.1-flash
parallel-tasks: 3
profiles:
  - name: small-pod
    when:
      stages: [code, test]
      parallel-tasks: 2
    provider: runpod-pod
    gpu: "NVIDIA RTX A6000"
    model: qwen3-coder:30b

# Now
model: deepseek/deepseek-v4.1-flash
profiles:
  - name: small-pod
    stages: [code, test]
    min-tasks: 2
    max-tasks: 3
    provider: runpod-pod
    gpu: "NVIDIA RTX A6000"
    model: qwen3-coder:30b
```

`small-pod`'s `max-tasks: 3` makes runs of up to 3 tasks, as `parallel-tasks: 3` did; the top level serves the other runs, at any count. Without a profile that names a count, add one with only a `name` and `max-tasks: 3`.

Behind the change: a task that its profiles serve only with more tasks than are ready now waits, and its panel says so; one whose stage nothing serves at any count is blocked ([profiles](../settings/profiles.md#how-many-tasks-a-run-takes)). The workflow files need no change: the run's matrix already follows what `select` picks.

## Workflow files copied before the backend

To update workflow files copied before the backend, copy both templates again, and move any steps you added to the `agent` job into the new `codeman-task.yml`: the jobs that record runs need their new permissions, variables and the run's ID in the ledger. Older workflow files fail in `select`, before they mark any task, since they pass none of the backend's variables. Workflow files copied before the budgets came from the ledger pass neither the organization's monthly budget nor the task's spend from `close-key` to `apply`: copy both templates again, too. With pods, update every repository of the organization at once to a version with the pod registry: its `open-key` terminates the organization's pods created by older versions, which the registry does not hold, and older versions cannot share the newer pods.
