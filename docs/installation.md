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

## 4. Add the workflow

1. Copy [`templates/codeman.yml`](../templates/codeman.yml) to `.github/workflows/codeman.yml` in the target repository.
2. Replace every `COMMIT_SHA` with a full commit SHA of this repository. Pin a SHA, not a branch or tag, so the code that runs cannot change without a review.
3. Adjust the defaults at the top of the workflow:

   | Variable | Default | Meaning |
   | --- | --- | --- |
   | `CODEMAN_MODEL` | `deepseek/deepseek-v4.1-flash` | OpenRouter model ID used unless a task sets another with `/codeman model` |
   | `CODEMAN_TASK_BUDGET` | `2` | Spending limit per task, in USD |
   | `CODEMAN_MONTHLY_BUDGET` | `20` | Spending limit per calendar month for the repository, in USD |

   Scheduled and comment runs use these defaults. A manual run (**Actions → Codeman → Run workflow**) can override each one.
4. Create a `codeman` label in the target repository.

The agent job needs a Linux runner (x64 or arm64).

## Try it

1. Open an issue that leaves something to decide, and label it `codeman`.
2. Run the workflow manually. Codeman posts a status comment, writes a plan on the branch `codeman/<issue>-<slug>`, and lists its decisions.
3. Answer in a comment, for example `/codeman decide 1 a` or `/codeman approve`. The comment starts a new run, which records the answers. When none is pending, the issue gets `codeman:ready`.
