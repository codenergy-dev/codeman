# Self-hosted inference on Runpod

Instead of OpenRouter, Codeman can serve the model itself on GPUs rented from [Runpod](https://www.runpod.io): on a pod it creates for the task (`provider: runpod-pod`), or on the workers of a Serverless endpoint you create (`provider: runpod-serverless`). Each provider takes its own settings ([providers](../settings/providers.md)). See [self-hosted inference](../inference/self-hosted.md) for how it works, what it costs and [which to choose](../inference/self-hosted.md#choosing), and [security](../security/secrets.md) for the secrets. OpenRouter's management key is not needed then, unless a [profile](profiles.md) uses OpenRouter; the encryption secret still is.

## The account

1. Create a Runpod account, or a team, for Codeman only, shared by the organization's repositories: with `organization-monthly-budget`, the whole account's billing counts in the organization's month. Each repository's `monthly-budget` counts its own runs, as Codeman's ledger estimates them.
2. Add prepaid credits, about the organization's monthly budget, and leave auto-pay off. At a balance of US$ 0, Runpod stops every pod, so the credits cap what Codeman can spend there.
3. Create an API key on the console's **Credentials** page, **API Keys** tab, with **All** permissions (pods and billing need it), and add it as the secret `CODEMAN_RUNPOD_API_KEY`. Only the key jobs of the workflow receive it.

## Pods

1. In `.codeman/settings.yml`:

   ```yaml
   provider: runpod-pod
   model: qwen3-coder:30b        # an Ollama model name
   gpu: "NVIDIA RTX A6000"       # the GPU ID, quoted; on Secure Cloud
   ```

   `gpu` is the GPU ID in [Runpod's list of GPU types](https://docs.runpod.io/references/gpu-types) (first column), not its display name: `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb`, not `PRO 6000 MIG 48GB`. Choose a GPU with enough memory for the model at its full context length: Codeman loads it with the context length the model supports.
2. Codeman runs its own pod image, `ghcr.io/codenergy-dev/codeman-pod`, public and pinned by digest in the version you use (`POD_IMAGE` in `src/inference/ollama.ts`); there is nothing to set up. To run an image of your own, set `pod-image: <image>@sha256:<digest>` on the `open-key` step.

   The organization's tasks with the same pod settings (model, `gpu`, image and `pod-reuse`), in any of its repositories, share one pod, and a pod kept after a run serves the next run on its settings ([shared pods](../inference/pods.md#shared-pods)). That needs an image whose gateway serves several runs at once, built from Codeman's code since shared pods. The image pinned before them serves one run at a time, and Codeman gives each task a pod of its own on it; an image of your own must serve several runs, or be listed in `SINGLE_RUN_IMAGES`, or its runs fail.
3. Codeman keeps its pods in the [backend](setup.md#4-set-up-the-backend), and terminates the pods of the Runpod account that carry the organization's environment (`CODEMAN_ORGANIZATION`, or `CODEMAN_REPOSITORY` of one of its repositories) and that its registry does not hold. Create other pods of the account without those variables, or in another account; Codeman never touches them.

## Serverless

1. In Runpod's console, create a Serverless endpoint from the vLLM worker, pinned to a release (`runpod/worker-v1-vllm:<version>`), queue-based:
   - **Active workers:** 0. **Max workers:** 1. **FlashBoot:** on.
   - **Idle timeout:** 300 seconds, the most Codeman accepts. The agent pauses between requests while its tools run, such as the repository's tests; a worker that stops in a pause makes the next request wait for a new start, which is billed too.
   - **Model:** the same model as `MODEL_NAME`, so Runpod caches it ([cached models](https://docs.runpod.io/serverless/endpoints/model-caching)): workers start on hosts that already hold it, and its download is not billed. Without it, every start downloads the model again, and **Container disk** must hold it whole. A gated or private model also needs a Hugging Face token.
   - Data centers on Secure Cloud.
   - **CUDA versions:** 13.0 and newer, the CUDA of the worker's image (v2.28.0). On a host whose driver is older, every start fails with CUDA's error 804 and the worker restarts in a loop.
   - Environment: `MODEL_NAME` (the Hugging Face model), `MAX_MODEL_LEN`, `ENABLE_AUTO_TOOL_CHOICE=true` and the `TOOL_CALL_PARSER` that matches the model, which the agent's tool calls need.

   A request waits in the endpoint's queue until a worker serves it, and Codeman cancels the jobs the agent no longer waits for. A run counts the time a worker runs, which the endpoint's `/health` tells, so a wait without a worker costs nothing; but when no worker initializes or runs for 25 minutes while a request waits, as when no GPU of the endpoint's types is free, the run fails. Starts still cost the run time: a cached model saves the download, but vLLM's own start remains, 2.5 minutes for a 27B model on 2× RTX 5090, compilation included. If the agent makes no progress, look at the endpoint's workers and logs in Runpod's console.
2. Create an API key with **Restricted** permissions and access to this endpoint only, and add it as the secret `CODEMAN_RUNPOD_SERVERLESS_KEY`. Only Codeman's step in the agent job receives it, outside the sandbox.
3. In `.codeman/settings.yml`:

   ```yaml
   provider: runpod-serverless
   endpoint: <the endpoint's ID, or its URL from the console>
   model: Qwen/Qwen3-Coder-30B-A3B-Instruct   # what the worker serves
   ```

   `endpoint` takes the endpoint's ID, or a URL of it as Runpod's console shows it, such as `https://api.runpod.ai/v2/<id>/run`, from which Codeman takes the ID. A URL on another host is an error.

Codeman checks the endpoint before each run and reports what to change. After 7 days without requests, Runpod sets its max workers to 0; set it back to 1, or runs fail after 25 minutes without a worker.
