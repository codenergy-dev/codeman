---
title: Secrets reference
url: https://docs.github.com/en/actions/reference/security/secrets
created_at: 2026-10-20T01:26:18-03:00
updated_at: 2026-10-20T01:26:18-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Secrets reference

Find technical information about secrets in GitHub Actions.

## Naming your secrets

> \[!TIP]
> To help ensure that GitHub redacts your secrets in logs correctly, avoid using structured data as the values of secrets.

The following rules apply to secret names:

* Can only contain alphanumeric characters (`[a-z]`, `[A-Z]`, `[0-9]`) or underscores (`_`). Spaces are not allowed.
* Must not start with the `GITHUB_` prefix.
* Must not start with a number.
* Are case insensitive when referenced. GitHub stores secret names as uppercase regardless of how they are entered.
* Must be unique to the repository, organization, or enterprise where they are created.

If a secret with the same name exists at multiple levels, the secret at the lowest level takes precedence. For example, if an organization-level secret has the same name as a repository-level secret, then the repository-level secret takes precedence. Similarly, if an organization, repository, and environment all have a secret with the same name, the environment-level secret takes precedence.

## Limits for secrets

You can store up to 1,000 organization secrets, 100 repository secrets, and 100 environment secrets.

A workflow created in a repository can access the following number of secrets:

* All 100 repository secrets.
* If the repository is assigned access to more than 100 organization secrets, the workflow can only use the first 100 organization secrets (sorted alphabetically by secret name).
* All 100 environment secrets.

Secrets are limited to 48 KB in size. To store larger secrets, see [Using secrets in GitHub Actions](/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#storing-large-secrets).

## When GitHub Actions reads secrets

Organization and repository secrets are read when a workflow run is queued, and environment secrets are read when a job referencing the environment starts.

## Automatically redacted secrets

GitHub automatically redacts the following sensitive information from workflow logs.

> \[!NOTE] If you would like other types of sensitive information to be automatically redacted, please reach out to us in our [community discussions](https://github.com/orgs/community/discussions?discussions_q=is%3Aopen+label%3AActions).

* 32-byte and 64-byte Azure keys
* Azure AD client app passwords
* Azure Cache keys
* Azure Container Registry keys
* Azure Function host keys
* Azure Search keys
* Database connection strings
* HTTP Bearer token headers
* JWTs
* NPM author tokens
* NuGet API keys
* v1 GitHub installation tokens
* v2 GitHub installation tokens (`ghp`, `gho`, `ghu`, `ghs`, `ghr`)
* v2 GitHub PATs

## Security

For security best practices using secrets, see [Secure use reference](/en/actions/reference/security/secure-use#use-secrets-for-sensitive-information).