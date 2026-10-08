# Self-hosted inference

With `provider: runpod-pod` or `provider: runpod-serverless` ([providers](../settings/providers.md)), a task's agents use a model that Codeman serves on GPUs rented from Runpod, instead of OpenRouter. The choice was made in the [self-hosted inference plan](../plans/2026-10-02-self-hosted-inference.md), which records its decisions. Runpod charges per second of GPU, whether or not the agent is generating, so a run's cost is time, not tokens.

| Provider | GPU | Engine | Billed | Start |
| --- | --- | --- | --- | --- |
| `runpod-pod` | A pod Codeman creates, with the task's `gpu`, on Secure Cloud | Ollama, in Codeman's pod image | Every second the pod exists, from its creation | Minutes, unless the task's pod was kept |
| `runpod-serverless` | The workers of an endpoint a maintainer created ([installation](../installation/runpod.md)) | Runpod's vLLM worker | Every second a worker runs, its model's load and idle timeout included | Minutes, while vLLM prepares the model, unless a worker is still up; a run with no worker for 25 minutes fails |

## Choosing

What Codeman's tests on Runpod showed (step 8 of the plan):

- **OpenRouter** bills tokens only: nothing for starts or for the time the agent spends running tools. For a task at a time, it gives the most for the money and time, with the strongest models.
- **A pod** bills its whole life, used or not, but not per token: long contexts and many requests cost the same. It pays off when a smaller model does the work and runs follow each other, since a pod is kept between runs. The organization's tasks on the same pod settings share one pod, at once or one after another, and split its cost by the second ([shared pods](pods.md#shared-pods)): one task's tool runs leave the GPU to another's requests, and one repository's next run finds the pod another kept.
- **Serverless** bills each worker's start (minutes, compilation included), its requests and the idle timeout after its last one, at the flex price. It cost the most: US$ 1.96 for three runs of a task, against US$ 1.90 for a four-run task on a pod, though twice as fast on its GPUs. It pays off only when its worker stays busy, such as one endpoint serving several repositories at once (a worker takes several requests at once), so that starts and idle time are shared; never for a single task. Each run counts the worker time it used, and time it shared with other runs, of any of the organization's repositories, is split among them ([Serverless](serverless.md)).

[Profiles](../settings/profiles.md) combine them in one task, such as OpenRouter for planning and a pod for the stages whose runs follow each other.

## Layers

| Interface | Covers | Implementations |
| --- | --- | --- |
| `InferenceProvider` ([`src/inference/provider.ts`](../../src/inference/provider.ts)) | What the key jobs use: opening a run with a limit (a handle, a credential, an API) and closing it (its usage, and what the task's other runs and pods cost, when the provider can tell). | OpenRouter; pods and Serverless ([`selfhosted.ts`](../../src/inference/selfhosted.ts)) |
| `GpuProvider` ([`gpu.ts`](../../src/inference/gpu.ts)) | Pods (price, create, get, list, terminate, URL, billing) and Serverless endpoints (settings, price, job queue URL), and the account's billing by the hour. | Runpod's REST API v2 ([`runpod.ts`](../../src/inference/runpod.ts)) |
| `InferenceEngine` ([`engine.ts`](../../src/inference/engine.ts)) | Model names and usage from responses. | Ollama, vLLM |
| Gateway ([`src/gateway/`](../../src/gateway/)) | In front of the engine: the runs' tokens, forwarding, a record per request, each run's budget limit and share of a pod, and usage in OpenRouter's terms. | One program, in the pod or in the agent job |

## The gateway

- It serves several runs at once, one per task (on a pod, per seat: [shared pods](pods.md#shared-pods)): a pod serves the tasks that share it, and a Serverless agent job's gateway its one run. Each run's token, random, reaches its agent encrypted, like an OpenRouter key; the gateway keeps only its hash, and a token opens only its own run, with its own records and limit. A task's new run replaces its last one (a run that names no task, as Serverless runs and Codeman before shared pods start them, replaces every run), and ending a run revokes its token and leaves the others.
- Only `POST /v1/chat/completions`, `POST /v1/completions` and `GET /v1/models` reach the engine. Streamed requests ask the engine for usage in their last chunk.
- It records each request's input and output tokens (as the engine reports them; cached prompt tokens are input), when its response began, and when it ended. A run's usage is reported like OpenRouter's: tokens, requests, the largest request's input tokens (the context length), and mean completion tokens per second over streamed requests, from the first token to the end (a plain response arrives whole).
- It stops serving a run, with `402`, once the run's cost reaches its limit: for a pod, its share of the pod's time since it started, at the pod's price (each second split evenly among the runs on the pod; alone, the whole time, so its deadline is known in advance); for Serverless, the estimated time a worker was billed for the run.
- `GET /usage` and the `/admin/` routes, which start, end and release runs and report the gateway's state (with its API `version`: 2 serves several runs; an older gateway reports none), take an admin token: an HMAC of the GPU account key and a nonce in the pod's environment, which also holds the token's hash. Only the jobs with the account key manage pods, and no token is stored anywhere.
- A pod's gateway is public, through Runpod's proxy, which drops a request that gets no response within 100 seconds. The gateway answers a streamed request at once, and sends SSE comments while the engine is silent. Ollama listens only on the pod's loopback.
