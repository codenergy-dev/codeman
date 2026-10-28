---
status: completed
created_at: 2026-10-28T18:21:00-03:00
updated_at: 2026-10-28T18:56:00-03:00
commit: a8a103e
---

# Dispatch on the default branch read by REST

## Goal

The `dispatch` job starts another pool repository's `codeman.yml` on its default branch with a token that keeps only `actions: write` and `metadata: read`.

## Context

- **The symptom.** On 2026-10-28, at Codeman `21130fe`, a public repository's run dispatched to a private repository of another organization of the pool. Its token had `actions: write` and `metadata: read`, and the leg failed: `unable to determine default branch for <owner>/<repository>: GraphQL: Resource not accessible by integration (repository.defaultBranchRef)`.
- **`e26a8c9` did not fix it.** It added `permission-metadata: read` to the token, on the assumption that `defaultBranchRef` needs it. The failure persists with it. Other projects met the same error with Actions-only App tokens and avoided the read rather than granting metadata ([docker/model-runner#1092](https://github.com/docker/model-runner/pull/1092), [burin-labs/harn#9913](https://github.com/burin-labs/harn/issues/9913)). The GraphQL field reads a Git ref, which most likely needs `contents: read`.
- **Why the suite agreed.** The fake GitHub answers `defaultBranchRef` to a token with `metadata: read` (`repositoryQuery` in `e2e/fakes/github/graphql.ts`): it encodes the assumption, not GitHub.
- **Where the read comes from.** Without `--ref`, `gh workflow run` reads the default branch with GraphQL ([run.go](../web/github-cli/cli-pkg-cmd-workflow-run-run-go-at-fc4b137.md), [queries_repo.go](../web/github-cli/cli-api-queries-repo-go-at-fc4b137.md)). With `--ref`, it does not. The REST repository (`GET /repos/{owner}/{repo}`) gives `default_branch` with `metadata: read`.

## Decisions

### Answered by the responsible person on 2026-10-28

1. **How the dispatch learns the default branch.** Options: (a) read `default_branch` from the REST repository and pass it as `--ref`; (b) add `permission-contents: read` to the token; (c) pass `--ref main`. **Recommendation: (a).** (b) lets the token read the other organization's code for an hour, only for a branch name; (c) breaks repositories whose default branch is not `main`. **Answer: (a).**

## Steps

1. **Template.** The `dispatch` step reads `default_branch` with `gh api "repos/$OWNER/$REPOSITORY"` and runs `gh workflow run codeman.yml --ref "$branch"`. The token keeps `actions: write` and `metadata: read`. Done when `src/templates.test.ts` asserts it.
2. **Fake GitHub.** `defaultBranchRef` needs `contents: read` on a repository the token covers. Done when `e2e/fakes/github/github.test.ts` shows a token with `actions: write` and `metadata: read` refused, and one with `contents: read` answered.
3. **Docs.** Correct the explanation of `e26a8c9` in `docs/runs/batches.md`, `docs/runs/runs-and-jobs.md`, `docs/security/overview.md`, `docs/security/secrets.md` and `docs/installation/upgrading.md`, the scenario's comment, and add notes to the plans that recorded it. Done when nothing says metadata lets gh read the default branch.
4. **Checks.** `npm test`, the type check and the build pass; the fake's tests pass. Done with their output.

## Results

All steps are done, in `e0370fd`. Of step 3's files, `docs/runs/runs-and-jobs.md`, `docs/security/overview.md` and `docs/security/secrets.md` only list the token's permissions, which do not change, so they stay as they are.

- `npm run check`: 933 tests pass, none fail; lint, type check and build pass.
- `npm run test:e2e -- pools/two-organizations-batch` passes (75 s).
- With `templates/codeman.yml` from `a8a103e` and the new fake, the same scenario fails: no dispatch is made, and the `Wake globex/site` job logs "unable to determine default branch for globex/site: GraphQL: Resource not accessible by integration (repository.defaultBranchRef)", the error seen on GitHub.

## Out of scope

- Proving on GitHub which permission `defaultBranchRef` needs: the fix no longer reads it.
- Removing `permission-metadata: read` from `select`'s token.
- Changing the template version: files copied before keep running, and only their dispatches fail.
