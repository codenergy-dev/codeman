# Installation

Setting up Codeman on a repository takes five parts: a GitHub App, an OpenRouter account, credentials in the repository or organization, a backend where Codeman records its runs, and a workflow. To serve models on your own rented GPUs instead of OpenRouter, see [self-hosted inference on Runpod](#self-hosted-inference-on-runpod). Before the first task, go through the [security checklist](security.md#checklist).

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
| Secret | `CODEMAN_OPENROUTER_MANAGEMENT_KEY` | The OpenRouter management key; not needed when neither the settings nor an [inference profile](#inference-profiles) use OpenRouter |
| Secret | `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET` | A random value of at least 32 characters |
| Secret | `CODEMAN_RUNPOD_API_KEY` | Self-hosted inference only, in the settings or a profile: the Runpod account's API key |
| Secret | `CODEMAN_RUNPOD_SERVERLESS_KEY` | Self-hosted inference on Serverless only: a key restricted to the endpoint |
| Variable | `CODEMAN_SETTINGS` | Optional, in the organization: settings its repositories share; see [shared settings](#shared-settings) |
| Variable | `CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER`, `CODEMAN_SERVICE_ACCOUNT` | The backend; see [the next part](#4-set-up-the-backend) |

Generate the encryption secret with:

```sh
openssl rand -base64 32
```

It encrypts each task key, or self-hosted run token, while it travels from the job that creates it to the agent job; see [architecture](architecture.md#budget). Self-hosted inference needs it too.

## 4. Set up the backend

Codeman records each run, what it cost and what its jobs did, in [Cloud Firestore](https://firebase.google.com/docs/firestore), in a Firebase project of its own; see [architecture](architecture.md#backend). Its jobs reach it as a service account, with the OIDC token GitHub gives each job, so no key is stored anywhere. One project serves every repository of the organization, and several organizations if you like. The backend is required: without its variables, every run fails in `select`, saying which to set.

Firestore's free quota (50,000 reads and 20,000 writes a day) covers Codeman's use by far, so the project needs no billing account. You need a Google account; the commands below run in [Cloud Shell](https://shell.cloud.google.com), which has `gcloud`, or anywhere `gcloud` is installed.

1. **Create the project.** In the [Firebase console](https://console.firebase.google.com), **Create a project**, named for instance `codeman-ops`; Google Analytics is not needed. Note its **project ID** (Project settings), which may differ from its name.
2. **Create the database.** Under **Build → Firestore Database**, **Create database**: **Standard edition**, the database ID `(default)`, a location near GitHub's runners (such as `nam5` or `us-east1`; it cannot be changed later), and **production mode**.
3. **Publish the rules.** Under **Firestore Database → Rules**, replace the rules with the contents of [`firebase/firestore.rules`](../firebase/firestore.rules), at the commit you pin, and **Publish**. They deny every client: only Codeman's service account, which the rules do not apply to, reaches the data.
4. **Enable the APIs** that Workload Identity Federation uses, and **create the service account**, with the role that reads and writes Firestore's documents (Cloud Datastore User) and nothing else:

   ```sh
   PROJECT_ID=codeman-ops   # the project ID
   gcloud services enable iam.googleapis.com sts.googleapis.com iamcredentials.googleapis.com \
     --project="$PROJECT_ID"
   gcloud iam service-accounts create codeman --project="$PROJECT_ID" --display-name="Codeman"
   gcloud projects add-iam-policy-binding "$PROJECT_ID" --role=roles/datastore.user \
     --member="serviceAccount:codeman@$PROJECT_ID.iam.gserviceaccount.com"
   ```

5. **Create the Workload Identity pool and provider**, which admit GitHub's OIDC tokens of your organization's repositories, from Codeman's workflow on their default branch only:

   ```sh
   ORG_ID=123456789   # your organization's numeric ID: gh api orgs/<organization> --jq .id
   gcloud iam workload-identity-pools create codeman --project="$PROJECT_ID" \
     --location=global --display-name="Codeman"
   gcloud iam workload-identity-pools providers create-oidc github --project="$PROJECT_ID" \
     --location=global --workload-identity-pool=codeman --display-name="GitHub" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner_id=assertion.repository_owner_id,attribute.workflow_ref=assertion.workflow_ref" \
     --attribute-condition="assertion.repository_owner_id == '$ORG_ID' && assertion.workflow_ref == assertion.repository + '/.github/workflows/codeman.yml@refs/heads/main'"
   ```

   - The condition uses the organization's ID, not its name, which someone else could take if the organization were renamed or deleted ([Google's advice](web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md#github-actions-1)). A user account has an ID too: `gh api users/<login> --jq .id`.
   - `workflow_ref` names the workflow that runs the job, the caller's for the jobs of `codeman-task.yml`, at its branch: only `codeman.yml` on `main` gets in, which only a reviewed pull request changes. No other workflow of your repositories can reach the backend, not even one that runs code the agent wrote on a task branch. If your default branch has another name, change `main`.
   - For several organizations, use `assertion.repository_owner_id in ['<ID>', '<ID>']`.

6. **Let the pool's identities act as the service account:**

   ```sh
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding \
     "codeman@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/codeman/*"
   echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/codeman/providers/github"
   ```

7. **Add the variables**, in the organization (visible to the repositories that use Codeman) or in each repository. They are not secrets.

   | Variable | Value |
   | --- | --- |
   | `CODEMAN_FIREBASE_PROJECT` | The project ID, such as `codeman-ops` |
   | `CODEMAN_WORKLOAD_IDENTITY_PROVIDER` | What the last command printed: `projects/<project number>/locations/global/workloadIdentityPools/codeman/providers/github` |
   | `CODEMAN_SERVICE_ACCOUNT` | `codeman@<project ID>.iam.gserviceaccount.com` |

   On GitHub Free, private repositories cannot read organization variables: add them to each repository.

The workflow templates pass these variables to the jobs that record runs, and give those jobs, and only those, the `id-token: write` permission. The first run that finds a task writes the first documents: **Firestore Database → Data** shows `organizations/<owner>/runs` and `events`.

## 5. Add the workflow and settings

1. Copy [`templates/codeman.yml`](../templates/codeman.yml) to `.github/workflows/codeman.yml` in the target repository, and [`templates/codeman-task.yml`](../templates/codeman-task.yml), which runs each task's jobs, to `.github/workflows/codeman-task.yml`.
2. Replace every `COMMIT_SHA` in both with a full commit SHA of this repository. If you copy `codeman.yml` under another name, change the backend's [attribute condition](#4-set-up-the-backend) to match it. Pin a SHA, not a branch or tag, so the code that runs cannot change without a review.
3. If the agent needs tools that the runner image lacks, set them up in the `agent` job of `codeman-task.yml`, where the template marks the place (for example `actions/setup-node`). Tools installed inside the runner's home, such as Rust through `rustup`, are out of the agent's reach; install them system-wide instead. Add only steps that install tools: a step that runs repository code, such as `npm ci`, runs code the agent wrote outside its sandbox, where it can read the job's secrets. See [security](security.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox).
4. Copy [`templates/settings.yml`](../templates/settings.yml) to `.codeman/settings.yml` and choose the model, unless the organization's [shared settings](#shared-settings) choose it. See [settings](architecture.md#settings) for every value.
5. Optionally, add a `.codemanignore` with the paths the agent may not change; see [change policy](architecture.md#change-policy). Without one, Codeman uses its own rules and proposes them in its first pull request. Those rules keep the agent out of `.github/`, including workflows; see [on-demand workflows](architecture.md#on-demand-workflows) to allow them.
6. Create a `codeman` label in the target repository.

Codeman reads `.codeman/settings.yml` and `.codemanignore` from the default branch. A manual run (**Actions → Codeman → Run workflow**) can override the model and the budgets for that run.

The agent job needs a Linux runner (x64 or arm64).

To update workflow files copied before the backend, copy both templates again, and move any steps you added to the `agent` job into the new `codeman-task.yml`: the jobs that record runs need their new permissions, variables and the run's ID in the ledger. Older workflow files fail in `select`, before they mark any task, since they pass none of the backend's variables. Workflow files copied before the budgets came from the ledger pass neither the organization's monthly budget nor the task's spend from `close-key` to `apply`: copy both templates again, too.

A run works on one task by default. `parallel-tasks: 2` (up to 10) in `.codeman/settings.yml` lets a run work on that many at once, each with its own key and agent; the run ends when its slowest task does. On OpenRouter, it only finishes tasks sooner: each pays for its own tokens. On pods, the run's tasks with the same pod settings share one pod and split its cost by the second, once the pod image supports it (see [pods](#pods)); on Serverless, each task counts the worker time its requests used, so time two tasks share counts for each. The budgets hold across them: each run's limit is reserved in Codeman's ledger before it opens, so tasks that open at once never pass a budget together; see [budget](architecture.md#budget).

### Shared settings

An organization can give the repositories that use Codeman the same settings, such as the model and the budgets, instead of repeating them in each `.codeman/settings.yml`:

1. As an organization owner, under the organization's **Settings → Secrets and variables → Actions → Variables**, create a variable named `CODEMAN_SETTINGS`. Its value has the format of `.codeman/settings.yml`:

   ```yaml
   model: deepseek/deepseek-v4.1-flash
   task-budget: 1
   monthly-budget: 50
   organization-monthly-budget: 120
   ```

2. Under **Repository access**, choose the repositories that use Codeman.
3. Check that each repository's workflow passes the variable to the `select` step, as the template does: `settings: ${{ vars.CODEMAN_SETTINGS }}`. Workflow files copied before that line existed ignore the variable.

These are defaults: a value in a repository's `.codeman/settings.yml` overrides the organization's, and a manual run's inputs and a task's commands come before both; see [settings](architecture.md#settings). The `select` job's log names where each value came from. A malformed variable stops every run of those repositories, with an error that names the `settings` input.

`organization-monthly-budget` is the exception: only this variable sets it. It limits what all the organization's repositories spend in a calendar month together, every provider included, with the Runpod account's whole billing; without it, only each repository's `monthly-budget` holds. A repository's `.codeman/settings.yml` that sets it stops its runs with an error. See [budget](architecture.md#budget).

- On GitHub Free, private repositories cannot read organization variables.
- A repository variable named `CODEMAN_SETTINGS` replaces the organization's whole, not value by value: GitHub gives the repository's variable precedence. Use `.codeman/settings.yml` to override single values.
- A variable holds at most 48 KB.
- The variable is plain text, shown in the logs. Never put secrets in it; see [security](security.md#secrets).

## Self-hosted inference on Runpod

Instead of OpenRouter, Codeman can serve the model itself on GPUs rented from [Runpod](https://www.runpod.io): on a pod it creates for the task (`gpu-mode: pod`), or on the workers of a Serverless endpoint you create (`gpu-mode: serverless`). See [architecture](architecture.md#self-hosted-inference) for how it works, what it costs and [which to choose](architecture.md#choosing), and [security](security.md) for the secrets. OpenRouter's management key is not needed then, unless an [inference profile](#inference-profiles) uses OpenRouter; the encryption secret still is.

### The account

1. Create a Runpod account, or a team, for Codeman only, shared by the organization's repositories: with `organization-monthly-budget`, the whole account's billing counts in the organization's month. Each repository's `monthly-budget` counts its own runs, as Codeman's ledger estimates them.
2. Add prepaid credits, about the organization's monthly budget, and leave auto-pay off. At a balance of US$ 0, Runpod stops every pod, so the credits cap what Codeman can spend there.
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

   Shared pods (`parallel-tasks` above 1) need an image whose gateway serves several runs at once, built from Codeman's code since shared pods. The image pinned before them serves one run at a time, and Codeman gives each task a pod of its own on it, as it does with any image whose gateway reports no such support ([shared pods](architecture.md#shared-pods)).

### Serverless

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
   inference: self-hosted
   gpu-mode: serverless
   serverless-endpoint: <the endpoint's ID>
   model: Qwen/Qwen3-Coder-30B-A3B-Instruct   # what the worker serves
   ```

Codeman checks the endpoint before each run and reports what to change. After 7 days without requests, Runpod sets its max workers to 0; set it back to 1, or runs fail after 25 minutes without a worker.

## Inference profiles

A repository can use different inference for different runs, such as OpenRouter's strongest model to plan and route, and a pod for the stages that write and test code. Add a list of profiles to `.codeman/settings.yml` (or to the organization's [shared settings](#shared-settings)); the top-level settings apply where no profile does:

```yaml
model: anthropic/claude-sonnet-4.5     # the default: OpenRouter
inference-profiles:
  - name: small-pod
    when:
      stages: [code, test]
    inference: self-hosted
    gpu-type: NVIDIA RTX A6000
    model: qwen3-coder:30b
  - name: cheap-review
    when:
      stages: [review]
    model: deepseek/deepseek-v4.1-flash
```

1. Give each profile a `name`, and under `when` the `stages` it is for: `plan`, `route`, `web`, `design`, `code`, `test` or `review`. A profile without `when` applies to every run, so put it last. (`parallel-tasks` is for when a run works on several tasks at once, which is not available yet.)
2. Put in each profile only what changes: `model` and the inference settings (`inference`, `gpu-provider`, `gpu-mode`, `gpu-type`, `engine`, `serverless-endpoint`, `pod-reuse`). Everything else, budgets included, stays at the top level and applies to every run.
3. Order them: the first profile whose conditions hold applies.
4. Add the secrets of every provider the settings and profiles name: a run needs its own provider's, and with `organization-monthly-budget`, every run reads the billing of each GPU provider named, so a run on OpenRouter needs the Runpod key too. Without one, runs stop, and the task's panel names the missing secret.

Each profile must work over the top-level settings: a profile on pods needs a `gpu-type`, here or at the top level. A mistake stops the next run, with an error that names the line or the profile. The `select` job's log names the profile of each run, and the spend table shows each run's model and provider. A task's `/codeman set model` wins over any profile, in the runs whose inference it fits. A repository whose file has `inference-profiles` replaces the organization's list whole; `inference-profiles: []` removes it. See [settings](architecture.md#inference-profiles).

## Try it

1. As a maintainer, open an issue that leaves something to decide, and label it `codeman`. Codeman works only on issues that maintainers open. To choose settings for this task, add lines such as `/codeman model <id>` or `/codeman set task-budget 5` to the description; see [commands](architecture.md#commands).
2. Run the workflow manually. Codeman posts a status comment, writes a plan on the branch `codeman/<issue>-<slug>`, and lists its decisions in a comment of their own.
3. Answer in a comment, for example `/codeman decide 1 a` or `/codeman approve`. The comment starts a new run, which records the answers. When none is pending, the issue gets `codeman:ready`.
4. Codeman starts the next run right away, and the stages follow one run each: design, code, test and review. After code, a draft pull request that closes the issue appears. When review passes, the pull request is ready for review and the issue gets `codeman:done`. Unfinished work is committed, and the following run continues it.
5. Review the pull request. A review that requests changes, or a `/codeman fix <what to change>` comment, starts a run that pushes the changes to the same branch.
