# Providers

`provider` chooses where a run's model is served. Each provider accepts its own settings beside `model`, and a setting it does not accept, a value it does not offer, or a required setting it lacks stops the run with an error that names the provider. A top level without a `model` serves no run, so it is checked only for what its provider accepts ([profiles](profiles.md#checks)). The registry in [`src/inference/providers.ts`](../../src/inference/providers.ts) holds them; a new provider is a new entry. The choices were made in the [provider settings plan](../plans/2026-10-08-provider-settings.md).

What a [layer](reference.md) or a [profile](profiles.md) that names another provider keeps of the provider settings it inherits is in [provider settings across layers](provider-settings-across-layers.md).

Each provider bills an account, whose key opens its runs and whose billing the [budgets](../budget/budget.md) read: `openrouter`, or `runpod` for both Runpod providers.

## `openrouter`

The default. It accepts no setting beside `model`.

- **Model ID:** OpenRouter's, such as `deepseek/deepseek-v4.1-flash`.
- **Secrets:** `CODEMAN_OPENROUTER_MANAGEMENT_KEY`, in the key jobs.
- **Cost:** what the run's key used, exact, from OpenRouter.

## `runpod-pod`

A pod Codeman creates on Runpod's Secure Cloud, shared by the organization's tasks with the same pod settings ([pods](../inference/pods.md)).

| Setting | Default | Meaning |
| --- | --- | --- |
| `gpu` | none; required | The pod's GPU type, by Runpod's GPU ID (not its display name), such as `"NVIDIA RTX A6000"` (quoted or not in the file; `/codeman set gpu` takes the rest of its line) |
| `pod-reuse` | `task` | `task`: a pod is kept after a run for the next run on its settings, of any task; `run`: a pod ends with its runs |
| `engine` | `ollama` | What serves the model; `ollama` is the only engine on pods so far |

- **Model ID:** Ollama's, such as `qwen3-coder:30b`.
- **Secrets:** `CODEMAN_RUNPOD_API_KEY`, in the key jobs.
- **Cost:** the pod's time at its price, split among the runs on it ([spend](../budget/spend.md#self-hosted-runs)).

## `runpod-serverless`

The workers of a Serverless endpoint a maintainer created, running Runpod's vLLM worker ([Serverless](../inference/serverless.md)). An endpoint's GPU types are set on the endpoint, so it takes no `gpu`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `endpoint` | none; required | The endpoint's ID, or a URL of it from Runpod's console (`https://api.runpod.ai/v2/<id>/...`), whose path gives the ID. A URL on any other host, or not on HTTPS, is an error, since the endpoint's key goes there |
| `engine` | `vllm` | What serves the model; `vllm` is the only engine on Serverless |

- **Model ID:** what the worker serves, its Hugging Face ID, such as `Qwen/Qwen3-Coder-30B-A3B-Instruct`.
- **Secrets:** `CODEMAN_RUNPOD_API_KEY`, in the key jobs; `CODEMAN_RUNPOD_SERVERLESS_KEY`, the endpoint's key, in the agent job.
- **Cost:** an estimate of the time Runpod bills the endpoint's worker for the run, split with the runs that used it at the same times ([Serverless](../inference/serverless.md)).
