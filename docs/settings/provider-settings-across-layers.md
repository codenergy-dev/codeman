# Provider settings across layers

A run's settings come from [layers](reference.md) and, for some runs, a [profile](profiles.md). This page says what happens to a [provider's](providers.md) settings when a layer or a profile changes provider, with worked examples. The rule was chosen in the [provider settings plan](../plans/2026-10-08-provider-settings.md) (choice 9), what it requires of `model` in the [model per provider plan](../plans/2026-10-08-model-per-provider.md), and `serving` and `resolveRun` in [`src/settings.ts`](../../src/settings.ts) apply them.

## The rule

A provider's settings (`engine`, `gpu`, `endpoint`, `pod-reuse`) go with it.

1. Each layer inherits from its base, the layers before it ([settings](reference.md)): Codeman's default (`provider: openrouter`), the organization's settings, the repository's file, a manual run's inputs; then the run's profile, whose base is the top level; then the task's commands.
2. A layer or profile that names another provider than the one it inherits starts with none of the inherited provider settings, and must set its own `model` ([the model](#the-model)).
3. One that names the same provider, or none, keeps them, and replaces only those it sets.
4. Then the provider's defaults fill what is left (`engine`; `pod-reuse: task`).

Budgets and limits are not provider settings, and never drop.

## Why

No layer can unset a value it inherits: `gpu:` with no value is an error ("`gpu` must be a GPU type, such as `NVIDIA RTX A6000`."). Without the rule, a profile could not leave a provider whose settings the next one refuses.

## The model

A model is set for one provider, and never reaches another.

- **A layer or profile that changes provider sets its own `model`.** Otherwise the first run, whatever its stage, stops in `select`, before any key is opened or pod created, with an error that names the layer or profile: "Profile `planner` names `openrouter`, but inherits `runpod-pod` from the top level, so it must set its own `model`, one for `openrouter`." A layer or profile that names no provider, or the same one, inherits `model`.
- **The provider it inherits** is the one its base resolves to, and the error names where it comes from: the top level, for a profile; for a layer, the last layer before it that names a provider, or Codeman's default `openrouter` when none does. So a repository's file with `provider: runpod-pod`, whose organization's settings set only `model`, changes provider: ".codeman/settings.yml names `runpod-pod`, but inherits `openrouter` from Codeman's default, so it must set its own `model`, one for `runpod-pod`."
- **Only a model that would carry over counts.** Codeman's defaults have no model, so a change of provider that inherits no model needs none of its own: an organization can name `provider: runpod-pod` and leave the model to each repository.
- **A manual run's `model` input does not make up for it**, since scheduled runs have none: the repository's file must set its own. The input replaces the top level's model, so it reaches the runs on the top level's provider.
- **A task's `/codeman set model` does not either.** It is for the top level's provider: it overrides the model of the runs on that provider, profiles included, and a profile on another provider keeps its own model. Where it does not fit the top level's provider, it is reported as a problem and left out.

Why: Codeman checks a model's form only, and an OpenRouter ID such as `deepseek/deepseek-v4.1-flash` also has the form of an Ollama name and of a Hugging Face ID. A model carried from OpenRouter to a pod would pass the check, and fail only when the pod, already created and billed, pulls it.

## Examples

Every outcome and error below is asserted by `src/settings.test.ts` ("provider settings across layers").

### 1. A profile that switches provider

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
profiles:
  - name: serverless-review
    stages: [review]
    provider: runpod-serverless
    endpoint: abc123xyz
    model: Qwen/Qwen3-Coder-30B-A3B-Instruct
```

Review runs: `runpod-serverless`, `endpoint: abc123xyz`, `engine: vllm` (its default), the Qwen model; no `gpu`, no `pod-reuse`. Every other run: `runpod-pod`, `qwen3-coder:30b`, `gpu: "NVIDIA RTX A6000"`, `pod-reuse: task` and `engine: ollama` (the defaults).

Without the rule, the profile would inherit `gpu`, and every run would stop with "Profile `serverless-review`: `runpod-serverless` does not accept `gpu`; besides `model`, it takes `engine` and `endpoint`.", with nothing the profile could write to fix it.

### 2. A repository leaves the organization's pods

The organization's `CODEMAN_SETTINGS`:

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
pod-reuse: run
task-budget: 1
```

The repository's `.codeman/settings.yml`:

```yaml
provider: openrouter
model: deepseek/deepseek-v4.1-flash
```

Runs: `openrouter` with `deepseek/deepseek-v4.1-flash`. The organization's `gpu` and `pod-reuse` are dropped; its `task-budget: 1` still applies.

Had the file set only `provider: openrouter`, the organization's model would carry over to another provider, so the first run would stop with ".codeman/settings.yml names `openrouter`, but inherits `runpod-pod` from the organization's settings, so it must set its own `model`, one for `openrouter`."

### 3. No provider, or the same provider, keeps them

With the same organization's settings as its base, a repository file with only `model: qwen2.5-coder:32b`, or with `provider: runpod-pod` and that model, runs `runpod-pod` with `qwen2.5-coder:32b`, the organization's `gpu` and `pod-reuse: run`. The same holds for profiles:

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
pod-reuse: run
profiles:
  - name: bigger-gpu
    stages: [code]
    gpu: "NVIDIA H100 80GB HBM3"
  - name: other-model
    stages: [test]
    provider: runpod-pod
    model: qwen2.5-coder:32b
```

Code runs: `qwen3-coder:30b` on `"NVIDIA H100 80GB HBM3"`, `pod-reuse: run`. Test runs: `qwen2.5-coder:32b` on `"NVIDIA RTX A6000"`, `pod-reuse: run`.

### 4. A profile that changes provider sets its own model

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
profiles:
  - name: planner
    stages: [plan, route]
    provider: openrouter
```

The profile changes provider without `model`, so the first run, whatever its stage, stops with "Profile `planner` names `openrouter`, but inherits `runpod-pod` from the top level, so it must set its own `model`, one for `openrouter`." The fix is a `model` in the profile, such as `model: deepseek/deepseek-v4.1-flash`. The same holds the other way round, for a profile on Runpod that inherits OpenRouter from the top level, though an OpenRouter ID would pass the Runpod engines' check of its form ([the model](#the-model)).

## Summary

| Where | Names a provider? | Inherited provider settings (`engine`, `gpu`, `endpoint`, `pod-reuse`) | Inherited `model` |
| --- | --- | --- | --- |
| Organization's settings, repository's file, or a profile, without `provider` | No | Kept; those it sets replace them | Carries over, unless it sets one |
| The same, with the same provider as its base | Yes, the same | Kept; those it sets replace them | Carries over, unless it sets one |
| The same, with another provider | Yes, another | Dropped; only its own, then the new provider's defaults | Never carries over: it must set its own when it inherits one |
| A manual run's inputs | Cannot (no `provider` input) | Kept | Its `model` replaces the top level's, not a profile's; it does not stand in for a layer's own |
| A task's `/codeman set` | Cannot (no `set provider`) | `gpu` applies to the runs whose provider accepts it | For the top level's provider: overrides the model of its runs, profiles included; a profile on another provider keeps its own; where it does not fit, reported as a problem and left out |
