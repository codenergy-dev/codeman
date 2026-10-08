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

## Workflow files copied before the backend

To update workflow files copied before the backend, copy both templates again, and move any steps you added to the `agent` job into the new `codeman-task.yml`: the jobs that record runs need their new permissions, variables and the run's ID in the ledger. Older workflow files fail in `select`, before they mark any task, since they pass none of the backend's variables. Workflow files copied before the budgets came from the ledger pass neither the organization's monthly budget nor the task's spend from `close-key` to `apply`: copy both templates again, too. With pods, update every repository of the organization at once to a version with the pod registry: its `open-key` terminates the organization's pods created by older versions, which the registry does not hold, and older versions cannot share the newer pods.
