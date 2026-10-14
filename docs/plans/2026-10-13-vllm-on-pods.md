---
status: in progress
created_at: 2026-10-13T20:57:43-03:00
updated_at: 2026-10-13T21:33:37-03:00
commit: 95962c0
---

# vLLM on pods

## Goal

`provider: runpod-pod` serves a model with vLLM (`engine: vllm`) as well as Ollama, so the tasks that share a pod run their requests at once even for models Ollama serves one request at a time. Its `vllm:` block takes a closed list of vLLM's arguments, like `ollama:`; without it, a pod serves as many requests as its profile's tasks, with the largest context that fits the GPU for them, wholly on the GPU, or fails to start saying what to change.

## Context

- **Why.** Ollama 0.35.1 serves the `qwen35` family one request at a time, whatever `num-parallel` says ([Ollama settings](../settings/ollama.md#parallel-requests)). The test repository's model, `qwen3.8:27b-mtp-q4_K_M`, is one, so its profile of 4 tasks on one `NVIDIA RTX PRO 6000 Blackwell Server Edition` (and of 3 on its MIG `2g.48gb` partition) queues on one pod. vLLM batches requests whatever the model.
- **Approved direction** (the responsible person, 2026-10-13):
  - `runpod-pod` accepts `engine: vllm` beside `ollama`, with a `vllm:` block of settings, a closed list of keys like `ollama:`, documented in a table naming the vLLM version they were taken from. `max-num-seqs` defaults to the profile's task count, as `num-parallel` does for Ollama. Model IDs are Hugging Face IDs.
  - **One build, one image per engine**: the same Dockerfile with a target per engine and the same gateway, published by the same workflow at the same version; Codeman picks the image by `engine`, and the user never picks one. Later engines (llama.cpp, SGLang) would be new targets. Per-engine images were preferred to one image for all: each new pod pulls the image and Runpod bills the pull, vLLM and SGLang pin conflicting PyTorch and CUDA versions, and the newest engine would raise the CUDA floor for all.
  - vLLM fails at startup when the model or context does not fit, without moving anything to the CPU: the off-GPU guarantee stays. Whether vLLM can fit the context to the memory itself, or the search of the [plan for fitting Ollama to the GPU](2026-10-13-fit-ollama-to-the-gpu.md) is needed again, is answered below.
- **Today.** `runpod-pod` takes `engine: ollama` only (`PROVIDERS` in `src/inference/providers.ts`), and `vllm` exists only as the Serverless worker's engine (`src/inference/vllm.ts`: model IDs, usage, the endpoint's checks). The gateway's pod entry point starts and fits Ollama only (`src/gateway/main.ts`, `src/gateway/pod.ts`, `src/gateway/fit.ts`). One image, `POD_IMAGE` in `src/inference/ollama.ts`, built from `docker/pod/Dockerfile` (Ollama's image, Node's binary, `dist/gateway.js`) by `.github/workflows/pod-image.yml`, pushed as `ghcr.io/<owner>/codeman-pod:<sha>`; the `pod-image` input overrides it. A pod's settings key hashes model, GPU type, image, `pod-reuse` and the Ollama variables when there are some (`podSettingsKey` in `src/inference/selfhosted.ts`); the cache of fits is `organizations/{owner}/contexts/{key}`. Pods get 80 GB of container disk and no CUDA constraint (`#createPod` in `src/inference/runpod.ts`).
- **What Serverless taught** ([self-hosted inference plan](2026-10-02-self-hosted-inference.md), step 8): `runpod/worker-v1-vllm:v2.28.0` needs CUDA 13.0 or newer (`NVIDIA_REQUIRE_CUDA`), and on a host with an older driver every start failed with CUDA's error 804 until the endpoint filtered CUDA versions. Its worker served `unsloth/Qwen3.8-27B-NVFP4` on 2× RTX 5090 4 min 31 s after vLLM started: about 63 s starting processes, 30 s downloading 22.5 GB, 7 s loading, 149 s preparing the engine (62 compiling, 28 capturing CUDA graphs, about 15 tuning kernels) and 22 s starting the server. Served, it ran at 90 to 150 tokens per second, twice the pods' speed with Ollama, with 73% of prompts from the prefix cache. The responsible person's endpoint: `MODEL_NAME=unsloth/Qwen3.8-27B-NVFP4`, `TENSOR_PARALLEL_SIZE=2`, `MAX_MODEL_LEN=262144`, `KV_CACHE_DTYPE=fp8`, `REASONING_PARSER=qwen3`, `ENABLE_AUTO_TOOL_CHOICE=true`, `TOOL_CALL_PARSER=qwen3_xml`, MTP with 3 speculative tokens, `MAX_NUM_SEQS=4`, `ENABLE_PREFIX_CACHING=true`.

### What vLLM v0.31.0 does

Recorded in [`docs/web/vllm/`](../web/vllm/) at the tag, with the [vLLM tool](../web/tools/vllm.md); the image in [`docs/web/docker-hub/`](../web/docker-hub/).

- **The release.** v0.31.0, of 2026-10-05, is the latest; v0.30.0 came on 2026-09-22, a release about every two weeks. Its default image and wheels use CUDA 13.0; a `-cu129` image uses CUDA 12.9 ([v0.31.0](../web/vllm/v0-31-0.md)).
- **The image.** `vllm/vllm-openai:v0.31.0`, index `sha256:c1c9f6fd…`: 9.04 GB compressed for linux/amd64 (`-cu129`: 11.02 GB; a zstd-compressed `-x86_64-zstd`: 7.16 GB), entry point `vllm serve`, runs as root, `CUDA_VERSION=13.0.2` and `NVIDIA_REQUIRE_CUDA=cuda>=13.0…`, built for compute capabilities up to 12.0, so the RTX PRO 6000 Blackwell ([vllm/vllm-openai:v0.31.0](../web/docker-hub/vllm-vllm-openai-v0-31-0.md)). Ollama's is 3.78 GB and sets no CUDA floor ([ollama/ollama:0.35.1](../web/docker-hub/ollama-ollama-0-35-1.md)). Its CUDA forward-compatibility libraries (`VLLM_ENABLE_CUDA_COMPATIBILITY=1`) run it on older drivers, R535 and R570, only on "select professional and datacenter" GPUs ([installation](../web/vllm/docs-getting-started-installation-gpu-cuda-inc-md-at-v0-31-0.md)); whether the RTX PRO 6000 is one is not stated.
- **No silent offload.** At start, vLLM sizes the K/V cache from the memory left after the model and its activations, within `gpu-memory-utilization` (0.92 by default), and refuses to start, with an error naming the largest context that would fit, when that cache cannot hold **one** request of `max-model-len` tokens. It moves weights or cache to the CPU only when asked (`--cpu-offload-gb`, `--kv-offloading-size`) ([kv_cache_utils.py](../web/vllm/vllm-v1-core-kv-cache-utils-py-at-v0-31-0.md), [arg_utils.py](../web/vllm/vllm-engine-arg-utils-py-at-v0-31-0.md), [cache.py](../web/vllm/vllm-config-cache-py-at-v0-31-0.md)).
- **Auto-fit.** `--max-model-len -1` (or `auto`) makes vLLM find the largest context whose cache fits **one** request, up to the model's own ([kv_cache_utils.py](../web/vllm/vllm-v1-core-kv-cache-utils-py-at-v0-31-0.md#auto-fit)). It ignores `max-num-seqs`: with 4 requests near that length, the cache may hold fewer than 4, and vLLM then preempts and recomputes requests, slower but without error ([optimization and tuning](../web/vllm/optimization-and-tuning.md#preemption)). So auto-fit alone does not give each task the context it is told.
- **What it reports.** At start it logs, and publishes on `/metrics` as labels of `vllm:cache_config_info`, the cache's size in tokens (`kv_cache_size_tokens`) and how many requests of `max-model-len` it holds at once (`kv_cache_max_concurrency`), aware of a hybrid model's linear-attention state ([loggers.py](../web/vllm/vllm-v1-metrics-loggers-py-at-v0-31-0.md)). `GET /v1/models` gives the served `max_model_len` ([OpenAI-compatible server](../web/vllm/openai-compatible-server.md)). A gateway can read both on the loopback, so finding the context for N requests takes at most one more start.
- **Starting.** `torch.compile` and CUDA graphs are on by default (`-O2`); `--enforce-eager` skips both (and, since v0.31.0, the JIT kernel warmup) for the fastest start, at the cost of decoding speed ([optimization levels](../web/vllm/optimization-levels.md), [optimization and tuning](../web/vllm/optimization-and-tuning.md#faster-startup)). The compilation cache lives in `VLLM_CACHE_ROOT` (`~/.cache/vllm`), can be copied between machines, and is keyed by the model, the configuration, the PyTorch build and the GPU model ([`torch.compile` integration](../web/vllm/torch-compile-integration.md), [using Docker](../web/vllm/using-docker.md)); `max_model_len` is part of the key, so a restart with another context compiles again ([model.py](../web/vllm/vllm-config-model-py-at-v0-31-0.md#the-compilation-caches-key)). `--kv-cache-memory` skips memory profiling on a known GPU; `vllm preload` and `vllm snapshot` are new and experimental.
- **Tool calls and reasoning.** Tool calls need `--enable-auto-tool-choice` and a `--tool-call-parser` matching the model; reasoning, a `--reasoning-parser` ([tool calling](../web/vllm/tool-calling.md), [reasoning outputs](../web/vllm/reasoning-outputs.md)). vLLM does not pick a parser from the model. In v0.31.0, `qwen3_xml` and `qwen3_coder` are the same parser, and `qwen3` the reasoning parser for Qwen3 models ([tool parsers](../web/vllm/vllm-tool-parsers-init-py-at-v0-31-0.md), [reasoning parsers](../web/vllm/vllm-reasoning-init-py-at-v0-31-0.md)). vLLM's recipe for Qwen3.8-27B uses `qwen3_coder` and `qwen3` ([recipe](../web/vllm/models-qwen-qwen3-8-27b-yaml-at-d0f2838.md)).
- **The test model.** `unsloth/Qwen3.8-27B-NVFP4` (Apache-2.0, 23.4 GB on Hugging Face) is `Qwen3_5ForConditionalGeneration`: 64 layers, 16 of them full attention with 4 K/V heads of 256, the rest linear attention; a vision tower; one MTP layer; 262,144 tokens of context ([its `config.json`](https://huggingface.co/unsloth/Qwen3.8-27B-NVFP4/blob/main/config.json)). It mixes FP8 and NVFP4; on Blackwell (SM120) vLLM runs NVFP4 with a native CUTLASS kernel, and MTP needs `num_speculative_tokens` given explicitly, else the start fails; the recipe uses 3 tokens, and 5 on the RTX PRO 6000, with 81 to 85% of NVFP4 drafts accepted. `--language-model-only` skips the vision tower and leaves its memory to the cache ([recipe](../web/vllm/models-qwen-qwen3-8-27b-yaml-at-d0f2838.md), [MTP](../web/vllm/mtp-multi-token-prediction.md)). The Qwen3.5 speculative-decoding fixes the recipe waits for (#51674, #51812) are in v0.28.0's notes, so in v0.31.0.
- **Memory of the test model,** Codeman's estimate from the above: an FP8 cache takes about 34 KiB per token (16 layers × 4 heads × 256 × 2, plus the MTP layer), so 8.5 GiB per request of 262,144 tokens. On the full GPU (0.92 × 96 GB, less about 21 GiB of weights and 5 of activations and graphs), about 55 GiB of cache: some 1.7 million tokens, 4 requests of 262,144 at once. On the 48 GB partition, about 16 GiB: some 490,000 tokens, so about 1.9 requests of 262,144, and 3 requests of about 150,000. vLLM's own figures replace these at the first start.
- **MIG.** vLLM's own CI runs on H200 MIG partitions, but v0.31.0 has two open issues: a MIG UUID in `CUDA_VISIBLE_DEVICES` crashes its start (pull request #41776), and NVML may report the parent GPU's memory or refuse to (pull request #50463), which changes only defaults such as `max-num-batched-tokens`; memory profiling uses PyTorch, which sees the partition. The end-to-end test checks it.
- **What it sends out.** By default vLLM reports anonymous usage (hardware, model architecture) to `https://stats.vllm.ai`; `VLLM_NO_USAGE_STATS=1` or `DO_NOT_TRACK=1` stops it ([envs.py](../web/vllm/vllm-envs-py-at-v0-31-0.md), [usage_lib.py](../web/vllm/vllm-usage-usage-lib-py-at-v0-31-0.md)). Arguments that send K/V cache, events or traces elsewhere, or write requests to the log, are listed in [arg_utils.py](../web/vllm/vllm-engine-arg-utils-py-at-v0-31-0.md#arguments-that-move-weights-cache-or-requests-elsewhere). The server's own arguments (host, port, API key, origins, TLS, middleware, parser plugins) are in [cli_args.py](../web/vllm/vllm-entrypoints-launchers-cli-args-py-at-v0-31-0.md).
- **The settings file.** Its YAML subset takes quoted scalars without quotes inside, and no flow maps (`src/yaml.ts`), so a key cannot take JSON such as vLLM's `--speculative-config`: such an argument needs keys of its own.

### What Runpod offers

- **CUDA.** A pod's `gpu` takes `minCudaVersion` (a floor, such as `"13.0"`) or `allowedCudaVersions` (an exact set; a version no host reports is a capacity error); the catalog lists each GPU type's CUDA versions and whether they have capacity (`GET /v2/catalog/gpus?include=AVAILABILITY&product=POD`); the pod reports its host's `cudaVersion` ([create a pod](../web/runpod/create-a-pod.md#the-hosts-cuda-version), refreshed for this plan).
- **Storage** ([storage options](../web/runpod/storage-options.md), [network volumes](../web/runpod/network-volumes.md), [global volumes for pods](../web/runpod/global-volumes-for-pods.md)): the container disk, US$ 0.10 per GB per month, is lost with the pod. A network volume, US$ 0.07 per GB per month, outlives pods but binds them to its data center, reads at 200 to 400 MB/s, and may be corrupted by concurrent writers. A global volume, in beta, works in any data center at US$ 0.09 per GB per month plus a charge per operation, but is object storage without file locks or atomic renames, eventually consistent. Pods attach either only at creation.

### Expected sizes and start

- **Images.** Codeman's vLLM image would be vLLM's plus Node's binary and the gateway, about 9.1 GB compressed for CUDA 13.0 (11.1 GB for CUDA 12.9); the Ollama one stays at about 3.8 GB.
- **A new pod's start,** estimated for the test model on a host without the image: pulling the image, 2 to 4 minutes; vLLM's processes, 0.5 to 1; the model's download, 0.5 to 1; loading, about 0.2; compiling, graphs and warmup, 2 to 2.5; the server, about 0.3. About 6 to 9 minutes before the first request, against 2 to 4 for Ollama, so US$ 0.20 to 0.30 of the full GPU per new pod. A second start to fit the context, when needed (decision 4), adds 2 to 3 minutes the first time per combination. A kept pod starts nothing.

### Constraints

No new npm dependency. Every image pinned by digest. Firestore holds no secrets; only the key jobs reach it. Pods without `engine: vllm` keep their settings key and behavior. The workflow's permissions do not change. Hugging Face becomes a service Codeman relies on (pods download models from it), to audit like Runpod and Ollama.

## Decisions

Answered by the responsible person on 2026-10-13: every decision takes its recommendation, but decision 8, changed.

1. **vLLM's version and the image's base.**
   - (a) v0.31.0, CUDA 13.0: `FROM vllm/vllm-openai:v0.31.0@sha256:c1c9f6fd5c109ba7f0546a59f5b2f15fb87f64c77782e90a27b648b42a8e67c3` (the index, as for Ollama), 9.04 GB. The build vLLM tests most, with the Qwen3.5 MTP fixes.
   - (b) v0.31.0-cu129, CUDA 12.9: 11.02 GB, a lower floor (decision 2), so more hosts.
   - (c) v0.31.0-x86_64-zstd: 7.16 GB, CUDA 13.0, amd64 only; whether GHCR and Runpod keep zstd layers through Codeman's push is unchecked.
   - (d) v0.30.0: older, nothing gained.

   Recommendation: (a), pinned as `VLLM_VERSION` beside the image with a test that checks it against the Dockerfile, as for Ollama; (b) is the fallback if the end-to-end test finds no capacity for CUDA 13.0 on the GPU types used. Upgrades follow the Ollama rule: check the keys, parsers and messages against the new version's recorded source.

   **Answer:** (a): v0.31.0, CUDA 13.0, pinned by the index's digest, with `VLLM_VERSION` checked against the Dockerfile. (b) stays the fallback.

2. **The CUDA floor, and how pods require it.**
   - (a) vLLM pods are created with `gpu.minCudaVersion` set to the image's CUDA (`VLLM_MIN_CUDA`, `"13.0"`), and before creating one, `open-key` reads the GPU type's `cudaVersions` with that floor and stops the run, before paying anything, when none has capacity ("No host with `<gpu>` offers CUDA 13.0 or newer now, which vLLM's image needs."). The pod's `cudaVersion` is logged. Ollama pods stay unconstrained.
   - (b) `allowedCudaVersions` with an exact list: a new CUDA version would be refused until the list changes.
   - (c) No filter, with `VLLM_ENABLE_CUDA_COMPATIBILITY=1`: works only on GPUs NVIDIA supports for forward compatibility, which the docs do not confirm for the RTX PRO 6000, and never on consumer GPUs (the Serverless error 804).

   Recommendation: (a).

   **Answer:** (a): `minCudaVersion` from `VLLM_MIN_CUDA` for vLLM pods only, the catalog's `cudaVersions` read before creating one, and the pod's `cudaVersion` logged.

3. **The `vllm:` keys and their defaults.** Each key becomes one argument of `vllm serve`, from v0.31.0's [arg_utils.py](../web/vllm/vllm-engine-arg-utils-py-at-v0-31-0.md) and [cli_args.py](../web/vllm/vllm-entrypoints-launchers-cli-args-py-at-v0-31-0.md); a key not listed stops the run, as with `ollama:`. Proposed:

   | Key | Value | vLLM's default | Without the key |
   | --- | --- | --- | --- |
   | `max-model-len` | Whole number, at least 1 | The model's own | The largest that fits the GPU for `max-num-seqs` requests (decision 4) |
   | `max-num-seqs` | Whole number, at least 1 | 256 or 1024, by the GPU's memory | The most tasks the profile serves, like `num-parallel` |
   | `gpu-memory-utilization` | Number above 0, at most 1 | 0.92 | vLLM's |
   | `kv-cache-dtype` | `auto`, `bfloat16`, `float16`, `fp8`, `fp8_e4m3`, `fp8_e5m2` | `auto` (the model's) | vLLM's |
   | `enable-prefix-caching` | `true` or `false` | `true` | vLLM's |
   | `max-num-batched-tokens` | Whole number, at least 1 | 2048 to 16384, by the GPU's memory | vLLM's |
   | `tool-call-parser` | One of v0.31.0's tool parsers | None | Required (decision 5) |
   | `reasoning-parser` | One of v0.31.0's reasoning parsers | None | None |
   | `speculative-method` | `mtp`, `ngram`, `eagle3`, `dflash`, `dspark` or `draft_model`, of v0.31.0's methods ([speculative.py](../web/vllm/vllm-config-speculative-py-at-v0-31-0.md)); not `custom_class`, which loads code | None | None |
   | `speculative-tokens` | Whole number, at least 1 | None | Required with `speculative-method` |
   | `speculative-model` | A Hugging Face ID, for methods with a draft model | None | None |
   | `language-model-only` | `true` or `false` | `false` | vLLM's |
   | `enforce-eager` | `true` or `false` | `false` | vLLM's (decision 7) |
   | `async-scheduling` | `true` or `false` | Decided by vLLM | vLLM's |

   The three `speculative-*` keys make one `--speculative-config` JSON, since the settings file cannot hold JSON (Context). Parsers are settings, not derived from the model (decision 5). Refused, with the reason in the error: `host`, `port`, `uds`, `api-key`, `served-model-name`, `model` (Codeman serves the run's model on the loopback, behind the gateway); `allowed-origins`, `ssl-*`, `root-path`, `middleware`, `tool-parser-plugin`, `reasoning-parser-plugin`, `chat-template` (code or files Codeman does not ship); `trust-remote-code` (it runs the model repository's code beside the runs' requests); `download-dir`, `load-format`, `hf-token` (Codeman downloads public models, decision 10); `tensor-parallel-size`, `pipeline-parallel-size`, `data-parallel-size` (a pod has one GPU); `cpu-offload-gb`, `kv-offloading-size`, `kv-offloading-backend` (they move weights or cache off the GPU); `kv-transfer-config`, `kv-events-config`, `otlp-traces-endpoint`, `enable-log-requests`, `enable-log-outputs` (they send or write the runs' data).

   - (a) This list.
   - (b) A smaller one (`max-model-len`, `max-num-seqs`, `gpu-memory-utilization`, `kv-cache-dtype` and the parsers), others added when asked.
   - (c) Any argument but the refused ones: against the approved closed list.

   Recommendation: (a): it covers the responsible person's Serverless endpoint and vLLM's recipe for the test model, and each key is checked like `ollama:`'s.

   **Answer:** (a): this list.

4. **Fitting `max-model-len`.**
   - (a) vLLM's auto-fit (`-1`): one start; the largest context for **one** request. With `max-num-seqs` requests near it, vLLM preempts and recomputes them: slower, never off the GPU. The gateway reports the cache's concurrency and warns when it is below `max-num-seqs`.
   - (b) A context for `max-num-seqs` requests, from vLLM's own figures: the gateway starts vLLM with the cached context when there is one, else with auto-fit; reads `kv_cache_size_tokens`, `kv_cache_max_concurrency` and the served `max_model_len`; when the cache holds fewer than `max-num-seqs` requests of that length, it restarts vLLM once with the largest multiple of 4096 that holds them, checks the concurrency again, and serves it. Below 64000 tokens, the floor of the Ollama plan, or the model's own when smaller, the start fails saying what to change (fewer tasks, `kv-cache-dtype: fp8`, `language-model-only`, a bigger GPU). The result goes to the cache of fits, so later pods start once. The restart costs 2 to 3 minutes the first time per combination, since a new context compiles again.
   - (c) An estimate before the first start from the model's configuration and the GPU's memory, as for Ollama, then the same check: one start when right, but it must model weights, activations, graphs and linear-attention state, which vLLM measures exactly.

   With an explicit `max-model-len`, vLLM refuses a context whose cache cannot hold one request, and the gateway relays its message; under (b) or (c), the start also fails when the cache holds fewer than `max-num-seqs` requests of it, as with Ollama's explicit `context-length`. Recommendation: (b): each task gets the context the agent is told, the start never fails silently slower, and only the first pod of a combination pays a second start.

   **Answer:** (b): a context for `max-num-seqs` requests, from vLLM's own figures, cached.

5. **Guaranteeing tool calls,** as `open-key` checks `ENABLE_AUTO_TOOL_CHOICE` and `TOOL_CALL_PARSER` for Serverless.
   - (a) `tool-call-parser` is required with `engine: vllm`, checked against v0.31.0's parsers before any pod is created ("`vllm` needs `tool-call-parser`, the one that matches the model, such as `qwen3_xml` for Qwen3 models; see the model's card or vLLM's recipe."); the gateway always adds `--enable-auto-tool-choice`.
   - (b) Derived from the model by a table in Codeman (family to parser), a setting overriding it: a table to keep current, silently wrong for models it does not know.
   - (c) (a), plus a probe once vLLM serves: one chat request offering a `ping` tool and asking for it, `tool_choice: auto`; no parsed `tool_calls` after two tries fails the start ("vLLM did not return a tool call with the parser `<parser>`: it may not match `<model>`."). A wrong parser otherwise shows only as an agent that cannot act, spending its budget.

   Recommendation: (c). `reasoning-parser` stays optional, without a probe.

   **Answer:** (c): `tool-call-parser` required and checked, `--enable-auto-tool-choice` always, and the probe once vLLM serves.

6. **Caching models and compilations across pods.**
   - (a) None: each new pod downloads the model (30 to 60 s for the test model) and compiles (about 60 s), some US$ 0.04 to 0.07 of the full GPU per new pod; the cache of fits (decision 4) is in Firestore.
   - (b) A network volume per data center for the Hugging Face cache and `VLLM_CACHE_ROOT`: about US$ 2.80 a month for 40 GB, pods bound to its data center (fewer GPUs, more capacity errors), reads at 200 to 400 MB/s (slower than the 750 MB/s download measured on Serverless, so only the compilation is saved), concurrent pods writing one compilation cache, and a volume's life for Codeman to manage. Break-even near 70 new pods a month, ignoring capacity.
   - (c) A global volume: any data center, US$ 0.09 per GB per month plus operations, but in beta, without file locks or atomic renames, on which Hugging Face's and vLLM's caches rely.

   Recommendation: (a) now; the end-to-end test measures each phase of the start, and a later plan revisits (b) with those numbers.

   **Answer:** (a): no volume now; the end-to-end test measures the start.

7. **Start time against decoding speed.**
   - (a) vLLM's defaults (compilation and CUDA graphs, `-O2`), with `enforce-eager` as a key for whoever prefers starts.
   - (b) `enforce-eager` by default: about 1.5 to 2 minutes less per start, slower decoding for every request of every run.

   Recommendation: (a): pods are kept and shared, so starts are rarer than requests.

   **Answer:** (a): vLLM's defaults, with `enforce-eager` as a key.

8. **Building, publishing and pinning an image per engine.**
   - (a) One Dockerfile with targets `ollama` and `vllm` (sharing the Node stage); the workflow builds both in a matrix on every change, pushes `ghcr.io/<owner>/codeman-pod:<sha>-<engine>` to the existing public package, frees runner disk first (removing preinstalled toolchains with `rm`, no new action) and allows 60 minutes; its summary lists both digests. `POD_IMAGES`, by engine, replaces `POD_IMAGE`, in a module of its own, each pinned by digest in a reviewed commit. The `pod-image` input keeps overriding the Ollama image only; a vLLM override is out of scope.
   - (b) A package per engine (`codeman-pod-ollama`, `codeman-pod-vllm`): clearer names, but each new package must be made public by hand, and the Ollama one renamed.
   - (c) A workflow per engine: duplicated steps.

   Recommendation: (a). After the first push, GHCR holds vLLM's base layers, so later pushes upload only Codeman's.

   **Answer:** (a), with one change: instead of tags `<sha>-<engine>` in the `codeman-pod` package, **one package per engine, named `codeman-<engine>`**: `ghcr.io/codenergy-dev/codeman-ollama` and `ghcr.io/codenergy-dev/codeman-vllm`, without "pod" in the name, tagged `<sha>`. The older `ghcr.io/codenergy-dev/codeman-pod@sha256:…` digests stay wherever the code lists older images (`SINGLE_RUN_IMAGES`, `IMAGES_WITHOUT_OLLAMA_SETTINGS`), since pods on them may still exist. A new GHCR package is private by default: after the first publish of each, the responsible person makes it public (Runpod pulls without credentials), as the installation and development docs say. Until both are published and their digests sent, `POD_IMAGES` keeps the pinned Ollama image (`codeman-pod@sha256:3252d4…`) and has no vLLM image: a run with `engine: vllm` stops before any pod, at no cost, saying so. Pinning each new digest is a one-line change.

9. **The pod's settings key, and the cache of fits.**
   - (a) For vLLM pods only, the key adds `engine vllm` and the vLLM arguments, sorted, the derived `max-num-seqs` included, as Ollama's variables are added; Ollama pods keep theirs. The cache of fits keeps its collection, keyed by image, model, GPU type and the arguments but `max-model-len`, with an `engine` field.
   - (b) Every key gains the engine: one-time loss of kept Ollama pods, slightly simpler code.

   Recommendation: (a).

   **Answer:** (a).

10. **Checking the model, and the pod's disk.**
    - (a) Before creating a vLLM pod, `open-key` asks Hugging Face's API for the model (`GET https://huggingface.co/api/models/<id>`): it must exist, be public and not gated, and have safetensors; the run stops otherwise, before paying for a pod. Its size sets the container disk: the model, the image and caches (about 40 GB), with room to spare, at least 80 GB.
    - (b) No check, and a fixed disk, such as 150 GB: a wrong or gated model fails in the pod after the image's pull, and large models do not fit.

    Recommendation: (a). Hugging Face's API is free and needs no key; it is recorded and audited in step 1.

    **Answer:** (a). Hugging Face's API is approved as a new external service: public, unauthenticated, read-only calls, no token; audited in [dependencies](../development/dependencies.md).

## Steps

1. Record the third-party pages and audit. Done when `src/webdocs.test.ts` and the link checker pass, and [dependencies](../development/dependencies.md) has the audit of vLLM, its image and Hugging Face.
   - **Started on 2026-10-13, while writing this plan** (not committed): the [vLLM tool](../web/tools/vllm.md) and the [Docker Hub tool](../web/tools/docker-hub.md); vLLM's pages in full (Apache-2.0): [conserving memory](../web/vllm/conserving-memory.md), [using Docker](../web/vllm/using-docker.md), [MTP](../web/vllm/mtp-multi-token-prediction.md), [optimization levels](../web/vllm/optimization-levels.md), [optimization and tuning](../web/vllm/optimization-and-tuning.md), [`torch.compile` integration](../web/vllm/torch-compile-integration.md), [quantized K/V cache](../web/vllm/quantized-kv-cache.md), [tool calling](../web/vllm/tool-calling.md), [reasoning outputs](../web/vllm/reasoning-outputs.md), [OpenAI-compatible server](../web/vllm/openai-compatible-server.md); source files in full: [installation](../web/vllm/docs-getting-started-installation-gpu-cuda-inc-md-at-v0-31-0.md), [tool parsers](../web/vllm/vllm-tool-parsers-init-py-at-v0-31-0.md), [reasoning parsers](../web/vllm/vllm-reasoning-init-py-at-v0-31-0.md), [cli_args.py](../web/vllm/vllm-entrypoints-launchers-cli-args-py-at-v0-31-0.md), [cache.py](../web/vllm/vllm-config-cache-py-at-v0-31-0.md), [usage_lib.py](../web/vllm/vllm-usage-usage-lib-py-at-v0-31-0.md), and the [Qwen3.8-27B recipe](../web/vllm/models-qwen-qwen3-8-27b-yaml-at-d0f2838.md); in Codeman's words: [v0.31.0](../web/vllm/v0-31-0.md), [kv_cache_utils.py](../web/vllm/vllm-v1-core-kv-cache-utils-py-at-v0-31-0.md), [arg_utils.py](../web/vllm/vllm-engine-arg-utils-py-at-v0-31-0.md), [model.py](../web/vllm/vllm-config-model-py-at-v0-31-0.md), [speculative.py](../web/vllm/vllm-config-speculative-py-at-v0-31-0.md), [envs.py](../web/vllm/vllm-envs-py-at-v0-31-0.md), [loggers.py](../web/vllm/vllm-v1-metrics-loggers-py-at-v0-31-0.md); the images [vllm/vllm-openai:v0.31.0](../web/docker-hub/vllm-vllm-openai-v0-31-0.md) and [ollama/ollama:0.35.1](../web/docker-hub/ollama-ollama-0-35-1.md); Runpod's [storage options](../web/runpod/storage-options.md), [network volumes](../web/runpod/network-volumes.md) and [global volumes for pods](../web/runpod/global-volumes-for-pods.md), and [create a pod](../web/runpod/create-a-pod.md) refreshed for its CUDA constraints and mounts. Both tests pass. Left: Hugging Face's model API (decision 10), Runpod's [get a GPU type](../web/runpod/get-a-gpu-type.md) refreshed for `cudaVersions` (decision 2), and the audit.
   - **Done on 2026-10-13**: the rest committed with the answers: the [Hugging Face tool](../web/tools/hugging-face.md); the Hub's [rate limits](../web/hugging-face/hub-rate-limits.md) in full (Apache-2.0); the model's route, which the Hub's OpenAPI document leaves out, from its official client in Codeman's words: [hf_api.py](../web/hugging-face/src-huggingface-hub-hf-api-py-at-v2-2-0.md) and [_http.py](../web/hugging-face/src-huggingface-hub-utils-http-py-at-v2-2-0.md) at v2.2.0; [get a GPU type](../web/runpod/get-a-gpu-type.md) refreshed for `include=AVAILABILITY`, `minCudaVersion` and `cudaVersions`; and the audit of vLLM, its image and Hugging Face in [dependencies](../development/dependencies.md). Both tests pass.
2. Write this plan. Done when it is committed with status `pending`, the decisions are answered, and it is set `in progress`.
   - **Done on 2026-10-13**: committed as `800f9f6` with status `pending`; the answers recorded (decision 8 changed: a package per engine), and set `in progress`.
3. Settings: `engine: vllm` on `runpod-pod`, the `vllm` block (`PROVIDER_BLOCKS`, `src/settings.ts`), `VLLM_SETTINGS`, `REFUSED_VLLM_SETTINGS` and the parser lists in `src/inference/vllm.ts` (decision 3), Hugging Face IDs for pods, the required parser (decision 5), the `vllm` block in the `inference` choice and `parseInferenceChoice`. Done when tests cover each key and value, each refusal and its message, kebab-case and unknown keys, layering, a block for another engine or provider, and the choice.
4. Images: the Dockerfile's targets, the workflow (decision 8), `POD_IMAGES`, `VLLM_VERSION` and `VLLM_MIN_CUDA` with their test against the Dockerfile; `VLLM_NO_USAGE_STATS=1` and `DO_NOT_TRACK=1` set in the vLLM target. Done when both targets build in CI and the tests pass.
5. Runpod and Hugging Face: `minCudaVersion` and the catalog check for vLLM pods (decision 2), the pod's `cudaVersion` logged, the model check and the disk (decision 10). Done when tests with fakes cover a floor sent only for vLLM, no capacity stopping the run before creating, a missing, gated or non-safetensors model stopping it, and the disk's size.
6. The gateway: an engine runner beside Ollama's (`src/gateway/vllm.ts`): `vllm serve` with the arguments of `CODEMAN_VLLM` checked against the same list, on `127.0.0.1:8000`, `--served-model-name` the run's model, `--enable-auto-tool-choice`; `CUDA_VISIBLE_DEVICES=0` when it holds a MIG UUID; waiting for `/health`; reading `/v1/models` and `/metrics`; the fit (decision 4); the probe (decision 5); `vllm` and `fit` in the status; the failures and their messages. Done when tests with a fake vLLM cover: a start whose cache holds the requests; one that needs the restart; the floor's failure; an explicit context vLLM refuses and one too small for the requests; the cached context used; a probe that fails; the arguments refused in `CODEMAN_VLLM`.
7. The run: `PodInference` for vLLM: the settings key and the cache of fits (decision 9), the derived `max-num-seqs`, `CODEMAN_VLLM`, the status required from the image (the arguments applied and the fit), the context reported to the agent, the log lines. Done when tests cover each, and Ollama pods' keys and environment unchanged.
8. Docs and templates: `docs/settings/vllm.md` (the keys' table naming v0.31.0, refusals, errors, defaults, the fit, the probe, the CUDA floor, images), [providers](../settings/providers.md), [pods](../inference/pods.md), [self-hosted inference](../inference/self-hosted.md), [Runpod's installation](../installation/runpod.md), [dependencies](../development/dependencies.md), [development](../development/guide.md), [data layout](../backend/data-layout.md), [risks](../security/risks.md), [settings reference](../settings/reference.md), [profiles](../settings/profiles.md), [provider settings across layers](../settings/provider-settings-across-layers.md), [upgrading](../installation/upgrading.md), `docs/README.md` and `templates/settings.yml`. Done when the docs tests, the template test and the link checker pass.
9. Rebuild `dist/` and run `npm run check`. Done when it passes and the working tree is clean; both images then need publishing and pinning (end-to-end test, step 1).

## End-to-end test

By the responsible person, on the test repository, after pushing. Costs are estimates, with the full RTX PRO 6000 at about US$ 2 an hour and its MIG `2g.48gb` partition at about US$ 1; check Runpod's prices. Its settings: a profile with `tasks: 4` on `NVIDIA RTX PRO 6000 Blackwell Server Edition` and one with `max-tasks: 3` on `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb`, both with:

```yaml
engine: vllm
model: unsloth/Qwen3.8-27B-NVFP4
vllm:
  tool-call-parser: qwen3_xml
  reasoning-parser: qwen3
  kv-cache-dtype: fp8
  speculative-method: mtp
  speculative-tokens: 3
  language-model-only: true
```

1. **Publish and pin the images.** Push; the workflow publishes both targets. Send the digests; they are pinned in `POD_IMAGES` in a commit of its own. Note how long the first vLLM push took. Cost: none (the repository's Actions minutes; public GHCR packages are free).
2. **CUDA capacity.** With the account key, read `GET /v2/catalog/gpus/<id>?include=AVAILABILITY&product=POD&minCudaVersion=13.0` for both GPU types. If neither has capacity, apply decision 1's fallback (CUDA 12.9) before going on. Cost: none.
3. **Errors before any pod.** Remove `tool-call-parser`; then set `host: 0.0.0.0`; then `max-num-seq: 4`; then a model that is not a Hugging Face ID, and a gated one. Each run stops in `select` or `open-key` with its message, and no pod is created. Restore the settings. Cost: none beyond the key jobs.
4. **Four tasks on the full GPU.** With 4 tasks ready past planning, start a run. Check: the pod was created with `minCudaVersion` 13.0, and `open-key` logs its `cudaVersion`; its `CODEMAN_VLLM` has `max-num-seqs` 4 and no `max-model-len`; the gateway's log times each phase of the start (first line, vLLM's processes, download, load, compilation, graphs, ready), with one start expected; it logs the served context, the cache's tokens and a concurrency of at least 4; the probe passed; `open-key`'s `context-length` and OpenCode's configuration have the served context; Firestore has the fit in `contexts`; the 4 tasks' requests overlap (unlike Ollama's queue); tokens per second and MTP acceptance are logged. Cost: a 6 to 9 minute start and 20 to 40 minutes of work, about US$ 1.00 to 1.60.
5. **The cache.** Once that pod has ended, run 4 tasks again. The pod gets `CODEMAN_FIT`, starts vLLM once with it, and `open-key` reports it from the cache; compare the start with step 4's. Cost: as step 4, about US$ 1.00 to 1.50.
6. **Three tasks on the MIG partition.** With 2 or 3 tasks ready, start a run. vLLM starts on the partition (if it crashes on a MIG UUID, the gateway's `CUDA_VISIBLE_DEVICES` fix is checked here); `max-num-seqs` is 3; the gateway restarts once to fit 3 requests (expected about 150,000 tokens), or fails with the floor's message; a cache document of its own. Cost: an 8 to 12 minute start and 20 to 40 minutes of work, about US$ 0.50 to 0.90.
7. **An explicit context too large for the requests.** In the MIG profile, set `max-model-len: 262144`. vLLM starts (one request fits), and the gateway fails the start because the cache holds fewer than 3 requests of it, naming what to change; the pod is terminated, and no cache document is written. Remove it. Cost: about 8 to 10 minutes of the partition, under US$ 0.20.
8. **Ollama unchanged.** One run on an Ollama profile with the new Ollama image: its settings key and environment are as before. Cost: one run, as usual, about US$ 0.50 to 1.

Total: about US$ 3.50 to 5.50.

## Out of scope

- Other engines: SGLang and llama.cpp's server, which would be targets of their own later; TensorRT-LLM. LM Studio is proprietary software, and its terms likely do not allow shipping it in Codeman's image.
- Several GPUs per pod (tensor or pipeline parallelism).
- Gated or private models, which need a Hugging Face token as a secret.
- Network or global volumes (decision 6), `--kv-cache-memory`, `vllm preload` and `vllm snapshot`.
- Overriding the vLLM image (`pod-image` stays Ollama's), LoRA adapters, image and video inputs, and contexts beyond the model's own (YaRN).
- Changes to Serverless endpoints, which keep Runpod's worker.
