---
title: Disabling or limiting GitHub Actions for your organization
url: https://docs.github.com/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization
created_at: 2026-10-14T17:40:56-03:00
updated_at: 2026-10-14T17:40:56-03:00
tool: docs/web/tools/github.md
---

# Disabling or limiting GitHub Actions for your organization

GitHub's page is too large to keep here (about 72 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/organizations/managing-organization-settings/disabling-or-limiting-github-actions-for-your-organization`).

## Configuring required approval for workflows from public forks

- The organization's version of the repository setting, with the same text: workflows from forks do not have access to secrets; workflows on pull requests to public repositories from some outside contributors need approval first; by default, all first-time contributors do; `pull_request_target` workflows always run, whatever the approval settings.
- The setting is **Settings → Actions → General → Approval for running fork pull request workflows from contributors**, in the organization, with the same three options (first-time contributors who are new to GitHub, first-time contributors, all external contributors). It overrides the enterprise's setting; a repository's own setting overrides it.
- When approval is needed, a user with write access to the repository must approve the run. With either first-time option, a user who got any commit or pull request merged no longer needs approval.

## Enabling workflows for private repository forks

- For private repositories, the organization sets the policies for `pull_request` workflows from forks: **Run workflows from fork pull requests** (read-only `GITHUB_TOKEN`, no secrets), **Send write tokens to workflows from pull requests**, **Send secrets to workflows from pull requests** (makes all secrets available to the pull request), and **Require approval for fork pull request workflows**.
- A policy disabled for the organization cannot be enabled for its repositories; one the organization enables can be disabled for a repository.
- The setting is **Settings → Actions → General → Fork pull request workflows**, in the organization ("Configuring the private fork policy for an organization").
