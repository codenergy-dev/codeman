---
status: pending
created_at: 2026-11-23T14:10:00-03:00
updated_at: 2026-11-24T10:00:00-03:00
commit: cf237a6
---

# Estimate the fit before creating a pod

## Goal

Before `open-key` creates a vLLM pod, it estimates from the model's configuration and the GPU's memory whether vLLM's K/V cache can hold the requests the pod must serve. When the estimate is clearly short, no pod is created, and the run fails with the same levers the gateway's fit message gives.

## Context

### What a fit costs today

The gateway decides the fit inside the pod, after vLLM starts ([memory](../settings/vllm.md#memory), [`src/gateway/vllm.ts`](../../src/gateway/vllm.ts)). That stays the authority, since only vLLM measures its own memory. But a pod that does not fit is billed for its whole start:

- The pod check's `unfit` case, on 2026-11-06, ran an RTX A4000 for 1,147 seconds, about $0.08, to fail with "the K/V cache holds 33.59 of the 256 requests" ([the e2e plan](2026-11-04-run-e2e-on-github-runners.md#progress)).
- A vLLM pod takes about 8 minutes to serve on a fresh host, and a fit can take 3 or 4 starts ([without `max-model-len`](../settings/vllm.md#without-max-model-len)). A large model on an expensive GPU multiplies both.

### What `open-key` already knows before creating a pod

| Fact | Where it comes from now |
| --- | --- |
| The weights' bytes | Hugging Face's API, `GET /api/models/<id>?blobs=true`, summed over safetensors files ([`huggingface.ts`](../../src/inference/huggingface.ts)); it sets the disk |
| The model's `config.json` | Read already, at `main`, for its vision tower ([`HuggingFace.vision`](../../src/inference/huggingface.ts)) |
| The GPU's memory | `pods.memory(gpuType)`: Runpod's API, or a Salad class's name, such as `(24 GB)` ([`gpu.ts`](../../src/inference/gpu.ts)) |
| `max-num-seqs`, `max-model-len`, `gpu-memory-utilization`, `kv-cache-dtype`, `language-model-only` | The pod's `vllm` settings, `max-num-seqs` derived from the profile's tasks when absent ([accepted keys](../settings/vllm.md#accepted-keys)) |

So the estimate needs no new request for vLLM: only more fields of the `config.json` it already reads.

### The estimate

```text
available  = GPU memory (GiB) × gpu-memory-utilization − weights − overhead
per token  = 2 × layers with attention × K/V heads × head dimension × bytes of the cache's dtype
needed     = max-num-seqs × context × per token
```

- **Context:** `max-model-len` when set; otherwise the floor, `min(64000, the model's own)`, the least the gateway accepts ([`floorContext`](../../src/gateway/fit.ts)).
- **Per token:** from `config.json`: `num_hidden_layers`, `num_key_value_heads` (else `num_attention_heads`), `head_dim` (else `hidden_size ÷ num_attention_heads`), and the dtype: `kv-cache-dtype` when it is `fp8`, else the model's `torch_dtype` or `dtype`. This is how vLLM 0.32.0 counts a full-attention layer ([`config/model.py`](../web/vllm/vllm-config-model-py-at-v0-32-0.md), [`kv_cache_utils.py`](../web/vllm/vllm-v1-core-kv-cache-utils-py-at-v0-32-0.md)).
- **No estimate** for a model it cannot count: sliding windows, hybrid or linear attention, multi-head latent attention, a configuration nested under `text_config` without the fields above, or an unknown GPU memory. Those pods start as today.
- **Overhead:** activations, CUDA graphs and the CUDA context, which vLLM measures by profiling. The two pods of the e2e plan calibrate it, with Qwen2.5-0.5B's 12,288 bytes per token:

| GPU | Memory × 0.92 | Weights | K/V cache vLLM reported | Left for the overhead |
| --- | --- | --- | --- | --- |
| RTX A4000, 16 GiB | 14.72 GiB | 0.93 GiB | 1,100,677 tokens, 12.60 GiB | 1.19 GiB |
| RTX A5000, 24 GiB | 22.08 GiB | 0.93 GiB | 1,775,312 tokens, 20.32 GiB | 0.83 GiB |

The `unfit` case asked 256 × 32,768 × 12,288 bytes, 96 GiB: about 7 times what the A4000 holds, far beyond any error of the estimate.

## Decisions

Answered by the maintainer on 2026-11-24: 1 (a), 2 (a), 3 (b), 4 (a) and 5 (a). Ollama gets the estimate too, so that both engines behave alike.

1. **What `open-key` does when the estimate is clearly short.**
   - **(a) Fail the run before creating the pod (recommended),** with the gateway's levers: lower `max-model-len` or `max-num-seqs`, `kv-cache-dtype: fp8`, `language-model-only: true`, or a GPU with more memory. The settings name the GPU type, and its price; Codeman should not change it.
   - (b) Pick a larger GPU type itself. It changes the cost the settings chose, and needs a list of GPU types per provider.
2. **When the estimate is "clearly short".** It must never refuse a pod that would have fitted.
   - **(a) An optimistic bound (recommended):** count no overhead at all, and refuse only when even that falls short. It catches gross mistakes, such as the `unfit` case, and nothing near the edge, which the gateway still decides.
   - (b) A calibrated overhead, about 1.5 GiB, and a margin of 10%. It catches more, but the overhead changes with the model, the engine's version and the GPU, and a wrong refusal blocks a pod that works.
3. **Whether Ollama gets it too.**
   - **(a) vLLM only (recommended).** Ollama lowers the context itself down to the floor, so it fails only when even the floor does not fit, and its model's architecture is in the GGUF file, which needs the registry's manifest and a ranged read of the blob: new third-party APIs.
   - (b) Both. Adds Ollama's registry to `docs/web/` and to the audit.
4. **Where the estimate lives.**
   - **(a) In `open-key`'s checks before creation (recommended),** beside the CUDA and model checks ([before the pod is created](../settings/vllm.md#before-the-pod-is-created)), as a pure function next to the gateway's fit code, so the gateway and the launcher share the floor and the per-token count. Joining a pod checks nothing, as today.
   - (b) In the gateway only, at its start: the pod is created anyway, and only the download and vLLM's start are saved.
5. **What the pod check's `unfit` case expects then.**
   - **(a) The refusal before creation, with no pod and no cost (recommended).** The gateway's own fit message stays covered by the e2e suite's `failures/fit-vllm-explicit` scenario.
   - (b) Keep a case that passes the estimate and fails in the pod: it needs a configuration near the edge, which is fragile across GPUs.

## Steps

1. **Save the sources.** vLLM 0.32.0's `vllm/v1/worker/gpu_worker.py` and its memory profiling (`determine_available_memory`, `vllm/utils/mem_utils.py` or where 0.32.0 keeps it), which say what `gpu-memory-utilization` covers; the `config.json` of the e2e model is already in [`docs/web/hugging-face/`](../web/hugging-face/qwen-qwen2-5-0-5b-instruct-at-7ae5576.md). With decision 3 (b), Ollama's registry manifest and blob API too. Done when the web documentation's tests pass, and these pages confirm or correct the formula above.
2. **The estimate.** A pure function from the model's `config.json`, the weights' bytes, the GPU's memory and the `vllm` settings to the K/V cache's need and the optimistic room, or undefined when it cannot count. Done when unit tests cover Qwen2.5-0.5B's 12,288 bytes per token, the two pods above, `fp8`, a model with `head_dim`, and each case without an estimate.
3. **The check in `open-key`.** `HuggingFace` returns the fields it reads from `config.json` with the vision tower; the launcher runs the estimate after the model's check and before `create`, and fails with the levers. Done when the launcher's tests cover a refusal with no pod created, a pass, and a model without an estimate, and `docs/settings/vllm.md#before-the-pod-is-created` has the message.
4. **The pod check.** `unfit` expects the refusal before creation, as `blocked` does. Done when its unit tests pass and a dispatch of `unfit` passes with no pod, recorded here.

## Out of scope

- Choosing the context before the pod starts: the gateway and the [cache of fits](../settings/pod-engines.md#the-cache-of-fits) keep doing it.
- Ollama, unless decision 3 says otherwise.
- Changing the GPU type the settings name.
- Speculative decoding's draft model and multimodal towers beyond `language-model-only`: their memory is not estimated; a pod with them starts as today.
