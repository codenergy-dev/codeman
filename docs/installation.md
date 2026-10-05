# Installation

Setting up Codeman on a repository takes four parts: a GitHub App, an OpenRouter account, credentials in the repository or organization, and a workflow. To serve models on your own rented GPUs instead of OpenRouter, see [self-hosted inference on Runpod](#self-hosted-inference-on-runpod). Before the first task, go through the [security checklist](security.md#checklist).

## 1. Register the GitHub App

Codeman acts as a GitHub App, not with the workflow's `GITHUB_TOKEN`. The `GITHUB_TOKEN` cannot push changes under `.github/workflows/`, and events it creates do not trigger other workflows.

Register one App per owner (user or organization) under **Settings → Developer settings → GitHub Apps → New GitHub App**:

- **Webhook:** disabled. Codeman runs from workflows, not webhooks.
- **Repository permissions:**
  - Contents: read and write
  - Issues: read and write
  - Pull requests: read and write
  - Workflows: read and write
  - Actions: read-only
  - Metadata: read-only (mandatory)
- **Where can this GitHub App be installed:** only on this account.

After creating it:

1. Note the **Client ID**.
2. Generate a **private key** and download it. Treat it as a secret: never commit it.
3. Install the App on the repositories where Codeman should run, choosing **Only select repositories**.

Each job requests a token scoped down to the permissions it needs.

## 2. Prepare OpenRouter

Codeman creates one budget-capped OpenRouter key per task. To do that it needs a **management key**, created under **Settings → Management keys** in OpenRouter.

A management key can create keys without limits, so only the two key jobs of the workflow receive it. Add credits to the account; each task key spends from them.

## 3. Add the credentials

Add these under **Settings → Secrets and variables → Actions**, either in the repository or in the organization. At organization level, make them visible only to the repositories that use Codeman.

| Type | Name | Value |
| --- | --- | --- |
| Variable | `CODEMAN_GITHUB_APP_CLIENT_ID` | The App's Client ID |
| Secret | `CODEMAN_GITHUB_APP_PRIVATE_KEY` | The full contents of the private key file |
| Secret | `CODEMAN_OPENROUTER_MANAGEMENT_KEY` | The OpenRouter management key |
| Secret | `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET` | A random value of at least 32 characters |
| Secret | `CODEMAN_RUNPOD_API_KEY` | Self-hosted inference only: the Runpod account's API key |
| Secret | `CODEMAN_RUNPOD_SERVERLESS_KEY` | Self-hosted inference on Serverless only: a key restricted to the endpoint |

Generate the encryption secret with:

```sh
openssl rand -base64 32
```

It encrypts each task key, or self-hosted run token, while it travels from the job that creates it to the agent job; see [architecture](architecture.md#budget). Self-hosted inference needs it too.

## 4. Add the workflow and settings

1. Copy [`templates/codeman.yml`](../templates/codeman.yml) to `.github/workflows/codeman.yml` in the target repository.
2. Replace every `COMMIT_SHA` with a full commit SHA of this repository. Pin a SHA, not a branch or tag, so the code that runs cannot change without a review.
3. If the agent needs tools that the runner image lacks, set them up in the `agent` job, where the template marks the place (for example `actions/setup-node`). Tools installed inside the runner's home, such as Rust through `rustup`, are out of the agent's reach; install them system-wide instead. Add only steps that install tools: a step that runs repository code, such as `npm ci`, runs code the agent wrote outside its sandbox, where it can read the job's secrets. See [security](security.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox).
4. Copy [`templates/settings.yml`](../templates/settings.yml) to `.codeman/settings.yml` and choose the model. See [settings](architecture.md#settings) for every value.
5. Optionally, add a `.codemanignore` with the paths the agent may not change; see [change policy](architecture.md#change-policy). Without one, Codeman uses its own rules and proposes them in its first pull request. Those rules keep the agent out of `.github/`, including workflows; see [on-demand workflows](architecture.md#on-demand-workflows) to allow them.
6. Create a `codeman` label in the target repository.

Codeman reads `.codeman/settings.yml` and `.codemanignore` from the default branch. A manual run (**Actions → Codeman → Run workflow**) can override the model and the budgets for that run.

The agent job needs a Linux runner (x64 or arm64).

## Self-hosted inference on Runpod

Instead of OpenRouter, Codeman can serve the model itself on GPUs rented from [Runpod](https://www.runpod.io): on a pod it creates for the task (`gpu-mode: pod`), or on the workers of a Serverless endpoint you create (`gpu-mode: serverless`). See [architecture](architecture.md#self-hosted-inference) for how it works and what it costs, and [security](security.md) for the secrets. OpenRouter's management key is not needed then; the encryption secret still is.

### The account

1. Create a Runpod account, or a team, for Codeman only: the whole account's spend this month counts against `monthly-budget`.
2. Add prepaid credits, about the monthly budget, and leave auto-pay off. At a balance of US$ 0, Runpod stops every pod, so the credits cap what Codeman can spend there.
3. Create an API key on the console's **Credentials** page, **API Keys** tab, with **All** permissions (pods and billing need it), and add it as the secret `CODEMAN_RUNPOD_API_KEY`. Only the key jobs of the workflow receive it.

### Pods

1. In `.codeman/settings.yml`:

   ```yaml
   inference: self-hosted
   model: qwen3-coder:30b        # an Ollama model name
   gpu-type: "NVIDIA RTX A6000"  # the GPU ID, quoted; on Secure Cloud
   ```

   `gpu-type` is the GPU ID in [Runpod's list of GPU types](https://docs.runpod.io/references/gpu-types) (first column), not its display name: `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb`, not `PRO 6000 MIG 48GB`. Choose a GPU with enough memory for the model at its full context length: Codeman loads it with the context length the model supports.
2. Codeman runs its own pod image, `ghcr.io/codenergy-dev/codeman-pod`, public and pinned by digest in the version you use (`POD_IMAGE` in `src/inference/ollama.ts`); there is nothing to set up. To run an image of your own, set `pod-image: <image>@sha256:<digest>` on the `open-key` step.

### Serverless

1. In Runpod's console, create a Serverless endpoint from the vLLM worker, pinned to a release (`runpod/worker-v1-vllm:<version>`), queue-based:
   - **Active workers:** 0. **Max workers:** 1. **Idle timeout:** 60 seconds or less. **FlashBoot:** on.
   - Data centers on Secure Cloud.
   - Environment: `MODEL_NAME` (the Hugging Face model), `MAX_MODEL_LEN`, `ENABLE_AUTO_TOOL_CHOICE=true` and the `TOOL_CALL_PARSER` that matches the model, which the agent's tool calls need.
2. Create an API key with **Restricted** permissions and access to this endpoint only, and add it as the secret `CODEMAN_RUNPOD_SERVERLESS_KEY`. Only Codeman's step in the agent job receives it, outside the sandbox.
3. In `.codeman/settings.yml`:

   ```yaml
   inference: self-hosted
   gpu-mode: serverless
   serverless-endpoint: <the endpoint's ID>
   model: Qwen/Qwen3-Coder-30B-A3B-Instruct   # what the worker serves
   ```

Codeman checks the endpoint before each run and reports what to change. After 7 days without requests, Runpod sets its max workers to 0; set it back to 1.

## Try it

1. As a maintainer, open an issue that leaves something to decide, and label it `codeman`. Codeman works only on issues that maintainers open. To choose settings for this task, add lines such as `/codeman model <id>` or `/codeman set task-budget 5` to the description; see [commands](architecture.md#commands).
2. Run the workflow manually. Codeman posts a status comment, writes a plan on the branch `codeman/<issue>-<slug>`, and lists its decisions in a comment of their own.
3. Answer in a comment, for example `/codeman decide 1 a` or `/codeman approve`. The comment starts a new run, which records the answers. When none is pending, the issue gets `codeman:ready`.
4. Codeman starts the next run right away, and the stages follow one run each: design, code, test and review. After code, a draft pull request that closes the issue appears. When review passes, the pull request is ready for review and the issue gets `codeman:done`. Unfinished work is committed, and the following run continues it.
5. Review the pull request. A review that requests changes, or a `/codeman fix <what to change>` comment, starts a run that pushes the changes to the same branch.
