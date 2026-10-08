# Provider settings across layers

A run's settings come from [layers](reference.md) and, for some runs, a [profile](profiles.md). This page says what happens to a [provider's](providers.md) settings when a layer or a profile changes provider, with worked examples. The rule was chosen in the [provider settings plan](../plans/2026-10-08-provider-settings.md) (choice 9), and `serving` and `resolveRun` in [`src/settings.ts`](../../src/settings.ts) apply it.

## The rule

A provider's settings (`engine`, `gpu`, `endpoint`, `pod-reuse`) go with it.

1. The layers apply from the bottom: Codeman's defaults (`provider: openrouter`), the organization's settings, the repository's file, a manual run's inputs; then the run's profile over the top level; then the task's commands.
2. A layer or profile that names another provider than the one below it starts with none of the provider settings below.
3. One that names the same provider, or none, keeps them, and replaces only those it sets.
4. Then the provider's defaults fill what is left (`engine`; `pod-reuse: task`).

Budgets and limits are not provider settings, and never drop. Neither is `model`; see [the model](#the-model).

## Why

No layer can unset a value from a layer below: `gpu:` with no value is an error ("`gpu` must be a GPU type, such as `NVIDIA RTX A6000`."). Without the rule, a profile could not leave a provider whose settings the next one refuses.

## The model

`model` always carries over, and must fit the provider the run ends on. Codeman checks the model's form only: an OpenRouter ID such as `deepseek/deepseek-v4.1-flash` also has the form of an Ollama name and of a Hugging Face ID, so a `runpod-pod` or `runpod-serverless` profile without `model` under an OpenRouter top level passes the check. On Serverless, `open-key`'s endpoint check then refuses the run, since the worker serves another model; on pods, the pod fails to pull it, after Codeman created it. A profile that changes provider should always set `model`.

## Examples

Every outcome and error below is asserted by `src/settings.test.ts` ("provider settings across layers").

### 1. A profile that switches provider

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
profiles:
  - name: serverless-review
    when:
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

Had the file set only `provider: openrouter`, the organization's model would carry over, and the first run would stop with "With `openrouter`, `model` must be an OpenRouter model ID, such as `provider/model`, not `qwen3-coder:30b`." (no profile name: the error is in the top-level settings).

### 3. No provider, or the same provider, keeps them

Over the same organization's settings, a repository file with only `model: qwen2.5-coder:32b`, or with `provider: runpod-pod` and that model, runs `runpod-pod` with `qwen2.5-coder:32b`, the organization's `gpu` and `pod-reuse: run`. The same holds for profiles:

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
pod-reuse: run
profiles:
  - name: bigger-gpu
    when:
      stages: [code]
    gpu: "NVIDIA H100 80GB HBM3"
  - name: other-model
    when:
      stages: [test]
    provider: runpod-pod
    model: qwen2.5-coder:32b
```

Code runs: `qwen3-coder:30b` on `"NVIDIA H100 80GB HBM3"`, `pod-reuse: run`. Test runs: `qwen2.5-coder:32b` on `"NVIDIA RTX A6000"`, `pod-reuse: run`.

### 4. The model carries over, and must fit

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
profiles:
  - name: planner
    when:
      stages: [plan, route]
    provider: openrouter
```

The profile drops `gpu` but keeps the Ollama model, so the first run, whatever its stage, stops with "Profile `planner`: With `openrouter`, `model` must be an OpenRouter model ID, such as `provider/model`, not `qwen3-coder:30b`." The fix is a `model` in the profile. The other way round, a profile on Runpod without `model` under an OpenRouter top level passes the check, and fails later ([the model](#the-model)).

## Summary

| Where | Names a provider? | Provider settings from below (`engine`, `gpu`, `endpoint`, `pod-reuse`) | `model` from below |
| --- | --- | --- | --- |
| Organization's settings, repository's file, or a profile, without `provider` | No | Kept; those it sets replace them | Carries over, unless it sets one |
| The same, with the same provider as below | Yes, the same | Kept; those it sets replace them | Carries over, unless it sets one |
| The same, with another provider | Yes, another | Dropped; only its own, then the new provider's defaults | Carries over, unless it sets one; must fit the new provider |
| A manual run's inputs | Cannot (no `provider` input) | Kept | Its `model` replaces the top level's, not a profile's |
| A task's `/codeman set` | Cannot (no `set provider`) | `gpu` applies to the runs whose provider accepts it | Wins over every layer and profile; where it does not fit, reported as a problem and left out |
