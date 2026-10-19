---
title: Permissions required for GitHub Apps
url: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
created_at: 2026-10-13T20:48:00-03:00
updated_at: 2026-10-19T13:29:35-03:00
tool: docs/web/tools/github.md
---

# Permissions required for GitHub Apps

GitHub's table of every endpoint per permission is too large to keep here (about 100 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/rest/authentication/permissions-required-for-github-apps`).

## About GitHub App permissions

- An App's permissions decide which REST endpoints its tokens may call. "IAT" in the tables means an installation access token, "UAT" a user access token.
- A response's `X-Accepted-GitHub-Permissions` header names the permissions an endpoint needs.

## Repository permissions for "Actions"

- `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` (start a workflow with `workflow_dispatch`) needs Actions **write**, and accepts installation access tokens.
- The same write level also allows, among others: cancelling, force-cancelling, re-running and deleting workflow runs and their logs; deleting artifacts and caches; disabling and enabling workflows; approving runs; and setting the repository's OIDC subject claim customization (`PUT /repos/{owner}/{repo}/actions/oidc/customization/sub`).
- Actions **read** allows listing and reading workflow runs, jobs, logs, artifacts and workflows, and the repository's concurrency groups (`GET /repos/{owner}/{repo}/actions/concurrency_groups` and `.../concurrency_groups/{concurrency_group_name}`).
- `POST /repos/{owner}/{repo}/dispatches` (`repository_dispatch`) is listed under the Contents permission, at write.

## Repository permissions for "Variables"

- Variables **read** allows `GET /repos/{owner}/{repo}/actions/variables` and `GET /repos/{owner}/{repo}/actions/variables/{name}` (the repository's own variables), and `GET /repos/{owner}/{repo}/actions/organization-variables` (the organization variables shared with the repository). All three accept installation access tokens.
- Variables **write** allows creating, updating and deleting the repository's variables.

## Organization permissions for "Variables"

- A separate, organization-level Variables permission covers `GET /orgs/{org}/actions/variables` and `GET /orgs/{org}/actions/variables/{name}` (read), and creating, updating, deleting and sharing organization variables (write). These accept installation access tokens too.
