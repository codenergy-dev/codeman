---
title: Secrets
url: https://docs.github.com/en/actions/concepts/security/secrets
created_at: 2026-10-20T01:26:18-03:00
updated_at: 2026-10-20T01:26:18-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Secrets

Learn about secrets as they are used in GitHub Actions workflows.

## About secrets

Secrets allow you to store sensitive information in your organization, repository, or repository environments. Secrets are variables that you create to use in GitHub Actions workflows in an organization, repository, or repository environment.

GitHub Actions can only read a secret if you explicitly include the secret in a workflow.

## How secrets work

Secrets use [Libsodium sealed boxes](https://libsodium.gitbook.io/doc/public-key_cryptography/sealed_boxes), so that they are encrypted before reaching GitHub. This occurs when the secret is submitted [using the UI](/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-a-repository) or through the [REST API](/en/rest/actions/secrets). This client-side encryption helps minimize the risks related to accidental logging (for example, exception logs and request logs, among others) within GitHub's infrastructure. Once the secret is uploaded, GitHub is then able to decrypt it so that it can be injected into the workflow runtime.

## Organization-level secrets

Organization-level secrets let you share secrets between multiple repositories, which reduces the need for creating duplicate secrets. Updating an organization secret in one location also ensures that the change takes effect in all repository workflows that use that secret.

When creating a secret for an organization, you can use a policy to limit access by repository. For example, you can grant access to all repositories, or limit access to only private repositories or a specified list of repositories.

For environment secrets, you can enable required reviewers to control access to the secrets. A workflow job cannot access environment secrets until approval is granted by required approvers.

To make a secret available to an action, you must set the secret as an input or environment variable in your workflow file. Review the action's README file to learn about which inputs and environment variables the action expects. See [Workflow syntax for GitHub Actions](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsenv).

## Limiting credential permissions

When generating credentials, we recommend that you grant the minimum permissions possible. For example, instead of using personal credentials, use [deploy keys](/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys#deploy-keys) or a service account. Consider granting read-only permissions if that's all that is needed, and limit access as much as possible.

When generating a personal access token (classic), select the fewest scopes necessary. When generating a fine-grained personal access token, select the minimum permissions and repository access required.

Instead of using a personal access token, consider using a GitHub App, which uses fine-grained permissions and short lived tokens, similar to a fine-grained personal access token. Unlike a personal access token, a GitHub App is not tied to a user, so the workflow will continue to work even if the user who installed the app leaves your organization. For more information, see [Making authenticated API requests with a GitHub App in a GitHub Actions workflow](/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow).

## Automatically redacted secrets

GitHub Actions automatically redacts the contents of all GitHub secrets that are printed to workflow logs.

GitHub Actions also redacts information that is recognized as sensitive, but is not stored as a secret. For a list of automatically redacted secrets, see [Secrets reference](/en/actions/reference/security/secrets#automatically-redacted-secrets).

Because there are multiple ways a secret value can be transformed, this redaction is not guaranteed. Additionally, the runner can only redact secrets used within the current job. As a result, there are certain security proactive steps you should follow to help ensure secrets are redacted, and to limit other risks associated with secrets. For a reference list of security best practices with secrets, see [Secure use reference](/en/actions/reference/security/secure-use#use-secrets-for-sensitive-information).

## Further reading

* [Using secrets in GitHub Actions](/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
* [REST API endpoints for GitHub Actions Secrets](/en/rest/actions/secrets)