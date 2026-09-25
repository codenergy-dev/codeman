# Installation

Setting up Codeman on a repository takes four parts: a GitHub App, an OpenRouter account, credentials in the repository or organization, and a workflow.

## 1. Register the GitHub App

Codeman acts as a GitHub App, not with the workflow's `GITHUB_TOKEN`. The `GITHUB_TOKEN` cannot push changes under `.github/workflows/`, and events it creates do not trigger other workflows.

Register one App per owner (user or organization) under **Settings → Developer settings → GitHub Apps → New GitHub App**:

- **Webhook:** disabled. Codeman runs from workflows, not webhooks.
- **Repository permissions:**
  - Contents: read and write
  - Issues: read and write
  - Pull requests: read and write
  - Workflows: read and write
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

Generate the encryption secret with:

```sh
openssl rand -base64 32
```

It encrypts each task key while it travels from the job that creates it to the agent job; see [architecture](architecture.md#budget).

## 4. Add the workflow and settings

1. Copy [`templates/codeman.yml`](../templates/codeman.yml) to `.github/workflows/codeman.yml` in the target repository.
2. Replace every `COMMIT_SHA` with a full commit SHA of this repository. Pin a SHA, not a branch or tag, so the code that runs cannot change without a review.
3. If the agent needs tools that the runner image lacks, set them up in the `agent` job, where the template marks the place (for example `actions/setup-node`). Tools installed inside the runner's home, such as Rust through `rustup`, are out of the agent's reach; install them system-wide instead.
4. Copy [`templates/settings.yml`](../templates/settings.yml) to `.codeman/settings.yml` and choose the model. See [settings](architecture.md#settings) for every value.
5. Optionally, add a `.codemanignore` with the paths the agent may not change; see [change policy](architecture.md#change-policy). Without one, Codeman uses its own rules and proposes them in its first pull request.
6. Create a `codeman` label in the target repository.

Codeman reads `.codeman/settings.yml` and `.codemanignore` from the default branch. A manual run (**Actions → Codeman → Run workflow**) can override the model and the budgets for that run.

The agent job needs a Linux runner (x64 or arm64).

## Try it

1. Open an issue that leaves something to decide, and label it `codeman`.
2. Run the workflow manually. Codeman posts a status comment, writes a plan on the branch `codeman/<issue>-<slug>`, and lists its decisions.
3. Answer in a comment, for example `/codeman decide 1 a` or `/codeman approve`. The comment starts a new run, which records the answers. When none is pending, the issue gets `codeman:ready`.
4. The next run implements the plan on the task branch. When the agent reports the work as done, Codeman opens a pull request that closes the issue, and the issue gets `codeman:done`. Unfinished work is committed, and the following run continues it.
