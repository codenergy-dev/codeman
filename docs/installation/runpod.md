# Self-hosted inference on Runpod

Instead of OpenRouter, Codeman can serve the model itself on GPUs rented from [Runpod](https://www.runpod.io). This page sets up either [inference provider](../glossary.md#inference-provider):

- `runpod-pod`: a [pod](../glossary.md#pod) Codeman creates for the task;
- `runpod-serverless`: the workers of a Serverless endpoint you create.

Each provider takes its own settings ([providers](../settings/providers.md)). How they work and what they cost are in [self-hosted inference](../inference/self-hosted.md), with [which to choose](../inference/self-hosted.md#choosing).

You need:

- a Codeman installation with its [backend](setup.md#4-set-up-the-backend);
- a Runpod account or team for Codeman only, with prepaid credits ([the account](#the-account));
- the secret `CODEMAN_RUNPOD_API_KEY`, the account's key;
- for Serverless, the secret `CODEMAN_RUNPOD_SERVERLESS_KEY`, the endpoint's key;
- the encryption secret, `CODEMAN_KEY_ENCRYPTION_SECRET`, as with OpenRouter.

OpenRouter's management key is not needed then, unless a [profile](mixing-providers.md) uses OpenRouter. Where each secret goes is in [secrets](../security/secrets.md#where-each-credential-goes).

## The account

1. **Create a Runpod account, or a team, for Codeman only.** The organization's repositories share it, or those of the organizations of its [pool](../glossary.md#pool-of-organizations) ([pools](../runs/batches.md#pools)).
   - With `organization-monthly-budget`, the whole account's billing counts in the organization's month. With a pool, it is split among its organizations' months ([spend](../budget/spend.md#self-hosted-runs)).
   - Each repository's `monthly-budget` counts its own runs, as Codeman's ledger estimates them.
2. **Add prepaid credits**, about the organization's monthly budget, and leave auto-pay off. At a balance of US$ 0, Runpod stops every pod, so the credits cap what Codeman can spend there.
3. **Create an API key** on the console's **Credentials** page, **API Keys** tab, with **All** permissions, which pods and billing need. Add it as the secret `CODEMAN_RUNPOD_API_KEY`. Only the workflow's `open-key`, `close-key` and `release-pod` jobs receive it, the [key jobs](../glossary.md#key-jobs).

## Pods

1. **Choose a GPU.** In `.codeman/settings.yml`:

   ```yaml
   provider: runpod-pod
   model: qwen3-coder:30b        # an Ollama model name
   gpu: "NVIDIA RTX A6000"       # the GPU ID, on Secure Cloud
   ```

   - `gpu` is the GPU ID in [Runpod's list of GPU types](https://docs.runpod.io/references/gpu-types) (first column), not its display name ([what Codeman relies on](../web/runpod/gpu-types.md)). For example, `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb`, not `PRO 6000 MIG 48GB`.
   - Quoting the ID is optional.
   - Choose a GPU with enough memory for the model and its cache. The pod serves as many requests at once as the profile's tasks, with the largest context that fits the GPU, from 64000 tokens up to the model's own. It fails to start, saying what to change, when the model does not fit wholly on the GPU even with 64000 ([context and the GPU](../settings/pod-engines.md#context-and-the-gpu)).

   Result: the run's tasks get a pod with that GPU.

2. **Choose an [engine](../glossary.md#engine).** Ollama is the default. vLLM batches the requests of the tasks that share a pod whatever the model, but needs a host with CUDA 13.0 or newer and starts in about 6 to 9 minutes for a 27B model. [Choosing an engine](../settings/pod-engines.md#choosing-an-engine) compares them.
   - To tune Ollama, such as a fixed context length, or fewer requests at once than the profile's tasks, add an `ollama:` block, with keys on indented lines ([Ollama settings](../settings/ollama.md)):

     ```yaml
     ollama:
       num-parallel: 4          # four requests at once
       context-length: 65536    # per request; memory grows with both
     ```

   - To serve with vLLM, set `engine: vllm`, the Hugging Face ID of a public model with safetensors weights, and a `vllm:` block with at least the model's `tool-call-parser` ([vLLM settings](../settings/vllm.md)):

     ```yaml
     engine: vllm
     model: unsloth/Qwen3.8-27B-NVFP4
     vllm:
       tool-call-parser: qwen3_xml
       reasoning-parser: qwen3
     ```

   Only the documented keys are accepted. A typo, or a key Codeman controls such as `host`, stops the run with an error before any pod is created. With vLLM, Codeman also stops the run before creating a pod when Runpod offers no host of the GPU type with CUDA 13.0 or newer, or none has room ([CUDA](../settings/vllm.md#cuda)).

3. **Pod images: nothing to set up.** Codeman runs its own images, one per engine, public and pinned by digest in the version you use ([pod images](../settings/pod-engines.md#pod-images)).
   - To run an Ollama image of your own, set `pod-image: <image>@sha256:<digest>` on the `open-key` step. It must serve several runs at once and apply Ollama settings ([older images](../inference/pods.md#shared-pods), [Ollama's pod images](../settings/ollama.md#pod-images)).
   - vLLM pods always run Codeman's image.
   - A version that pins no image for an engine stops that engine's runs before any pod is created.

4. **Keep the account's other pods apart.** Codeman keeps its pods in the backend's registry, and terminates as orphans the account's pods of its pool that the registry does not hold ([pods](../inference/pods.md)).
   - It never touches a pod without Codeman's `CODEMAN_*` environment, nor another pool's pod that another organization created.
   - Create other pods of the account without those variables, or in another account.

The tasks with the same [pod settings](../glossary.md#pod-settings), in any repository of the organization or its pool, share one pod, up to its parallel requests. A pod kept after a run serves the next run on its settings ([shared pods](../inference/pods.md#shared-pods)).

## Serverless

1. **Create the endpoint.** In Runpod's console, create a Serverless endpoint from the vLLM worker, with these fields:

   | Field | Value | Why |
   | --- | --- | --- |
   | Worker | The vLLM worker, pinned to a release (`runpod/worker-v1-vllm:<version>`) | A known version |
   | Type | Queue-based | Codeman refuses other endpoints |
   | **Active workers** | 0 | Codeman refuses workers billed all the time |
   | **Max workers** | 1 | Codeman refuses any other number |
   | **FlashBoot** | On | Faster starts |
   | **Idle timeout** | 300 seconds, the most Codeman accepts | The agent pauses between requests while its tools run, such as the repository's tests. A worker that stops in a pause makes the next request wait for a new start, which is billed too |
   | **Model** | The same model as `MODEL_NAME` | Runpod caches it ([cached models](https://docs.runpod.io/serverless/endpoints/model-caching)): workers start on hosts that already hold it, and its download is not billed |
   | **Container disk** | Large enough for the whole model, when **Model** is not set | Without a cached model, every start downloads the model again, onto this disk |
   | Data centers | Secure Cloud | Runpod's API does not tell Codeman, so it cannot check it |
   | **CUDA versions** | 13.0 and newer | The CUDA of the worker's image (v2.28.0). On a host whose driver is older, every start fails with CUDA's error 804, and the worker restarts in a loop |
   | Environment | `MODEL_NAME` (the Hugging Face model), `MAX_MODEL_LEN`, `ENABLE_AUTO_TOOL_CHOICE=true`, and the `TOOL_CALL_PARSER` that matches the model | The agent's tool calls need them |

   A gated or private model also needs a Hugging Face token. Starts still cost the run time: a cached model saves the download, but vLLM's own start remains, 2.5 minutes for a 27B model on 2× RTX 5090, compilation included.

2. **Create its key.** Create an API key with **Restricted** permissions and access to this endpoint only. Add it as the secret `CODEMAN_RUNPOD_SERVERLESS_KEY`. Only Codeman's step in the agent job receives it, outside the sandbox.

3. **Set the settings.** In `.codeman/settings.yml`:

   ```yaml
   provider: runpod-serverless
   endpoint: <the endpoint's ID, or its URL from the console>
   model: Qwen/Qwen3-Coder-30B-A3B-Instruct   # what the worker serves
   ```

   `endpoint` takes the endpoint's ID, or a URL of it as Runpod's console shows it, such as `https://api.runpod.ai/v2/<id>/run`, from which Codeman takes the ID. A URL on another host is an error.

Codeman checks the endpoint before each run, and reports what to change. How a run queues its requests, counts the worker's time and fails without a worker is in [Serverless](../inference/serverless.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "No pod image is pinned; see docs/installation/runpod.md#pods." | The version of Codeman pins no Ollama image, and the `open-key` step has no `pod-image` | Use a version of Codeman that pins one, or set `pod-image` ([pod images](../settings/pod-engines.md#pod-images)) |
| "This version of Codeman pins no vLLM pod image yet …" | The version pins no vLLM image | Use a version that pins one, or `engine: ollama` ([vLLM's pod images](../settings/vllm.md#pod-images)) |
| "Runpod offers no host with `<gpu>` and CUDA 13.0 or newer …", or "No host … has room now …" | vLLM needs CUDA 13.0 or newer | Use another GPU type, try again later, or use `engine: ollama` ([CUDA](../settings/vllm.md#cuda)) |
| "`<model>` does not fit the GPU …" | The model and its cache do not fit wholly on the GPU | Fewer parallel requests, a quantized cache, or a GPU with more memory ([context and the GPU](../settings/pod-engines.md#context-and-the-gpu)) |
| Every pod stops | The account's balance reached US$ 0 | Add credits |
| "Serverless endpoint `<id>` cannot serve this run: …" | An endpoint field differs from the table above | Change the field the message names |
| "… its max workers is 0, as the provider sets it after 7 days without requests; set it to 1" | Runpod set max workers to 0 after 7 days without requests | Set **Max workers** back to 1 |
| A Serverless run fails after 25 minutes without a worker | No worker initialized or ran while a request waited, as when no GPU of the endpoint's types is free, or when max workers is 0 | Check the endpoint's GPU types and max workers |
| The worker restarts in a loop, with CUDA's error 804 | A host whose driver is older than CUDA 13.0 | Set **CUDA versions** to 13.0 and newer |
| The agent makes no progress on Serverless | The worker is starting, failing or busy | Look at the endpoint's workers and logs in Runpod's console |
