# Ollama settings

With `provider: runpod-pod` and its engine `ollama`, an `ollama:` block tunes the pod's Ollama server: each key becomes one of the server's environment variables, such as `num-parallel: 4` for `OLLAMA_NUM_PARALLEL=4`. Without the block, a pod still serves as many requests at once as its profile's tasks, with the largest context that fits its GPU, and its model always runs wholly on the GPU. The choices were made in the [Ollama settings plan](../plans/2026-10-08-ollama-settings.md) and the [plan for fitting Ollama to the GPU](../plans/2026-10-13-fit-ollama-to-the-gpu.md).

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX PRO 6000 Blackwell Server Edition"
ollama:
  num-parallel: 4          # OLLAMA_NUM_PARALLEL=4: four requests at once
  context-length: 65536    # OLLAMA_CONTEXT_LENGTH=65536, instead of the model's own
```

The block goes at the top level or in a [profile](profiles.md), on indented lines; `ollama: { num-parallel: 4 }` is outside the settings' YAML subset, and its error says so.

## Accepted keys

Only these keys, taken from the server of Ollama 0.35.1, the version in Codeman's pod image ([`envconfig/config.go` at v0.35.1](../web/ollama/envconfig-config-go-at-v0-35-1.md), and the [FAQ](../web/ollama/faq.md)). `src/inference/ollama.test.ts` checks this table against `OLLAMA_SETTINGS` in [`src/inference/ollama.ts`](../../src/inference/ollama.ts).

| Key | Variable | Value | Ollama's default | Meaning |
| --- | --- | --- | --- | --- |
| `context-length` | `OLLAMA_CONTEXT_LENGTH` | Whole number, at least 1 | 4k, 32k or 256k tokens, by the GPU's memory; without the key, Codeman computes the largest that fits the GPU ([memory](#memory)) | The context length of each request, which the agent is told |
| `num-parallel` | `OLLAMA_NUM_PARALLEL` | Whole number, at least 1 | 1; without the key, Codeman sets the most tasks the profile serves ([parallel requests](#parallel-requests)) | How many requests the model processes at once; the others queue |
| `max-queue` | `OLLAMA_MAX_QUEUE` | Whole number, at least 1 | 512 | How many requests wait while it is busy, before it answers 503 |
| `flash-attention` | `OLLAMA_FLASH_ATTENTION` | `true` or `false` | On when the backend and GPU support it | Forces Flash Attention on or off; it reduces memory as the context grows |
| `kv-cache-type` | `OLLAMA_KV_CACHE_TYPE` | `f16`, `q8_0` or `q4_0` | `f16` | The K/V cache's quantization: `q8_0` uses about half the memory of `f16`, `q4_0` a quarter, with some loss of precision; it needs Flash Attention |
| `gpu-overhead` | `OLLAMA_GPU_OVERHEAD` | Whole number, at least 0 | 0 | Bytes of each GPU's memory that Ollama leaves free |
| `sched-spread` | `OLLAMA_SCHED_SPREAD` | `true` or `false` | `false` | Spreads the model over all the pod's GPUs, even when one would hold it |
| `load-timeout` | `OLLAMA_LOAD_TIMEOUT` | A duration, such as `10m` or `1h30m`, or whole seconds | `5m` | How long a model's load may stall before Ollama gives up |

## Refused keys

Codeman controls these, so setting them stops the run with the reason:

| Key | Variable | Why |
| --- | --- | --- |
| `host` | `OLLAMA_HOST` | Codeman runs Ollama on the pod's loopback, where only its gateway reaches it |
| `origins` | `OLLAMA_ORIGINS` | Only Codeman's gateway calls Ollama, from the pod's loopback |
| `keep-alive` | `OLLAMA_KEEP_ALIVE` | Codeman keeps the model loaded for as long as the pod lives |
| `models` | `OLLAMA_MODELS` | Codeman pulls the model where the pod image keeps models, on the disk it sizes for it |
| `remotes` | `OLLAMA_REMOTES` | Remote models would send the runs' requests off the pod |
| `debug-log-requests` | `OLLAMA_DEBUG_LOG_REQUESTS` | It writes the runs' requests, with the repository's code in them, to the pod's disk |

## Errors

Ollama ignores a variable it does not know, so Codeman checks each key and value and stops the run, naming the line, before any pod is created:

- **An unknown key**, a typo or another of Ollama's variables: "`ollama` does not accept `num-paralel`; it takes `context-length`, `num-parallel`, … and `load-timeout` (docs/settings/ollama.md)."
- **A key written as the variable**: "`ollama` takes its keys in kebab-case, without `OLLAMA_`: write `num-parallel`, not `OLLAMA_NUM_PARALLEL`." The same for `num_parallel`.
- **A refused key**: "`ollama` cannot set `host`: Codeman runs Ollama on the pod's loopback, where only its gateway reaches it."
- **A value of the wrong type**: "`ollama`'s `num-parallel` must be a whole number, at least 1."
- **Another provider**: "`runpod-serverless` does not accept `ollama`; besides `model`, it takes `engine` and `endpoint`."

## How they apply

1. **Layers.** Each key is inherited like a provider setting: a layer or profile on the same provider keeps the keys it inherits and replaces those it sets, so an organization's `num-parallel` and a profile's `context-length` both apply. A layer or profile that names another provider drops the whole block ([provider settings across layers](provider-settings-across-layers.md)). No `/codeman set` or workflow input sets them.
2. **Pods.** The settings are part of the pod's settings, so tasks with different Ollama settings never share a pod ([pods](../inference/pods.md)); pods without them keep the settings they had.
3. **The pod.** Codeman creates it with `CODEMAN_OLLAMA`, the variables as JSON, such as `{"OLLAMA_NUM_PARALLEL":"4"}`, the derived `num-parallel` included. The gateway checks them against the same list, gives them to Ollama, with its own `OLLAMA_HOST` and `OLLAMA_KEEP_ALIVE` on top, logs them ("Ollama settings: OLLAMA_NUM_PARALLEL=4."), and reports them in its status. A pod whose `CODEMAN_OLLAMA` it cannot read terminates itself, saying why.
4. **The context length.** With `context-length`, Ollama keeps it, and the gateway only checks that the model fits the GPU with it. Without it, the gateway computes one ([memory](#memory)). Either is the context length `open-key` reports and the agent is told, so OpenCode compacts the conversation before it reaches it.

## Parallel requests

Without `num-parallel`, a pod's Ollama serves as many requests at once as the most tasks its profile serves in a run, so the tasks that share the pod do not wait for each other's requests:

| The profile has | `num-parallel` |
| --- | --- |
| `tasks: N` | N |
| `max-tasks: M`, with or without `min-tasks` | M |
| `min-tasks` alone, or no count | The run's cap: the largest `tasks` or `max-tasks` of the profiles, or 10 when a profile has `min-tasks` alone ([how many tasks a run takes](profiles.md#how-many-tasks-a-run-takes)) |
| No profile applies | The run's cap; 1 when no profile has a count |

- An explicit `num-parallel` wins. Like it, the derived value is part of the pod's settings, so a profile of 4 tasks and one of 3 never share a pod.
- More requests than that, such as those of another repository's tasks on the same pod, wait in Ollama's queue (`max-queue`), without error.
- Ollama 0.35.1 serves some model families one request at a time, whatever `num-parallel` says: `qwen35`, `qwen35moe`, `qwen3next`, `qwen3vl`, `qwen3vlmoe`, `mllama`, `lfm2`, `lfm2moe`, `nemotron_h`, `nemotron_h_moe` and `nemotron_h_omni` ([server/sched.go](../web/ollama/server-sched-go-at-v0-35-1.md#parallel-requests); `OLLAMA_SERIAL_FAMILIES` in [`src/inference/ollama.ts`](../../src/inference/ollama.ts)). The gateway fits such a model for one request, and `open-key` warns that the runs on the pod wait for each other's requests.

## Memory

Ollama's K/V cache grows with `num-parallel` × `context-length` ([FAQ](../web/ollama/faq.md#how-does-ollama-handle-concurrent-requests)), beside the model. When they do not fit the GPU, Ollama does not fail: it puts part of the model on the CPU, which runs much slower ([server/sched.go](../web/ollama/server-sched-go-at-v0-35-1.md#loading), [common/fit.cpp](../web/llama-cpp/common-fit-cpp-at-b11232.md)). So the pod's gateway checks every load, and computes the context when the settings give none ([`src/gateway/fit.ts`](../../src/gateway/fit.ts)).

- **The check.** After loading the model, the gateway reads `GET /api/ps`: a model wholly on the GPU has `size_vram` equal to `size` ([list running models](../web/ollama/list-running-models.md)). The pod serves only such a model; otherwise its start fails, with an explicit `context-length` too: "`qwen3-coder:30b` does not fit the GPU with 4 parallel requests and a context of 262144 tokens: Ollama put 3.2 of its 122.9 GB off the GPU, which runs much slower. Lower `context-length` or `num-parallel` in the `ollama` settings, set `kv-cache-type: q8_0`, or use a GPU with more memory."
- **The margin.** llama.cpp, which Ollama runs, leaves 1024 MiB of each GPU free when it decides what goes on it ([common/common.h](../web/llama-cpp/common-common-h-at-b11232.md)), so a model wholly on the GPU leaves that much for what grows while it runs.
- **The computed context.** Without `context-length`, the gateway tries contexts from 64000 tokens, which Ollama's docs recommend at least for agents and coding tools ([context length](../web/ollama/context-length.md)), up to the model's own, in multiples of 4096; when `/api/show` gives no context of the model's own, it tries 64000 only. It starts with the cached context of the same settings; else with an estimate: the GPU type's memory, as Runpod's API gives it, less the model's size on disk, the margin and `gpu-overhead`, divided by the K/V cache of one token (from `/api/show`'s layers, K/V heads, key and value lengths, and `kv-cache-type`) times the parallel requests; else, when it cannot estimate, as for a model with a sliding window, a field missing from `/api/show` or an unknown GPU memory, with the model's own context. When that start fits, it is served; otherwise the gateway halves the range below it until it finds the largest that fits. Each try restarts Ollama with the context and loads the model, about 8 loads at most.
- **The floor.** A model without 64000 tokens of its own gets its own. When even the floor does not fit, the pod's start fails: "`qwen3-coder:30b` does not fit the GPU with 10 parallel requests and a context of 64000 tokens, the least Codeman gives an agent: Ollama put 3.2 of its 43.6 GB off the GPU, which runs much slower. Give the profile fewer tasks (`tasks` or `max-tasks`) or set a smaller `num-parallel`, set `kv-cache-type: q8_0` in the `ollama` settings, or use a GPU with more memory."
- **The cache.** The task that creates a pod reads the context that fitted the same image, model, GPU type and Ollama settings before, from the [backend](../backend/data-layout.md), and gives it to the pod with its model's digest; the gateway uses it only for the same digest, and checks it like any other. After a search, the same task records what the pod found. A cached context that no longer fits is searched again, and replaced.
- **What the run shows.** The gateway logs each load ("Loaded qwen3-coder:30b with 4 parallel request(s) and a context of 131072 tokens: wholly on the GPU."), and `open-key` the result: "Pod … serves qwen3-coder:30b with 4 parallel request(s) and a context of 131072 tokens (the model's own is 262144), wholly on the GPU; found in 5 load(s)." A start that fails stops the run with the gateway's message, in `open-key`'s log; the pod is terminated, and the tasks waiting for it do not try another.

To serve a larger context, lower `num-parallel`, set `kv-cache-type: q8_0` (half the cache's memory, with some loss of precision), or use a GPU with more memory.

## Pod images

Applying the settings, and fitting the model to the GPU, need a pod image whose gateway does both, built from Codeman's code since the [plan for fitting Ollama to the GPU](../plans/2026-10-13-fit-ollama-to-the-gpu.md). The Ollama image is the `ollama` entry of `POD_IMAGES` ([pod images](vllm.md#pod-images)), or the `pod-image` input's. A requested setting is never dropped:

- **Images known not to apply them** are listed in `IMAGES_WITHOUT_OLLAMA_SETTINGS` in [`src/inference/ollama.ts`](../../src/inference/ollama.ts): the image pinned before shared pods and the one pinned before Ollama settings. A run with Ollama settings on one of them stops in `open-key` before any pod is created: "The pod image `<image>` cannot apply Ollama settings (`OLLAMA_NUM_PARALLEL=4`), so no pod was created: use a version of Codeman whose pod image can, or remove `ollama` from the settings." A run without them serves as before: no derived `num-parallel`, the model's own context length, no check of the GPU, and the pod's settings key it had; `open-key` says so in its log.
- **Any other image**, such as one of the `pod-image` input, must report the settings it applied and how the model fits the GPU: a pod whose gateway does not report exactly the requested variables, or no fit, fails the run like a pod that did not serve its model ("Pod `<id>`'s gateway did not apply the Ollama settings (…): its image cannot.", "Pod `<id>`'s gateway did not report how … fits the GPU: its image cannot check it."), and is terminated when the task created it.

## Adding a key

A key is added to `OLLAMA_SETTINGS`, this table and its test together, after checking it in the source of the Ollama version the pod image pins, recorded in [`docs/web/ollama/`](../web/ollama/). Upgrading Ollama means checking the list against the new version's source.
