# vLLM settings

With `provider: runpod-pod` and `engine: vllm`, a pod serves a Hugging Face model with vLLM, which batches the requests of the tasks that share the pod whatever the model, where Ollama serves some families one request at a time ([Ollama settings](ollama.md#parallel-requests)). A `vllm:` block tunes it: each key becomes one of `vllm serve`'s arguments, such as `max-num-seqs: 4` for `--max-num-seqs 4`. The block needs `tool-call-parser`; without the other keys, a pod serves as many requests at once as its profile's tasks, with the largest context that fits its GPU for them, wholly on the GPU, or its start fails saying what to change. The choices were made in the [plan for vLLM on pods](../plans/2026-10-13-vllm-on-pods.md).

```yaml
provider: runpod-pod
engine: vllm
model: unsloth/Qwen3.8-27B-NVFP4      # a Hugging Face ID
gpu: "NVIDIA RTX PRO 6000 Blackwell Server Edition"
vllm:
  tool-call-parser: qwen3_xml         # --tool-call-parser qwen3_xml; required
  reasoning-parser: qwen3
  kv-cache-dtype: fp8                 # half the K/V cache's memory
  speculative-method: mtp             # with speculative-tokens: --speculative-config
  speculative-tokens: 3
  language-model-only: true           # skips the vision tower, leaving its memory to the cache
```

The block goes at the top level or in a [profile](profiles.md), on indented lines, like `ollama:`.

## Accepted keys

Only these keys, taken from `vllm serve` of vLLM 0.31.0, the version in Codeman's vLLM pod image ([arg_utils.py](../web/vllm/vllm-engine-arg-utils-py-at-v0-31-0.md), [cli_args.py](../web/vllm/vllm-entrypoints-launchers-cli-args-py-at-v0-31-0.md), [cache.py](../web/vllm/vllm-config-cache-py-at-v0-31-0.md), [speculative.py](../web/vllm/vllm-config-speculative-py-at-v0-31-0.md)). `src/inference/vllm.test.ts` checks this table against `VLLM_SETTINGS` in [`src/inference/vllm.ts`](../../src/inference/vllm.ts).

| Key | Argument | Value | vLLM's default | Without the key |
| --- | --- | --- | --- | --- |
| `max-model-len` | `--max-model-len` | Whole number, at least 1 | The model's own | The largest that fits the GPU for `max-num-seqs` requests ([memory](#memory)) |
| `max-num-seqs` | `--max-num-seqs` | Whole number, at least 1 | 256 or 1024, by the GPU's memory | The most tasks the profile serves ([parallel requests](#parallel-requests)) |
| `gpu-memory-utilization` | `--gpu-memory-utilization` | Number above 0, at most 1 | 0.92 | vLLM's: the share of the GPU's memory it may use |
| `kv-cache-dtype` | `--kv-cache-dtype` | `auto`, `bfloat16`, `float16`, `fp8`, `fp8_e4m3` or `fp8_e5m2` | `auto`, the model's | vLLM's; `fp8` halves the cache's memory ([quantized K/V cache](../web/vllm/quantized-kv-cache.md)) |
| `enable-prefix-caching` | `--enable-prefix-caching` | `true` or `false` | `true` | vLLM's: reuses the cache of a prompt's prefix across requests |
| `max-num-batched-tokens` | `--max-num-batched-tokens` | Whole number, at least 1 | 2048 to 16384, by the GPU's memory | vLLM's |
| `tool-call-parser` | `--tool-call-parser` | One of vLLM 0.31.0's tool call parsers | None | Required ([tool calls](#tool-calls)) |
| `reasoning-parser` | `--reasoning-parser` | One of vLLM 0.31.0's reasoning parsers | None | None: the model's reasoning stays in its answer |
| `speculative-method` | `--speculative-config` | `mtp`, `ngram`, `eagle3`, `dflash`, `dspark` or `draft_model` | None | No speculative decoding |
| `speculative-tokens` | `--speculative-config` | Whole number, at least 1 | None | Required with `speculative-method` |
| `speculative-model` | `--speculative-config` | A Hugging Face model ID | None | Required with `eagle3`, `dflash`, `dspark` and `draft_model`, refused with `mtp` and `ngram` |
| `language-model-only` | `--language-model-only` | `true` or `false` | `false` | vLLM's; `true` skips a multimodal model's vision tower |
| `enforce-eager` | `--enforce-eager` | `true` or `false` | `false` | vLLM's ([starting](#starting)) |
| `async-scheduling` | `--async-scheduling` | `true` or `false` | Decided by vLLM | vLLM's |

- **Booleans** become `--key` or `--no-key`.
- **Speculative decoding.** The settings file holds no JSON, so the three `speculative-*` keys make one `--speculative-config`, such as `{"method":"mtp","num_speculative_tokens":3}`. `custom_class`, which loads code, is not offered. MTP needs its tokens given explicitly; vLLM's recipe for Qwen3.8-27B uses 3 ([MTP](../web/vllm/mtp-multi-token-prediction.md), [recipe](../web/vllm/models-qwen-qwen3-8-27b-yaml-at-d0f2838.md)).
- **Parsers.** `VLLM_TOOL_PARSERS` and `VLLM_REASONING_PARSERS` list those of vLLM 0.31.0 ([tool parsers](../web/vllm/vllm-tool-parsers-init-py-at-v0-31-0.md), [reasoning parsers](../web/vllm/vllm-reasoning-init-py-at-v0-31-0.md)), checked against the recorded source by a test. For Qwen3 models, `qwen3_xml` (the same as `qwen3_coder`) and `qwen3`.

## Refused keys

Codeman controls these, so setting them stops the run with the reason. Every `ssl-*` argument is refused like `ssl-keyfile`.

| Key | Why |
| --- | --- |
| `host`, `port`, `uds`, `api-key`, `served-model-name`, `model` | Codeman serves the run's model on the pod's loopback, behind its gateway |
| `enable-auto-tool-choice` | Codeman always turns it on: its agents work through tool calls |
| `allowed-origins`, `ssl-keyfile`, `root-path` | Only Codeman's gateway calls vLLM, from the pod's loopback |
| `middleware`, `tool-parser-plugin`, `reasoning-parser-plugin`, `chat-template` | It loads code or files that Codeman does not ship in the pod image |
| `trust-remote-code` | It runs the model repository's code beside the runs' requests |
| `download-dir`, `load-format`, `hf-token` | Codeman has vLLM download public models from Hugging Face, onto the pod's disk |
| `tensor-parallel-size`, `pipeline-parallel-size`, `data-parallel-size` | A pod has one GPU |
| `cpu-offload-gb`, `kv-offloading-size`, `kv-offloading-backend` | It moves weights or the cache off the GPU, which runs much slower |
| `kv-transfer-config`, `kv-events-config`, `otlp-traces-endpoint` | It sends the runs' data, with the repository's code in it, off the pod |
| `enable-log-requests`, `enable-log-outputs` | It writes the runs' requests, with the repository's code in them, to the pod's log |

## Errors

Codeman checks each key and value, and the block as a whole once the layers are resolved, and stops the run, naming the line or the profile, before any pod is created:

- **An unknown key**: "`vllm` does not accept `max-num-seq`; it takes `max-model-len`, `max-num-seqs`, … and `async-scheduling` (docs/settings/vllm.md)."
- **A key written as the argument**: "`vllm` takes its keys in kebab-case, without `--`: write `max-num-seqs`, not `max_num_seqs`."
- **JSON's argument**: `speculative-config` says to write the three `speculative-*` keys.
- **A refused key**: "`vllm` cannot set `host`: Codeman serves the run's model on the pod's loopback, behind its gateway."
- **A value of the wrong type**: "`vllm`'s `tool-call-parser` must be one of vLLM 0.31.0's, such as `qwen3_xml`, not `qwen4` (docs/settings/vllm.md)."
- **Keys that do not go together**, in the whole block:
  - `speculative-tokens` or `speculative-model` without a method: "`vllm`'s `speculative-tokens` and `speculative-model` go with `speculative-method`."
  - A method without its tokens: "`vllm`'s `speculative-method` needs `speculative-tokens`, the tokens drafted per step, such as `3`."
  - `eagle3`, `dflash`, `dspark` or `draft_model` without a draft model: "`vllm`'s `speculative-method: eagle3` needs `speculative-model`, its draft model's Hugging Face ID."
  - `mtp` or `ngram` with one: "`vllm`'s `speculative-method: mtp` takes no `speculative-model`."
- **No parser**: "`vllm` needs `tool-call-parser`, the one that matches the model, such as `qwen3_xml` for Qwen3 models; see the model's card or vLLM's recipe for it (docs/settings/vllm.md)."
- **Not a Hugging Face ID**: "With `runpod-pod` and the engine `vllm`, `model` must be a Hugging Face model ID, `namespace/name`, such as `Qwen/Qwen3-Coder-30B-A3B-Instruct`, not `Qwen3-8B`."
- **Another engine or provider**: "With `runpod-pod`, `ollama` configures the engine `ollama`, not `vllm`."; "`runpod-serverless` does not accept `vllm`; …". Serverless endpoints keep their worker's own settings ([Serverless](../inference/serverless.md)).

## How they apply

1. **Layers.** Each key is inherited like a provider setting, as `ollama:`'s are: a layer or profile on the same provider and engine keeps the keys it inherits and replaces those it sets. A layer or profile that names another provider drops the block, and one that names another engine drops the other engine's block ([provider settings across layers](provider-settings-across-layers.md)). No `/codeman set` or workflow input sets them.
2. **Pods.** The engine and the settings, the derived `max-num-seqs` included, are part of the pod's settings, so tasks with different vLLM settings never share a pod ([pods](../inference/pods.md)).
3. **The pod.** Codeman creates it with `CODEMAN_ENGINE=vllm` and `CODEMAN_VLLM`, the settings as JSON by key, such as `{"max-num-seqs":"4","tool-call-parser":"qwen3_xml"}`. The gateway checks them against the same list, logs them ("vLLM settings: max-num-seqs=4, tool-call-parser=qwen3_xml."), and starts `vllm serve <model>` with them, on `127.0.0.1:8000`, `--served-model-name` the run's model, `--enable-auto-tool-choice`, and the context it serves ([memory](#memory)). vLLM's environment has `VLLM_NO_USAGE_STATS=1` and `DO_NOT_TRACK=1`, not the pod's Runpod key, and `CUDA_VISIBLE_DEVICES=0` when it held a MIG partition's UUID, on which vLLM 0.31.0 fails to start. A pod whose `CODEMAN_VLLM` it cannot read, or whose image serves another engine, terminates itself, saying why.
4. **The status.** The gateway reports the settings it applied (`vllm`) and how it served the model (`fit`); `open-key` requires both, exactly as requested, or fails the run like a pod that did not serve.

## Parallel requests

Without `max-num-seqs`, a pod's vLLM serves as many requests at once as the most tasks its profile serves in a run, by the same rules as Ollama's `num-parallel` ([parallel requests](ollama.md#parallel-requests)). An explicit `max-num-seqs` wins. vLLM batches them whatever the model's family; more requests than that wait in vLLM's queue, without error.

## Memory

At its start, vLLM sizes its K/V cache from the GPU's memory left after the model, within `gpu-memory-utilization`, and refuses to start, naming the largest context that would fit, when the cache cannot hold **one** request of `max-model-len` tokens. It never moves the model or its cache to the CPU unless told to, which Codeman refuses ([kv_cache_utils.py](../web/vllm/vllm-v1-core-kv-cache-utils-py-at-v0-31-0.md)). It then reports, on `/metrics`, the cache's tokens and how many requests of `max-model-len` it holds at once ([loggers.py](../web/vllm/vllm-v1-metrics-loggers-py-at-v0-31-0.md)), which the gateway reads, with the served context from `GET /v1/models` ([`src/gateway/vllm.ts`](../../src/gateway/vllm.ts)).

- **With `max-model-len`.** vLLM starts with it; a refusal fails the pod's start with vLLM's own message: "vLLM did not start `<model>` with a context of 262144 tokens: ValueError: To serve at least one request … Lower `max-model-len` in the `vllm` settings, set `kv-cache-dtype: fp8` or `language-model-only: true`, or use a GPU with more memory." When its cache holds fewer than `max-num-seqs` requests of it, the start fails too: "`<model>` does not fit the GPU with 3 parallel requests and a context of 262144 tokens: vLLM's K/V cache holds 1.91 of them (500000 tokens). Lower `max-model-len` or `max-num-seqs` …".
- **Without it.** The gateway starts vLLM with the cached context of the same settings, else with vLLM's auto-fit (`--max-model-len auto`), the largest context whose cache holds one request, up to the model's own. When the cache holds `max-num-seqs` requests of it, it serves. Otherwise it restarts vLLM with the largest multiple of 4096 tokens that the cache's tokens hold `max-num-seqs` times; and, should a hybrid model's fixed state per request leave it still short, once more, from the line through both measures. When the cache still holds fewer after those two restarts, the pod's start fails: "vLLM found no context of `<model>` for 4 parallel requests in 3 starts: with a context of 98304 tokens, vLLM's K/V cache holds 3.20 of them (314572 tokens). Set `max-model-len` in the `vllm` settings, give the profile fewer tasks, or use a GPU with more memory." So a fit takes at most 3 starts, or 4 when the cached context did not start. The context it serves is the one vLLM reports.
- **The floor.** 64000 tokens, as for Ollama, or the model's own when smaller; the model's own is known only from auto-fit's start. When the next context would be below the floor, or vLLM serves less than it, the pod's start fails: "`<model>` does not fit the GPU with 10 parallel requests and a context of 64000 tokens, the least Codeman gives an agent: with a context of 262144 tokens, vLLM's K/V cache holds 0.76 of them (200000 tokens). Give the profile fewer tasks (`tasks` or `max-tasks`) or set a smaller `max-num-seqs`, set `kv-cache-dtype: fp8` or `language-model-only: true` in the `vllm` settings, or use a GPU with more memory."
- **The cache.** The task that creates a pod reads the context that served the same image, model, GPU type and vLLM settings (but `max-model-len`) before, from the [backend](../backend/data-layout.md), and gives it to the pod (`CODEMAN_FIT`). The gateway starts vLLM with it, without auto-fit:
  1. When it starts and its cache holds `max-num-seqs` requests, it serves.
  2. When it starts but its cache holds fewer, the gateway restarts vLLM with smaller contexts, as after auto-fit. The model's own context stays unknown, so the floor is 64000 even for a model whose own is smaller, and `open-key`'s log leaves out "(the model's own is …)".
  3. When vLLM refuses it, the gateway fits again from auto-fit.

  After vLLM's measures, the same task records what the pod served. A new context compiles again, so a pod that starts from the cache saves the restarts' minutes.
- **What the run shows.** The gateway logs each start and what vLLM served ("vLLM serves `<model>` after 312 s, with a context of 131072 tokens: its K/V cache holds 4.50 requests of it (589824 tokens)."), and `open-key` the result: "Pod … serves `<model>` with vLLM, 4 parallel request(s) and a context of 131072 tokens (the model's own is 262144), wholly on the GPU: …; found in 2 start(s). Its tool calls work with the parser qwen3_xml." Its `context-length`, which the agent is told, is the context served.

## Tool calls

Codeman's agents work through tool calls, which vLLM returns only with `--enable-auto-tool-choice` and the parser that matches the model's format ([tool calling](../web/vllm/tool-calling.md)); vLLM does not pick one from the model. So `tool-call-parser` is required, and the gateway always turns tool calls on. Once vLLM serves, the gateway probes them: a chat request offering a `ping` tool and asking for it. Without a parsed tool call after two tries, the pod's start fails: "vLLM did not return a tool call with the parser `<parser>`: it may not match `<model>` (…). Set the `tool-call-parser` that the model's card or vLLM's recipe gives in the `vllm` settings." `reasoning-parser` is optional and not probed ([reasoning outputs](../web/vllm/reasoning-outputs.md)).

## The model

A pod's model is a Hugging Face ID, which vLLM downloads in the pod. Before creating a pod, `open-key` asks Hugging Face's API for it, without a token (`GET https://huggingface.co/api/models/<id>?blobs=true`, [hf_api.py](../web/hugging-face/src-huggingface-hub-hf-api-py-at-v2-2-0.md)), and stops the run, before paying for anything, when the model is missing or private ("Hugging Face has no public model `<id>`: check its ID, whose case counts. …"), gated, disabled, or has no safetensors weights. Gated and private models need a token, which Codeman does not hold. The weights' size, with a `speculative-model`'s, sets the pod's container disk: the weights with a quarter more, plus 40 GB for vLLM's image and caches, 80 GB at least. Joining a pod checks nothing.

## CUDA

vLLM 0.31.0's image is built with CUDA 13.0, and fails on a host whose driver is older (CUDA's error 804). So a vLLM pod is created with `minCudaVersion` 13.0 (`VLLM_MIN_CUDA`), and before creating it, `open-key` reads which CUDA versions the GPU type's hosts offer pods on Secure Cloud, and whether they have room ([get a GPU type](../web/runpod/get-a-gpu-type.md)). This check runs before the [model's](#the-model). The run stops, before paying for anything:

- **When no host of the GPU type offers CUDA 13.0 or newer**: "Runpod offers no host with `<gpu>` and CUDA 13.0 or newer, which vLLM's image needs, so no pod was created: use another GPU type, or `engine: ollama`."
- **When none of those hosts has room**: "No host with `<gpu>` and CUDA 13.0 or newer has room now (Runpod offers 13.0, 13.1), which vLLM's image needs, so no pod was created: try again later, or use another GPU type."

`open-key` logs the host's CUDA version once the pod runs. Ollama pods take any host.

## Pod images

Codeman picks a pod's image by its engine: one image per engine, built from the same Dockerfile and gateway, published as `ghcr.io/codenergy-dev/codeman-ollama` and `ghcr.io/codenergy-dev/codeman-vllm`, and pinned by digest in `POD_IMAGES` in [`src/inference/images.ts`](../../src/inference/images.ts) ([dependencies](../development/dependencies.md#codemans-pod-images)). The vLLM image is about 9.1 GB compressed, the Ollama one 3.8 GB, and each new pod pulls its own.

- **No pinned image.** A version of Codeman whose `POD_IMAGES` has no image for an engine, such as the first with an image per engine for vLLM, stops that engine's runs in `open-key`, before any pod is created, at no cost. With `engine: vllm`: "This version of Codeman pins no vLLM pod image yet (`POD_IMAGES` in src/inference/images.ts), so no pod was created: use a version that pins one, or `engine: ollama`." With `engine: ollama` and no `pod-image` input, when the task would create a pod: "No pod image is pinned; see docs/installation/runpod.md#pods." Publishing and pinning are in [development](../development/guide.md#pod-images).
- **`pod-image`.** The input overrides the Ollama image only; vLLM pods always run the pinned vLLM image.

## Starting

A new vLLM pod pulls its image (2 to 4 minutes on a host without it), starts vLLM's processes, downloads the model, loads it, compiles the model and captures CUDA graphs (2 to 2.5 minutes), and starts its server: about 6 to 9 minutes before the first request, against 2 to 4 for Ollama, and 2 to 3 more for each restart the fit needs the first time. vLLM's own log, in the pod's, times each phase. `enforce-eager: true` skips the compilation and the graphs, for 1.5 to 2 minutes less per start, at the cost of slower decoding for every request ([optimization levels](../web/vllm/optimization-levels.md)); pods are kept and shared, so starts are rarer than requests. The model and the compilation are not cached across pods.

## Adding a key, or upgrading vLLM

A key is added to `VLLM_SETTINGS`, this table and its test together, after checking it in the source of the vLLM version the image pins, recorded in [`docs/web/vllm/`](../web/vllm/). Upgrading vLLM means changing `VLLM_VERSION` and the Dockerfile together, recording the new version's pages, and checking the keys, the refused ones, the parsers, the CUDA floor (`VLLM_MIN_CUDA`) and the messages the gateway reads (auto-fit, `/metrics`) against them.
