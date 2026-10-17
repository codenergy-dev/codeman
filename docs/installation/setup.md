# Installation

Setting up Codeman on a repository takes five parts: a GitHub App, an OpenRouter account, credentials in the repository or organization, a backend where Codeman records its runs, and a workflow, which runs the commit of Codeman a variable names. To serve models on your own rented GPUs instead of OpenRouter, see [self-hosted inference on Runpod](runpod.md). Before the first task, go through the [security checklist](../security/overview.md#checklist).

## 1. Register the GitHub App

Codeman acts as a GitHub App, not with the workflow's `GITHUB_TOKEN`. The `GITHUB_TOKEN` cannot push changes under `.github/workflows/`, and events it creates do not trigger other workflows.

Register the App once, under the owner (user or organization) that runs Codeman, in **Settings → Developer settings → GitHub Apps → New GitHub App**:

- **Webhook:** disabled. Codeman runs from workflows, not webhooks.
- **Repository permissions:**
  - Contents: read and write
  - Issues: read and write
  - Pull requests: read and write
  - Workflows: read and write
  - Actions: read and write. Read for the results of workflows the agent asked for; write only in the `dispatch` job, which starts another repository's Codeman run for a [batch](../runs/batches.md#waking-the-other-repositories), with a token for that repository alone.
  - Metadata: read-only (mandatory)
- **Where can this GitHub App be installed:** only on this account, for one organization; any account, for a [pool of organizations](#a-pool-of-organizations), which then installs it by its link. Making it public does not list it in the Marketplace.

After creating it:

1. Note the **Client ID**.
2. Generate a **private key** and download it. Treat it as a secret: never commit it.
3. Install the App on the repositories where Codeman should run, choosing **Only select repositories**.

Each job requests a token scoped down to the permissions it needs.

An App created before batches has Actions read-only: change it to read and write, then approve the new permission in each installation (**Settings → GitHub Apps → Codeman → Review request**); until then, a `dispatch` leg fails, and the batch runs smaller.

## 2. Prepare OpenRouter

Codeman creates one OpenRouter key per agent run, capped at what remains of the task's budget. To do that it needs a **management key**, created under **Settings → Management keys** in OpenRouter.

A management key can create keys without limits, so only the two key jobs of the workflow receive it. Add credits to the account; each run's key spends from them.

## 3. Add the credentials

Add these under **Settings → Secrets and variables → Actions**, either in the repository or in the organization. At organization level, make them visible only to the repositories that use Codeman ([repository access](#repository-access)). On GitHub Free, private repositories cannot read organization secrets or variables ([GitHub](../web/github/using-secrets-in-github-actions.md#creating-secrets-for-an-organization)): add them to each repository.

| Type | Name | Value |
| --- | --- | --- |
| Variable | `CODEMAN_GITHUB_APP_CLIENT_ID` | The App's Client ID |
| Secret | `CODEMAN_GITHUB_APP_PRIVATE_KEY` | The full contents of the private key file |
| Secret | `CODEMAN_OPENROUTER_MANAGEMENT_KEY` | The OpenRouter management key; not needed when neither the settings nor a [profile](mixing-providers.md) use the `openrouter` provider |
| Secret | `CODEMAN_KEY_ENCRYPTION_SECRET` | A random value of at least 32 characters. It encrypts each run's key or gateway token between `open-key` and `agent`, within one workflow run, so the organizations of a pool need not share it |
| Secret | `CODEMAN_RUNPOD_API_KEY` | The `runpod-pod` and `runpod-serverless` providers only, in the settings or a profile: the Runpod account's API key |
| Secret | `CODEMAN_RUNPOD_SERVERLESS_KEY` | The `runpod-serverless` provider only: a key restricted to the endpoint |
| Variable | `CODEMAN_COMMIT_SHA` | The commit of Codeman the workflow runs, a full SHA on Codeman's `main`; [the workflow](#5-add-the-workflow-and-settings) says how to get it. Choose it now: the backend's rules and the templates come from that commit |
| Variable | `CODEMAN_SETTINGS` | Optional, in the organization: settings its repositories share; see [shared settings](shared-settings.md) |
| Variable | `CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER`, `CODEMAN_SERVICE_ACCOUNT` | The backend; see [the next part](#4-set-up-the-backend) |

Generate the encryption secret with:

```sh
openssl rand -base64 32
```

It encrypts each run's OpenRouter key, or self-hosted run token, while it travels from the job that creates it to the agent job; see [OpenRouter](../inference/openrouter.md). Self-hosted inference needs it too.

### Repository access

An organization secret or variable reaches the repositories its access policy names ([secrets](../web/github/using-secrets-in-github-actions.md#creating-secrets-for-an-organization), [variables](../web/github/store-information-in-variables.md#creating-configuration-variables-for-an-organization)). Give every Codeman secret and variable of the organization the policy **Selected repositories**, listing only the repositories that run Codeman. With **All repositories** or **Private repositories**, a repository created later in the organization, or a fork created inside it, receives the App's private key, the Runpod and OpenRouter keys and the encryption secret as soon as it exists ([forks](../security/forks.md#what-a-fork-gets)).

- **In the organization's settings**, **Secrets and variables → Actions**, the **Repository access** list of a new secret or variable chooses its policy; the list of secrets shows each one's policy, and its **Update** button the details ([reviewing access](../web/github/using-secrets-in-github-actions.md#reviewing-access-to-organization-level-secrets)).
- **With `gh`**, which needs the `admin:org` scope (`gh auth login --scopes "admin:org"`), `--visibility selected` with `--repos`, the organization's repositories separated by commas ([gh secret set](../web/github-cli/gh-secret-set.md), [gh variable set](../web/github-cli/gh-variable-set.md)). Without `--body`, `gh secret set` reads the value from standard input; without `--repos`, `gh` gives the policy **Private repositories**.

  ```sh
  ORG=<organization>
  REPOS=<repository-a>,<repository-b>   # the repositories that run Codeman
  gh secret set CODEMAN_GITHUB_APP_PRIVATE_KEY --org "$ORG" --visibility selected --repos "$REPOS" < private-key.pem
  gh secret set CODEMAN_KEY_ENCRYPTION_SECRET --org "$ORG" --visibility selected --repos "$REPOS"
  gh variable set CODEMAN_COMMIT_SHA --org "$ORG" --visibility selected --repos "$REPOS" --body <commit SHA>
  ```

  Each command sets the value and the list of repositories together, replacing the previous list.
- **To add a repository later** without setting the values again, add its ID to each secret and variable, once per name ([secrets](../web/github/rest-api-endpoints-for-github-actions-secrets.md#add-selected-repository-to-an-organization-secret), [variables](../web/github/rest-api-endpoints-for-github-actions-variables.md#add-selected-repository-to-an-organization-variable), [gh api](../web/github-cli/gh-api.md)). With the [listed-repositories condition](#4-set-up-the-backend), add the ID to the backend's condition too.

  ```sh
  REPO_ID=$(gh api repos/$ORG/<repository> --jq .id)
  gh api --method PUT orgs/$ORG/actions/secrets/CODEMAN_GITHUB_APP_PRIVATE_KEY/repositories/$REPO_ID
  gh api --method PUT orgs/$ORG/actions/variables/CODEMAN_COMMIT_SHA/repositories/$REPO_ID
  ```

- **To check them**, the policy and number of repositories of each, and the repositories of one ([gh secret list](../web/github-cli/gh-secret-list.md), [gh variable list](../web/github-cli/gh-variable-list.md), [list selected repositories](../web/github/rest-api-endpoints-for-github-actions-secrets.md#list-selected-repositories-for-an-organization-secret)):

  ```sh
  gh secret list --org "$ORG" --json name,visibility,numSelectedRepos
  gh variable list --org "$ORG" --json name,visibility,numSelectedRepos
  gh api orgs/$ORG/actions/secrets/CODEMAN_GITHUB_APP_PRIVATE_KEY/repositories --jq '.repositories[].full_name'
  ```

## 4. Set up the backend

Codeman records each run, what it cost and what its jobs did, in [Cloud Firestore](https://firebase.google.com/docs/firestore), in a Firebase project of its own; see [backend](../backend/backend.md). Its jobs reach it as a service account, with the OIDC token GitHub gives each job, so no key is stored anywhere. One project serves every repository of the organization, and several organizations if you like. The backend is required: without its variables, every run fails in `select`, saying which to set.

Firestore's free quota covers Codeman's use by far ([cost](../backend/backend.md)), so the project needs no billing account. You need a Google account; the commands below run in [Cloud Shell](https://shell.cloud.google.com), which has `gcloud`, or anywhere `gcloud` is installed.

1. **Create the project.** In the [Firebase console](https://console.firebase.google.com), **Create a project**, named for instance `codeman-ops`; Google Analytics is not needed. Note its **project ID** (Project settings), which may differ from its name.
2. **Create the database.** Under **Databases & Storage → Firestore**, **Create database** ([manage databases](../web/firebase/manage-databases.md#create-a-database)): **Standard edition**, the database ID `(default)`, a location near GitHub's runners (such as `nam5` or `us-east1`; it cannot be changed later), and **production mode**.
3. **Publish the rules.** Under **Databases & Storage → Firestore → Rules**, replace the rules with the contents of [`firebase/firestore.rules`](../../firebase/firestore.rules), at the commit in [`CODEMAN_COMMIT_SHA`](#5-add-the-workflow-and-settings), and **Publish**. They deny every client: only Codeman's service account, which the rules do not apply to, reaches the data.
4. **Enable the APIs** that Workload Identity Federation uses, and **create the service account**, with the role that reads and writes Firestore's documents (Cloud Datastore User) and nothing else:

   ```sh
   PROJECT_ID=codeman-ops   # the project ID
   gcloud services enable iam.googleapis.com sts.googleapis.com iamcredentials.googleapis.com \
     --project="$PROJECT_ID"
   gcloud iam service-accounts create codeman --project="$PROJECT_ID" --display-name="Codeman"
   gcloud projects add-iam-policy-binding "$PROJECT_ID" --role=roles/datastore.user \
     --member="serviceAccount:codeman@$PROJECT_ID.iam.gserviceaccount.com"
   ```

5. **Create the Workload Identity pool and provider**, which admit GitHub's OIDC tokens from Codeman's workflow on the default branch, of the repositories the attribute condition admits. Choose the condition first:

   - **Any repository of the organization.** The condition checks the owner: every repository of the organization whose `codeman.yml` on `main` asks for a token gets in, those created later included, and nothing needs updating when a repository starts using Codeman. But anyone who can create a repository in the organization, or fork one into it, reaches the backend without any secret ([forks](../security/forks.md#what-a-fork-cannot-reach)): restrict repository creation and forking in the organization to people you trust as maintainers.
   - **Only listed repositories.** The condition also checks `assertion.repository_id` against the numeric IDs of the repositories that run Codeman. IDs are unique and never reused, unlike names ([Google's advice](../web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md#github-actions-1)). A new repository or fork gets nothing until its ID is added; the cost is that update, for each repository that starts using Codeman ([change the condition](backend-maintenance.md#change-the-attribute-condition)). Recommended for a [pool](#a-pool-of-organizations) and for public repositories.

   ```sh
   ORG_ID=123456789   # your organization's numeric ID: gh api orgs/<organization> --jq .id
   # Any repository of the organization:
   CONDITION="assertion.repository_owner_id == '$ORG_ID' && assertion.workflow_ref == assertion.repository + '/.github/workflows/codeman.yml@refs/heads/main'"
   # Or only listed repositories, by ID: gh api repos/<organization>/<repository> --jq .id
   CONDITION="assertion.repository_owner_id == '$ORG_ID' && assertion.repository_id in ['111111111', '222222222'] && assertion.workflow_ref == assertion.repository + '/.github/workflows/codeman.yml@refs/heads/main'"

   gcloud iam workload-identity-pools create codeman --project="$PROJECT_ID" \
     --location=global --display-name="Codeman"
   gcloud iam workload-identity-pools providers create-oidc github --project="$PROJECT_ID" \
     --location=global --workload-identity-pool=codeman --display-name="GitHub" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.workflow_ref=assertion.workflow_ref" \
     --attribute-condition="$CONDITION"
   ```

   - The condition uses IDs, not names, which someone else could take if the organization or repository were renamed or deleted. A user account has an ID too: `gh api users/<login> --jq .id`. GitHub's token carries the IDs as strings ([OpenID Connect](../web/github/openid-connect.md)), so the condition quotes them.
   - `workflow_ref` names the workflow that runs the job, the caller's for the jobs of `codeman-task.yml`, at its branch: only `codeman.yml` on `main` gets in, which only a reviewed pull request changes. No other workflow of your repositories can reach the backend, not even one that runs code the agent wrote on a task branch. If your default branch has another name, change `main`.
   - The condition reads the token's claims as `assertion.<claim>`, and the mapping maps each of them, as Google's guide asks ([attribute condition](../web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md#define-an-attribute-condition)). It maps `repository_id` in both variants, so moving from one to the other changes only the condition.
   - A condition is at most 4096 characters ([update-oidc](../web/google-cloud/gcloud-iam-workload-identity-pools-providers-update-oidc.md)), about 280 repository IDs; beyond that, see [many repositories](backend-maintenance.md#change-the-attribute-condition).
   - For several organizations, use `assertion.repository_owner_id in ['<ID>', '<ID>']`, in either variant.

6. **Let the pool's identities act as the service account:**

   ```sh
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding \
     "codeman@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/codeman/*"
   echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/codeman/providers/github"
   ```

7. **Add the variables**, in the organization (visible to the repositories that use Codeman: [repository access](#repository-access)) or in each repository. They are not secrets.

   | Variable | Value |
   | --- | --- |
   | `CODEMAN_FIREBASE_PROJECT` | The project ID, such as `codeman-ops` |
   | `CODEMAN_WORKLOAD_IDENTITY_PROVIDER` | What the last command printed: `projects/<project number>/locations/global/workloadIdentityPools/codeman/providers/github` |
   | `CODEMAN_SERVICE_ACCOUNT` | `codeman@<project ID>.iam.gserviceaccount.com` |

   On GitHub Free, add them to each repository ([credentials](#3-add-the-credentials)).

To read, change, delete or restore any of this later, and to see who changed it, see [backend maintenance](backend-maintenance.md).

The workflow templates pass these variables to the jobs that record runs, and give those jobs, and only those, the `id-token: write` permission. The first run that finds a task writes the first documents: **Databases & Storage → Firestore → Data** shows `organizations/<owner>/runs` and `events`.

### A pool of organizations

Organizations that share one Runpod account can batch tasks on the same pods ([batches across repositories](../runs/batches.md)). For each organization of the pool:

1. Install the same App, made public, by its link (**Public page → Install**), with **Only select repositories**.
2. Add the same secrets and variables as the first: the App's client ID and private key, the Runpod key of the same account, the OpenRouter keys, an encryption secret, the backend's three variables, which name the same project, provider and service account, and `CODEMAN_COMMIT_SHA`, the same commit in every member: their runs share pods, the board and the batches, whose format a version may change.
3. Add its ID to the provider's condition, `assertion.repository_owner_id in ['<ID of A>', '<ID of B>']`, and with the listed-repositories condition the IDs of its repositories that run Codeman ([change the condition](backend-maintenance.md#change-the-attribute-condition)). The condition is the pool's real boundary: only the owners and repositories it admits reach the board, the batches and the registry.
4. Set `pool` to the same list in its `CODEMAN_SETTINGS`, such as `pool: [organization-a, organization-b]` ([shared settings](shared-settings.md)).
5. Copy the same workflow files into each repository that runs Codeman.

A pool is mutual trust: anyone with write access to a repository of any member that receives the App's private key can read it, with a workflow on any branch ([who can read Codeman's secrets](../security/overview.md#who-can-read-codemans-secrets)), and so reaches every member's installed repositories with the App's permissions ([security](../security/overview.md#a-public-app-and-a-pool)).

## 5. Add the workflow and settings

1. Copy [`templates/codeman.yml`](../../templates/codeman.yml) to `.github/workflows/codeman.yml` in the target repository, and [`templates/codeman-task.yml`](../../templates/codeman-task.yml), which runs each task's jobs, to `.github/workflows/codeman-task.yml`. Commit both to the default branch: GitHub runs the default branch's copy for comments, labels and the schedule, starts a manual run only of a workflow there ([events](../web/github/events-that-trigger-workflows.md)), and the backend's [attribute condition](#4-set-up-the-backend) admits only `codeman.yml` on `main`.
2. Add the variable `CODEMAN_COMMIT_SHA`, in the organization (visible to the repositories that use Codeman) or in the repository, which overrides it: a full commit SHA of this repository's `main` branch, 40 lowercase hexadecimal characters, such as its latest: `gh api repos/codenergy-dev/codeman/commits/main --jq .sha`. Copy the templates from that same commit. Each job that runs Codeman checks the value, checks Codeman out at it into `.codeman/action` and runs it from there; a job fails when the variable is unset or is not a full SHA, since a branch or tag would let the code change by itself, and when the commit is not on Codeman's `main`, since GitHub also serves the commits of Codeman's forks under its name. Nothing in the templates needs replacing. If you copy `codeman.yml` under another name, change the backend's [attribute condition](#4-set-up-the-backend) to match it.
3. If the agent needs tools that the runner image lacks, set them up in the `agent` job of `codeman-task.yml`, where the template marks the place (for example `actions/setup-node`). Tools installed inside the runner's home, such as Rust through `rustup`, are out of the agent's reach; install them system-wide instead. Add only steps that install tools: a step that runs repository code, such as `npm ci`, runs code the agent wrote outside its sandbox, where it can read the job's secrets. See [security](../security/risks.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox).
4. Optionally, write `.codeman/settings.yml`, with [`templates/settings.yml`](../../templates/settings.yml) as a guide; without it, the organization's [shared settings](shared-settings.md) and Codeman's defaults apply. The template sets `model`, `provider`, the budgets, `max-runs` and the limits, and each value in the file overrides the organization's: with shared settings, write only the values to override. See [settings](../settings/reference.md) for every value.
5. Optionally, add a `.codemanignore` with the paths the agent may not change; see [change policy](../runs/changes.md#change-policy). Without one, Codeman uses its own rules and proposes them in its first pull request. Those rules keep the agent out of `.github/`, including workflows; see [on-demand workflows](../runs/changes.md#on-demand-workflows) to allow them.
6. Create a `codeman` label in the target repository.

To move to another version of Codeman, change `CODEMAN_COMMIT_SHA`; a change made during a run reaches the jobs that start after it, so change it between runs. Copy the templates again only when Codeman asks: each Codeman step passes the version of the templates it was copied from (`template-version`), and a commit that expects another version fails at its first job, with a link to the templates at that commit. Copy both files then, keeping the steps you added to the `agent` job. Before moving, read what changed ([security](../security/risks.md#7-codemans-own-code-and-dependencies)).

Codeman reads `.codeman/settings.yml` and `.codemanignore` from the default branch. A manual run (**Actions → Codeman → Run workflow**) can override the model and the budgets for that run.

The agent job needs a Linux runner (x64 or arm64).

A run works on one task by default. A [profile](mixing-providers.md) with a count of tasks, such as `max-tasks: 2` (up to 10), in `.codeman/settings.yml` lets a run work on that many at once, each with its own key and agent; the run ends when its slowest task does. On OpenRouter, it only finishes tasks sooner: each pays for its own tokens. On pods, a count is a batch's: tasks with the same pod settings, of this and the pool's other repositories, share one pod and split its cost by the second, once the pod image supports it (see [pods](runpod.md#pods) and [batches across repositories](../runs/batches.md)); on Serverless, each task counts the worker time its requests used, and time that tasks of any of the organization's repositories used the worker at once is split among them as they close (a run's own limit still counts it whole while it runs; see [Serverless](../inference/serverless.md)). The budgets hold across them: each run's limit is reserved in Codeman's ledger before it opens, so tasks that open at once never pass a budget together; see [budget](../budget/budget.md).

## Try it

1. As a maintainer, open an issue that leaves something to decide, and label it `codeman`. Codeman works only on issues that maintainers open. To choose settings for this task, add lines such as `/codeman model <id>` or `/codeman set task-budget 5` to the description; see [commands](../tasks/commands.md).
2. Adding the label starts a run; you can also run the workflow manually. Codeman posts a status comment, writes a plan on the branch `codeman/<issue>-<slug>`, and lists its decisions in a comment of their own.
3. Answer in a comment, for example `/codeman decide 1 a` or `/codeman approve`. The comment starts a new run, which records the answers. When none is pending, the issue gets `codeman:ready`.
4. Codeman starts the next run right away, and the stages follow one run each: routing, then the routed stages it chose among web, design, code and test, and review. After code, a draft pull request that closes the issue appears; when the route has no code stage, the pull request opens when review passes. When review passes, the pull request is ready for review and the issue gets `codeman:done`. Unfinished work is committed, and the following run continues it.
5. Review the pull request. A review that requests changes, or a `/codeman fix <what to change>` comment, starts a run that pushes the changes to the same branch.
