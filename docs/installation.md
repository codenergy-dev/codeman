# Installation

Setting up Codeman on a repository takes three parts: a GitHub App, its credentials in the repository, and a workflow.

## 1. Register the GitHub App

Codeman acts as a GitHub App (`codeman[bot]`), not with the workflow's `GITHUB_TOKEN`. The `GITHUB_TOKEN` cannot push changes under `.github/workflows/`, and events it creates do not trigger other workflows.

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

Each workflow run requests a token scoped down to the permissions that run needs.

## 2. Add the credentials to the repository

In the target repository (or the organization), under **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `CODEMAN_APP_CLIENT_ID` | The App's Client ID |
| Secret | `CODEMAN_APP_PRIVATE_KEY` | The full contents of the private key file |

## 3. Add the workflow

1. Copy [`templates/codeman.yml`](../templates/codeman.yml) to `.github/workflows/codeman.yml` in the target repository.
2. Replace `COMMIT_SHA` with a full commit SHA of this repository. Pin a SHA, not a branch or tag, so the code that runs cannot change without a review.
3. Create a `codeman` label in the target repository.

To check the setup, label an open issue with `codeman` and run the workflow manually (**Actions → Codeman → Run workflow**). The log lists the issue and its state.
