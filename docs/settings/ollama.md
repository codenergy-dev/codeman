# Ollama settings

With `provider: runpod-pod` and its engine `ollama`, an `ollama:` block tunes the pod's Ollama server: each key becomes one of the server's environment variables, such as `num-parallel: 4` for `OLLAMA_NUM_PARALLEL=4`. The choices were made in the [Ollama settings plan](../plans/2026-10-08-ollama-settings.md).

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
| `context-length` | `OLLAMA_CONTEXT_LENGTH` | Whole number, at least 1 | 4k, 32k or 256k tokens, by the GPU's memory; without the key, Codeman sets the model's own | The context length of each request, which the agent is told |
| `num-parallel` | `OLLAMA_NUM_PARALLEL` | Whole number, at least 1 | 1 | How many requests the model processes at once; the others queue |
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
3. **The pod.** Codeman creates it with `CODEMAN_OLLAMA`, the variables as JSON, such as `{"OLLAMA_NUM_PARALLEL":"4"}`. The gateway checks them against the same list, gives them to Ollama, with its own `OLLAMA_HOST` and `OLLAMA_KEEP_ALIVE` on top, logs them ("Ollama settings: OLLAMA_NUM_PARALLEL=4."), and reports them in its status. A pod whose `CODEMAN_OLLAMA` it cannot read terminates itself, saying why.
4. **The context length.** With `context-length`, Ollama keeps it, rather than restarting with the model's own, and it is the context length `open-key` reports and the agent is told.

## Memory

Ollama's K/V cache grows with `num-parallel` × `context-length` ([FAQ](../web/ollama/faq.md#how-does-ollama-handle-concurrent-requests)), beside the model. Four parallel requests at a model's full context length may not fit the GPU: Ollama then offloads part of the model to the CPU, which is much slower, or fails to load it. Set a smaller `context-length` with `num-parallel`, or `kv-cache-type: q8_0`, and check Ollama's log in the pod's logs; the [plan's end-to-end test](../plans/2026-10-08-ollama-settings.md#end-to-end-test) starts with 65536 for four requests.

## Pod images

Applying the settings needs a pod image whose gateway reads `CODEMAN_OLLAMA`, built from Codeman's code since Ollama settings. A requested setting is never dropped:

- **Images known not to apply them** are listed in `IMAGES_WITHOUT_OLLAMA_SETTINGS` in [`src/inference/ollama.ts`](../../src/inference/ollama.ts): the image pinned before shared pods and the one pinned before Ollama settings. A run with Ollama settings on one of them stops in `open-key` before any pod is created: "The pod image `<image>` cannot apply Ollama settings (`OLLAMA_NUM_PARALLEL=4`), so no pod was created: use a version of Codeman whose pod image can, or remove `ollama` from the settings." Runs without Ollama settings are unchanged on them.
- **Any other image**, such as one of the `pod-image` input, must report the settings it applied: a pod whose gateway does not report exactly the requested variables fails the run like a pod that did not serve its model ("Pod `<id>`'s gateway did not apply the Ollama settings (…): its image cannot."), and is terminated when the task created it.

## Adding a key

A key is added to `OLLAMA_SETTINGS`, this table and its test together, after checking it in the source of the Ollama version the pod image pins, recorded in [`docs/web/ollama/`](../web/ollama/). Upgrading Ollama means checking the list against the new version's source.
