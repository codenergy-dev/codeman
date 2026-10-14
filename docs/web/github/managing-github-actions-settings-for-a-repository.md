---
title: Managing GitHub Actions settings for a repository
url: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
created_at: 2026-10-14T17:40:56-03:00
updated_at: 2026-10-14T17:40:56-03:00
tool: docs/web/tools/github.md
---

# Managing GitHub Actions settings for a repository

GitHub's page is too large to keep here (about 58 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository`).

## Controlling changes from forks to workflows in public repositories

- Anyone can fork a public repository and open a pull request that changes its workflows. Workflows from forks do not have access to secrets, but they can be abused, so workflows on pull requests from some outside contributors do not run automatically and may need approval.
- Approval may be needed when the user who created the pull request, or the user whose action triggered the event, requires it under the selected policy. By default, all first-time contributors require approval.
- `pull_request_target` workflows run in the context of the base branch, which is trusted, so they always run, whatever the approval settings.
- The setting is **Settings → Actions → General → Approval for running fork pull request workflows from contributors**, with three options: first-time contributors who are new to GitHub; first-time contributors (users with no commit or pull request merged into the repository); all external contributors (users who are not members or owners of the repository and not members of the organization). Changing it overrides the organization's setting.
- With either first-time option, a user who got any commit or pull request merged no longer needs approval; a malicious user can get there with an innocuous change.
- When approval is needed, a user with write access to the repository must approve the run.
- The policies limit who can use GitHub's runners. On self-hosted runners, user-controlled workflow code runs once approved or when the user may bypass approval.

## Enabling workflows for forks of private repositories

- Private repositories only: policies control how workflows run on `pull_request` events from forks. A policy disabled for the organization cannot be enabled for a repository.
- **Run workflows from fork pull requests**: runs them with a read-only `GITHUB_TOKEN` and no access to secrets.
- **Send write tokens to workflows from pull requests**: gives pull requests from forks a `GITHUB_TOKEN` with write permission.
- **Send secrets to workflows from pull requests**: makes all secrets available to the pull request.
- **Require approval for fork pull request workflows**: runs on pull requests from collaborators without write permission need approval from someone with write permission.
- The setting is **Settings → Actions → General → Fork pull request workflows** ("Configuring the fork policy for a private repository").
