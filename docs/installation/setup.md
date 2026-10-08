# Installation

Setting up Codeman on a repository takes five parts: a GitHub App, an OpenRouter account, credentials in the repository or organization, a backend where Codeman records its runs, and a workflow. To serve models on your own rented GPUs instead of OpenRouter, see [self-hosted inference on Runpod](runpod.md). Before the first task, go through the [security checklist](../security/overview.md#checklist).

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
| Secret | `CODEMAN_OPENROUTER_MANAGEMENT_KEY` | The OpenRouter management key; not needed when neither the settings nor a [profile](profiles.md) use the `openrouter` provider |
| Secret | `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET` | A random value of at least 32 characters |
| Secret | `CODEMAN_RUNPOD_API_KEY` | The `runpod-pod` and `runpod-serverless` providers only, in the settings or a profile: the Runpod account's API key |
| Secret | `CODEMAN_RUNPOD_SERVERLESS_KEY` | The `runpod-serverless` provider only: a key restricted to the endpoint |
| Variable | `CODEMAN_SETTINGS` | Optional, in the organization: settings its repositories share; see [shared settings](shared-settings.md) |
| Variable | `CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER`, `CODEMAN_SERVICE_ACCOUNT` | The backend; see [the next part](#4-set-up-the-backend) |

Generate the encryption secret with:

```sh
openssl rand -base64 32
```

It encrypts each task key, or self-hosted run token, while it travels from the job that creates it to the agent job; see [OpenRouter](../inference/openrouter.md). Self-hosted inference needs it too.

## 4. Set up the backend

Codeman records each run, what it cost and what its jobs did, in [Cloud Firestore](https://firebase.google.com/docs/firestore), in a Firebase project of its own; see [backend](../backend/backend.md). Its jobs reach it as a service account, with the OIDC token GitHub gives each job, so no key is stored anywhere. One project serves every repository of the organization, and several organizations if you like. The backend is required: without its variables, every run fails in `select`, saying which to set.

Firestore's free quota covers Codeman's use by far ([cost](../backend/backend.md)), so the project needs no billing account. You need a Google account; the commands below run in [Cloud Shell](https://shell.cloud.google.com), which has `gcloud`, or anywhere `gcloud` is installed.

1. **Create the project.** In the [Firebase console](https://console.firebase.google.com), **Create a project**, named for instance `codeman-ops`; Google Analytics is not needed. Note its **project ID** (Project settings), which may differ from its name.
2. **Create the database.** Under **Build → Firestore Database**, **Create database**: **Standard edition**, the database ID `(default)`, a location near GitHub's runners (such as `nam5` or `us-east1`; it cannot be changed later), and **production mode**.
3. **Publish the rules.** Under **Firestore Database → Rules**, replace the rules with the contents of [`firebase/firestore.rules`](../../firebase/firestore.rules), at the commit you pin, and **Publish**. They deny every client: only Codeman's service account, which the rules do not apply to, reaches the data.
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

   - The condition uses the organization's ID, not its name, which someone else could take if the organization were renamed or deleted ([Google's advice](../web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md#github-actions-1)). A user account has an ID too: `gh api users/<login> --jq .id`.
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

1. Copy [`templates/codeman.yml`](../../templates/codeman.yml) to `.github/workflows/codeman.yml` in the target repository, and [`templates/codeman-task.yml`](../../templates/codeman-task.yml), which runs each task's jobs, to `.github/workflows/codeman-task.yml`.
2. Replace every `COMMIT_SHA` in both with a full commit SHA of this repository. If you copy `codeman.yml` under another name, change the backend's [attribute condition](#4-set-up-the-backend) to match it. Pin a SHA, not a branch or tag, so the code that runs cannot change without a review.
3. If the agent needs tools that the runner image lacks, set them up in the `agent` job of `codeman-task.yml`, where the template marks the place (for example `actions/setup-node`). Tools installed inside the runner's home, such as Rust through `rustup`, are out of the agent's reach; install them system-wide instead. Add only steps that install tools: a step that runs repository code, such as `npm ci`, runs code the agent wrote outside its sandbox, where it can read the job's secrets. See [security](../security/risks.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox).
4. Copy [`templates/settings.yml`](../../templates/settings.yml) to `.codeman/settings.yml` and choose the model, unless the organization's [shared settings](shared-settings.md) choose it. See [settings](../settings/reference.md) for every value.
5. Optionally, add a `.codemanignore` with the paths the agent may not change; see [change policy](../runs/changes.md#change-policy). Without one, Codeman uses its own rules and proposes them in its first pull request. Those rules keep the agent out of `.github/`, including workflows; see [on-demand workflows](../runs/changes.md#on-demand-workflows) to allow them.
6. Create a `codeman` label in the target repository.

Codeman reads `.codeman/settings.yml` and `.codemanignore` from the default branch. A manual run (**Actions → Codeman → Run workflow**) can override the model and the budgets for that run.

The agent job needs a Linux runner (x64 or arm64).

A run works on one task by default. `parallel-tasks: 2` (up to 10) in `.codeman/settings.yml` lets a run work on that many at once, each with its own key and agent; the run ends when its slowest task does. On OpenRouter, it only finishes tasks sooner: each pays for its own tokens. On pods, tasks with the same pod settings share one pod and split its cost by the second, as tasks of other runs and repositories do, once the pod image supports it (see [pods](runpod.md#pods)); on Serverless, each task counts the worker time its requests used, and time that tasks of any of the organization's repositories used the worker at once is split among them as they close (a run's own limit still counts it whole while it runs; see [Serverless](../inference/serverless.md)). The budgets hold across them: each run's limit is reserved in Codeman's ledger before it opens, so tasks that open at once never pass a budget together; see [budget](../budget/budget.md).

## Try it

1. As a maintainer, open an issue that leaves something to decide, and label it `codeman`. Codeman works only on issues that maintainers open. To choose settings for this task, add lines such as `/codeman model <id>` or `/codeman set task-budget 5` to the description; see [commands](../tasks/commands.md).
2. Run the workflow manually. Codeman posts a status comment, writes a plan on the branch `codeman/<issue>-<slug>`, and lists its decisions in a comment of their own.
3. Answer in a comment, for example `/codeman decide 1 a` or `/codeman approve`. The comment starts a new run, which records the answers. When none is pending, the issue gets `codeman:ready`.
4. Codeman starts the next run right away, and the stages follow one run each: routing, then the routed stages it chose among web, design, code and test, and review. After code, a draft pull request that closes the issue appears. When review passes, the pull request is ready for review and the issue gets `codeman:done`. Unfinished work is committed, and the following run continues it.
5. Review the pull request. A review that requests changes, or a `/codeman fix <what to change>` comment, starts a run that pushes the changes to the same branch.
