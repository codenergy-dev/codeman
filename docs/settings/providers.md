# Providers

`provider` chooses where an [agent run's](../glossary.md#agent-run) model is served. This page lists the [inference providers](../glossary.md#inference-provider) and the settings each one accepts.

## At a glance

| Provider | Serves the model with | Settings besides `model` | Model ID | Account |
| --- | --- | --- | --- | --- |
| `openrouter` (the default) | OpenRouter | None | OpenRouter's | `openrouter` |
| `runpod-pod` | A [pod](../glossary.md#pod) Codeman creates on Runpod, running Ollama or vLLM | `gpu` (required), `pod-reuse`, `hosts`, `priority`, `engine`, `ollama`, `vllm` | Ollama's, or a Hugging Face ID with vLLM | `runpod` |
| `runpod-serverless` | A Serverless endpoint a maintainer created, running Runpod's vLLM worker | `endpoint` (required), `engine` | A Hugging Face ID | `runpod` |
| `salad-pod` | A pod Codeman creates on Salad, a one-replica container group, running Ollama or vLLM | `gpu` (required), `pod-reuse`, `hosts`, `priority`, `engine`, `ollama`, `vllm` | Ollama's, or a Hugging Face ID with vLLM | `salad` |

## How settings are checked

- Each provider accepts its own settings beside `model`, and some a block of settings for their [engine](../glossary.md#engine).
- A setting the provider does not accept, a value it does not offer, or a required setting it lacks stops the run. The error names the provider.
- A [top level](../glossary.md#top-level) without a `model` serves no run, so it is checked only for what its provider accepts ([profiles](profiles.md#checks)).
- What a [layer](reference.md#layers) or a [profile](profiles.md) that names another provider keeps of the provider settings it inherits is in [provider settings across layers](provider-settings-across-layers.md).

## Accounts

Each provider bills an account: `openrouter`, `runpod` for both Runpod providers, or `salad`. The account's key opens the provider's runs.

| Account | Key | Names beside the key | Billing the [budgets](../budget/budget.md) read |
| --- | --- | --- | --- |
| `openrouter` | `CODEMAN_OPENROUTER_MANAGEMENT_KEY` | None | Each key's usage, exact |
| `runpod` | `CODEMAN_RUNPOD_API_KEY` | None | The account's billing by the hour, which the organization's month reconciles |
| `salad` | `CODEMAN_SALAD_API_KEY` | The variables `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT` | None: Salad has no billing API, so its runs count their estimates ([spend](../budget/spend.md#self-hosted-runs)) |

## `openrouter`

The default. It accepts no setting beside `model`.

- **Model ID:** OpenRouter's, such as `deepseek/deepseek-v4.1-flash`.
- **Secrets:** `CODEMAN_OPENROUTER_MANAGEMENT_KEY`, in the [key jobs](../glossary.md#key-jobs).
- **Cost:** what the run's key used, exact, from OpenRouter.

## `runpod-pod`

A pod Codeman creates on Runpod, on Secure Cloud unless `hosts` allows Community Cloud, shared by the [pool's](../glossary.md#pool-of-organizations) tasks with the same [pod settings](../glossary.md#pod-settings), up to its [capacity](../glossary.md#capacity) ([pods](../inference/pods.md)).

| Setting | Default | Allowed values | Meaning |
| --- | --- | --- | --- |
| `gpu` | none; required | A Runpod GPU ID, not its display name, such as `"NVIDIA RTX A6000"` | The pod's GPU type. Quoted or not in the file; `/codeman set gpu` takes the rest of its line |
| `pod-reuse` | `task` | `task`, `run` | `task`: a pod is kept after a run for the next run on its settings, of any task. `run`: a pod ends with its runs |
| `hosts` | `secure` | A list of `secure` and `community`, each once, such as `[community, secure]` | The [kinds of host](#hosts) the pod may run on, by preference: `secure` is Secure Cloud, `community` Community Cloud. Set only in the settings files |
| `priority` | `on-demand` | `on-demand` | The pod's priority. Runpod's API offers no interruptible pods, so `on-demand` is the only one |
| `engine` | `ollama` | `ollama`, `vllm` | What serves the model. `vllm` batches requests whatever the model ([vLLM settings](vllm.md)). Naming another engine than the one inherited drops that engine's block ([the rule](provider-settings-across-layers.md#the-rule)) |
| `ollama` | none | The keys of [Ollama settings](ollama.md) | With `engine: ollama`, the pod's Ollama settings: a block of keys, each one of the server's variables, such as `num-parallel: 4` for `OLLAMA_NUM_PARALLEL=4` |
| `vllm` | none | The keys of [vLLM settings](vllm.md); `tool-call-parser` is required | With `engine: vllm`, the pod's vLLM settings: a block of keys, each one of `vllm serve`'s arguments, such as `max-num-seqs: 4` for `--max-num-seqs 4` |

Without an `ollama` block, or without `vllm` keys beside `tool-call-parser`, a pod serves as many requests at once as its profile's tasks, with the largest context that fits its GPU.

The model ID depends on the engine:

| Engine | Model ID | Example |
| --- | --- | --- |
| Ollama | Ollama's name | `qwen3-coder:30b` |
| vLLM | A Hugging Face ID, `namespace/name`, of a public model, not gated, with safetensors weights | `unsloth/Qwen3.8-27B-NVFP4` |

- **Secrets:** `CODEMAN_RUNPOD_API_KEY`, in the key jobs.
- **Cost:** the pod's time at its price, split among the runs on it ([spend](../budget/spend.md#self-hosted-runs)).
- **Pod image:** Codeman picks it by `engine`, one per engine ([vLLM settings](vllm.md#pod-images)). Ollama settings, and fitting the model to the GPU, need an image whose gateway does both. A run with Ollama settings on an image that cannot stops before any pod is created ([Ollama settings](ollama.md#pod-images)).

## `runpod-serverless`

The workers of a Serverless endpoint a maintainer created, running Runpod's vLLM worker ([Serverless](../inference/serverless.md)). An endpoint's GPU types are set on the endpoint, so it takes no `gpu`.

| Setting | Default | Allowed values | Meaning |
| --- | --- | --- | --- |
| `endpoint` | none; required | An ID of 1 to 64 letters and digits, or a URL of the endpoint from Runpod's console, `https://api.runpod.ai/v2/<id>/...` | The endpoint. A URL's path gives the ID. A URL on any other host, or not on HTTPS, is an error, since the endpoint's key goes there |
| `engine` | `vllm` | `vllm` | What serves the model. `vllm` is the only engine on Serverless |

- **Model ID:** what the worker serves, its Hugging Face ID, such as `Qwen/Qwen3-Coder-30B-A3B-Instruct`.
- **Secrets:** `CODEMAN_RUNPOD_API_KEY`, in the key jobs; `CODEMAN_RUNPOD_SERVERLESS_KEY`, the endpoint's key, in the agent job.
- **Cost:** an estimate of the time Runpod bills the endpoint's worker for the run, split with the runs that used it at the same times ([Serverless](../inference/serverless.md)).

## `salad-pod`

A pod Codeman creates on Salad: a container group of one replica, shared by the pool's tasks with the same pod settings, up to its capacity, as on Runpod ([pods](../inference/pods.md)). Salad's on-demand GPU classes all run on Community hosts, so a run needs `hosts` to allow `community` ([installation](../installation/salad.md)).

| Setting | Default | Allowed values | Meaning |
| --- | --- | --- | --- |
| `gpu` | none; required | A Salad GPU class name, such as `"RTX 4090 (24 GB)"`, in any case | The pod's GPU class, from [Salad's pricing](https://salad.com/pricing/). Quoted or not in the file; `/codeman set gpu` takes the rest of its line |
| `pod-reuse` | `task` | `task`, `run` | As on `runpod-pod` |
| `hosts` | `secure` | A list of `secure` and `community`, each once | The [kinds of host](#hosts) the pod may run on. A GPU class of a kind the list lacks is refused before any group is created. Set only in the settings files |
| `priority` | `high` | `high`, `medium`, `low`, `batch` | The container group's [priority](#priority), which sets its price |
| `engine` | `ollama` | `ollama`, `vllm` | What serves the model, as on `runpod-pod`. Salad cannot pick hosts by CUDA version, so a vLLM pod checks its host's driver when it starts ([CUDA](vllm.md#cuda)) |
| `ollama` | none | The keys of [Ollama settings](ollama.md) | As on `runpod-pod` |
| `vllm` | none | The keys of [vLLM settings](vllm.md); `tool-call-parser` is required | As on `runpod-pod` |

The model ID depends on the engine, as on `runpod-pod`.

- **Secrets:** `CODEMAN_SALAD_API_KEY`, in the key jobs. The key is its user's, and reaches every organization and project the user belongs to.
- **Variables:** `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT`, in the key jobs: where Codeman creates its container groups.
- **Cost:** an estimate: the pod's time at the listed price of its GPU class and priority, the image's download included, which Salad does not bill. It is split among the runs on the pod as on Runpod, and never reconciled, since Salad has no billing API ([spend](../budget/spend.md#self-hosted-runs)).
- **Pod image:** Codeman's, by `engine`, as on `runpod-pod`. A run on an image whose gateway cannot serve on Salad stops before any group is created ([pod images](../development/guide.md#pod-images)).

## Hosts

`hosts` lists the kinds of host a pod may run on, by preference. The list's order matters, so `[community, secure]` prefers the cheaper hosts and `[secure, community]` the safer ones.

| Kind | On `runpod-pod` | On `salad-pod` |
| --- | --- | --- |
| `secure` | Secure Cloud: Runpod's certified data centers | The GPU classes of type `secure`: Salad Dedicated's, reserved by contract |
| `community` | Community Cloud: machines third parties run | The GPU classes of type `community`: consumer PCs that third parties run, all of Salad's on-demand GPUs |

- **Runpod** creates the pod on the first kind whose hosts offer the GPU and have room. With one kind, it creates the pod there without asking.
- **Salad** gives each GPU class one kind, so `hosts` allows or refuses the class `gpu` names.
- Only the settings files set it, the organization's and the repository's, at the top level or in a profile. A `/codeman set hosts` is refused, and no workflow input takes it, so a task cannot send a repository's code to other machines ([risks](../security/risks.md#self-hosted-inference)).

> [!WARNING]
> On `community` hosts, the repository's code, issues and the agent's requests are decrypted on machines that third parties own. Allow them only for repositories whose code may go there.

## Priority

| Provider | Values, highest first | Default | Below the highest |
| --- | --- | --- | --- |
| `runpod-pod` | `on-demand` | `on-demand` | None |
| `salad-pod` | `high`, `medium`, `low`, `batch` | `high` | Cheaper, but a higher-priority workload may take the pod's node |

A pod that loses its node, to a higher priority or because the machine went offline, fails its tasks as a pod that failed does. Salad may start a replacement on another node, which starts empty: it is past its start limit, so it exits at once.

## How it works

The registry in [`src/inference/providers.ts`](../../src/inference/providers.ts) holds the providers and their accounts: a new provider is a new entry. The choices were made in the [provider settings plan](../plans/2026-10-08-provider-settings.md), and those of `salad-pod`, `hosts` and `priority` in the [plan for Salad pods](../plans/2026-10-29-add-salad-pods.md).
