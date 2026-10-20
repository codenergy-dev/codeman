---
title: cli: api/queries_repo.go at fc4b137
url: https://github.com/cli/cli/blob/fc4b137cdef0a6bd28fd461b7cf9c84a5812a8cd/api/queries_repo.go
created_at: 2026-10-20T15:18:00-03:00
updated_at: 2026-10-20T15:18:00-03:00
tool: docs/web/tools/github-repositories.md
---

# cli: api/queries_repo.go at fc4b137

The file is about 46 KB, so this page holds, in Codeman's words, only what Codeman relies on: how `gh workflow run` without `--ref` reads the default branch. Release v2.102.0 is commit `fc4b137`.

## RepoDefaultBranch

- Returns the repository's `DefaultBranchRef.Name` when the repository value already holds it; otherwise it calls `GitHubRepo` and returns that result's `DefaultBranchRef.Name` (`func RepoDefaultBranch`).

## GitHubRepo

- Sends one GraphQL query, `RepositoryInfo($owner: String!, $name: String!)`, on `repository(owner: $owner, name: $name)` (`func GitHubRepo`).
- The query selects, through a `repo` fragment on `Repository`: `id`, `databaseId`, `name`, `owner { login }`, `sshUrl`, `hasIssuesEnabled`, `description`, `hasWikiEnabled`, `viewerPermission` and `defaultBranchRef { name }`; the same fragment on `parent`; and `mergeCommitAllowed`, `rebaseMergeAllowed`, `squashMergeAllowed` (`func GitHubRepo`).
- The variables are `owner` and `name`, from the repository gh was given (`func GitHubRepo`).
- When the answer has no `repository`, which the code says can happen with a token that lacks a permission, gh reports a `NOT_FOUND` error "Could not resolve to a Repository with the name '<owner>/<name>'." (`func GitHubRepo`).
