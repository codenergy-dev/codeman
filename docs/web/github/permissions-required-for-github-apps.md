---
title: Permissions required for GitHub Apps
url: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
created_at: 2026-10-13T20:48:00-03:00
updated_at: 2026-10-21T11:22:04-03:00
tool: docs/web/tools/github.md
---

# Permissions required for GitHub Apps

GitHub's table of every endpoint per permission is too large to keep here (about 100 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/rest/authentication/permissions-required-for-github-apps`).

## About GitHub App permissions

- An App's permissions decide which REST endpoints its tokens may call. "IAT" in the tables means an installation access token, "UAT" a user access token.
- A response's `X-Accepted-GitHub-Permissions` header names the permissions an endpoint needs.
- The permissions are needed for private resources. Some endpoints also serve public resources without them; each endpoint's own documentation says which.
- Each table lists an endpoint, its access (`read` or `write`), the token types, and an "Additional Permissions" mark. A ✓ means the endpoint either needs more than one permission, or works with any one of a set: the endpoint then appears under each permission involved, and its own documentation gives the details. A ✗ means the listed permission alone.

## Repository permissions for "Metadata"

At read, without additional permissions, and for installation access tokens: `GET /repos/{owner}/{repo}`, `GET /repos/{owner}/{repo}/hash-algorithm`, and the collaborators' endpoints, `GET /repos/{owner}/{repo}/collaborators`, `.../collaborators/{username}` and `.../collaborators/{username}/permission`.

## Repository permissions for "Contents"

- At read, without additional permissions: `GET /repos/{owner}/{repo}/branches/{branch}`, `GET .../commits`, `GET .../commits/{ref}`, `GET .../compare/{basehead}`, `GET .../contents/{path}`, and the Git database's reads: `GET .../git/ref/{ref}`, `GET .../git/matching-refs/{ref}`, `GET .../git/blobs/{file_sha}`, `GET .../git/trees/{tree_sha}`, `GET .../git/commits/{commit_sha}`.
- At write, without additional permissions: `POST .../git/blobs`, `POST .../git/trees`, `POST .../git/commits` and `DELETE .../git/refs/{ref}`.
- At write, with a ✓: `POST .../git/refs` and `PATCH .../git/refs/{ref}`, which are also listed under Workflows.
- `GET /repos/{owner}/{repo}/pulls/{pull_number}` is listed here at read, with a ✓, and under Pull requests.

## Repository permissions for "Issues"

- Without additional permissions: `GET /repos/{owner}/{repo}/issues` and `GET .../issues/{issue_number}` at read, `POST .../issues` at write.
- With a ✓, and listed under Pull requests at the same level: `PATCH .../issues/{issue_number}`; an issue's labels (`GET`, `POST`, `PUT` and `DELETE .../issues/{issue_number}/labels`, `DELETE .../labels/{name}`); its comments (`GET` and `POST .../issues/{issue_number}/comments`; `GET`, `PATCH` and `DELETE .../issues/comments/{comment_id}`); and the repository's labels (`GET` and `POST .../labels`).

## Repository permissions for "Pull requests"

- Without additional permissions: `GET /repos/{owner}/{repo}/pulls`, `GET .../pulls/{pull_number}/reviews` and `GET .../pulls/{pull_number}/comments` at read; `POST .../pulls` and `PATCH .../pulls/{pull_number}` at write.
- With a ✓: `GET .../pulls/{pull_number}` at read (also under Contents), and the issue endpoints listed under Issues above, at their level.

## Repository permissions for "Workflows"

At write, each with a ✓, as they also need Contents: `PUT` and `DELETE /repos/{owner}/{repo}/contents/{path}`, `POST .../git/refs`, `PATCH .../git/refs/{ref}`, `POST .../releases` and `PATCH .../releases/{release_id}`.

## Repository permissions for "Actions"

- `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` (start a workflow with `workflow_dispatch`) needs Actions **write**, and accepts installation access tokens.
- The same write level also allows, among others: cancelling, force-cancelling, re-running and deleting workflow runs and their logs; deleting artifacts and caches; disabling and enabling workflows; approving runs; and setting the repository's OIDC subject claim customization (`PUT /repos/{owner}/{repo}/actions/oidc/customization/sub`).
- Actions **read** allows listing and reading workflow runs, jobs, logs, artifacts and workflows, and the repository's concurrency groups (`GET /repos/{owner}/{repo}/actions/concurrency_groups` and `.../concurrency_groups/{concurrency_group_name}`). Among them, without additional permissions: `GET .../actions/workflows` and `.../workflows/{workflow_id}`; `GET .../actions/runs`, `.../runs/{run_id}`, `.../runs/{run_id}/jobs` and `.../runs/{run_id}/artifacts`; `GET .../actions/jobs/{job_id}` and `.../jobs/{job_id}/logs`; `GET .../actions/artifacts`, `.../artifacts/{artifact_id}` and `.../artifacts/{artifact_id}/{archive_format}`.
- `DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}` needs Actions **write**.
- `POST /repos/{owner}/{repo}/dispatches` (`repository_dispatch`) is listed under the Contents permission, at write.

## Repository permissions for "Variables"

- Variables **read** allows `GET /repos/{owner}/{repo}/actions/variables` and `GET /repos/{owner}/{repo}/actions/variables/{name}` (the repository's own variables), and `GET /repos/{owner}/{repo}/actions/organization-variables` (the organization variables shared with the repository). All three accept installation access tokens.
- Variables **write** allows creating, updating and deleting the repository's variables.

## Organization permissions for "Variables"

- A separate, organization-level Variables permission covers `GET /orgs/{org}/actions/variables` and `GET /orgs/{org}/actions/variables/{name}` (read), and creating, updating, deleting and sharing organization variables (write). These accept installation access tokens too.
