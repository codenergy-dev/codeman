---
status: in progress
created_at: 2026-10-01T16:10:00-03:00
updated_at: 2026-10-01T17:20:00-03:00
commit: 6658cb9
---

# Platform abstraction

## Goal

Separate Codeman's domain logic from GitHub behind interfaces, so that later plans can add GitLab, Azure DevOps and self-hosted platforms as adapters. GitHub stays the only implementation, and its behavior does not change.

## Context

Codeman is a GitHub Action. GitHub reaches it through three layers, and each needs its own interface:

1. **The hosting platform's API** (`src/github.ts`, the `Repository` class): issues with labels as tasks and states, comments that Codeman creates, edits and reads back (the status comment holds the task record), pull requests (draft, ready, description, footer), reviews and their line comments, users' permissions, file reads, commits through the Git Data API, branches, and the bot's identity (`<app-slug>[bot]`).
2. **CI results** (`src/results.ts`, part of `select` and `apply`): the runs of a workflow on a commit, their jobs, logs and artifacts, and where workflow files live (`.github/workflows/`, staged in `.codeman/workflows/`).
3. **The runtime Codeman runs in** (`@actions/core` and `@actions/github` in `src/steps/*`, `src/sandbox.ts`, `src/main.ts`): inputs and outputs between jobs, logs, secret masking, the job summary, `GITHUB_WORKSPACE` and `RUNNER_TEMP`, the run's ID and URL, the repository's identity, artifacts that carry `task.json` and the agent's result between jobs, and the workflow template with its triggers, `concurrency` and per-job credentials.

The domain logic is already mostly free of GitHub: commands, the task record, decisions, stages, the change policy, budgets, prompts and rendering. GitHub leaks into it in these places:

| Where | What | Why it matters on other platforms |
| --- | --- | --- |
| `src/tasks.ts` | `IssueLike`, `CommentLike`, `ReviewLike`, `ReviewCommentLike`, `WorkflowRunLike` are GitHub's REST shapes (`html_url`, `user.type === "Bot"`, `pull_request_review_id`, `CHANGES_REQUESTED`). | Each platform returns other shapes and other review semantics. |
| `src/tasks.ts`, `src/record.ts` | Comments and reviews are ordered and marked as handled by numeric ID (`id > afterId`, `processedCommentId`, `processedReviewId`). | Holds where IDs grow monotonically per conversation. Azure DevOps reviews are reviewer votes, not events with IDs. |
| `src/steps/apply.ts`, `src/github.ts` | `comment(pullRequest, …)` uses the issue comments API, because a GitHub pull request is an issue. The record stores the pull request as an issue number. | GitLab merge requests and Azure DevOps pull requests are separate objects with their own IDs and comment APIs. |
| `src/steps/common.ts`, `src/status.ts`, `src/pull.ts` | URLs built from `serverUrl/owner/repo` (`/blob/`, `/pull/`, `/actions/runs/`, `#issuecomment-<id>`), and `Closes #<issue>`. | Every platform has its own URLs, anchors and closing keywords. |
| `src/text.ts` | Safe Markdown breaks `@mentions` and `#123` references, assuming GitHub Flavored Markdown. | GitLab also references with `!`, `~`, `%`, `$` and `&`. Azure DevOps uses `AB#123` and `@<id>`. This is a security boundary, so each dialect needs its own rules. |
| `src/status.ts`, `src/settings.ts`, i18n | The 65,536-character comment limit, and texts that name GitHub. | Limits and vocabulary differ. |
| `src/record.ts` | The record lives in a hidden HTML comment (`<!-- … -->`) inside a comment. | Some platforms may strip HTML comments or store comments as HTML. |
| `src/state.ts` | States are labels. | Azure DevOps work items have tags, not labels. |
| `src/policy.ts`, `src/prompt.ts` | Default protected paths (`/.github/**`) and workflow staging assume `.github/workflows/`. | GitLab uses `.gitlab-ci.yml`; Azure Pipelines can read YAML from any path. |
| `src/steps/keys.ts` | OpenRouter key names are `codeman/<owner>/<repo>/<issue>/<run>`. | GitLab paths have nested groups; Azure DevOps has organization, project and repository. Changing the format for GitHub would break existing budget sums. |
| `src/steps/*` | Inputs, outputs, logging and masking go straight to `@actions/core`. | GitLab CI cannot mask a value at runtime; outputs between jobs work differently on each CI. |

### Preliminary map of other platforms

From documentation known today, to verify in each platform's own plan.

| Concept | GitHub | GitLab | Azure DevOps | Gitea / Forgejo |
| --- | --- | --- | --- | --- |
| Task | Issue + label | Issue + label (scoped labels need Premium) | Work item + tag | Issue + label |
| Change request | Pull request (an issue) | Merge request (own IID) | Pull request (own ID, comments in threads) | Pull request (an issue) |
| Requesting changes | Review `CHANGES_REQUESTED` | "Request changes" in recent versions; otherwise approvals and threads | Reviewer vote −5 / −10 | Review `REQUEST_CHANGES` |
| Maintainer | Permission `admin` / `write` | Access level ≥ Developer or Maintainer | Repository permissions or team membership | Permission `admin` / `write` |
| Atomic commit through the API | Git Data API | Commits API with actions | Pushes API (`oldObjectId` guards the branch) | Change files API |
| Starting a run on a comment | `issue_comment` | No CI trigger: webhook plus a relay, or schedule only | Service hook into a pipeline, or schedule only | `issue_comment` in Actions |
| Masking a secret at runtime | `::add-mask::` | Not available | `issecret=true` | `::add-mask::` |

Two findings shape the decisions below:

- Outside GitHub and Gitea, CI cannot start on a comment. Codeman there needs a webhook relay, a self-hosted service, or a schedule-only mode.
- The security model relies on per-job credentials and runtime masking ([security](../security.md#secrets)). It must be checked again for each runtime; it does not carry over.

No new dependency is needed for this plan.

## Decisions

1. **What "self-hosted" means.** Options: (a) self-managed instances of the platforms (GitHub Enterprise Server, GitLab self-managed, Azure DevOps Server, Gitea or Forgejo), which mostly need a configurable base URL and API version; (b) Codeman running as its own service (webhook receiver and worker) instead of inside the platform's CI; (c) both. Recommendation: (c) for the interfaces, so neither is ruled out. This plan only makes base URLs and the runtime replaceable; neither is built.
   **Answer:** the recommendation, from the responsible person.
2. **Where Codeman runs on other platforms.** Options: (a) inside each platform's CI (GitLab CI, Azure Pipelines), with a template per platform; (b) one self-hosted service for every platform; (c) decide in each platform's plan. Recommendation: (c). This plan defines a `Runtime` interface that both (a) and (b) can implement, so the answer is not needed yet.
   **Answer:** the recommendation, from the responsible person.
3. **Scope of the second implementation.** Options: (a) interfaces and the GitHub adapter only; (b) also an in-memory fake platform used by tests; (c) also a GitLab skeleton. Recommendation: (b). The fake proves the interfaces carry no GitHub type, and makes `select` and `apply` testable end to end without the network. A GitLab skeleton would commit to choices that its own plan should make.
   **Answer:** the recommendation, from the responsible person.
4. **IDs in interfaces and in the task record.** Options: (a) keep numeric IDs and the record format as they are, and require every adapter to provide IDs that grow monotonically per conversation, synthesizing them where the platform has none (Azure DevOps votes); (b) opaque string IDs and an ordering cursor, with a record migration. Recommendation: (a). GitHub, GitLab, Azure DevOps work items and Gitea all have numeric IDs, and (b) changes a storage format without a platform that needs it yet.
   **Answer:** the recommendation, from the responsible person.
5. **Interface names and terms.** Options: (a) neutral names in code (`Platform`, `ChangeRequest`, `Review.verdict`, `CiRun`) and GitHub's terms unchanged in user-facing texts; (b) neutral names in code and in user-facing texts now. Recommendation: (a). User-facing texts can take terms from the adapter when a second platform exists.
   **Answer:** the recommendation, from the responsible person.
6. **A `platform` input.** Options: (a) add none until a second adapter exists; (b) add `platform: github` to `action.yml` now. Recommendation: (a): an input that accepts one value is a public interface with no use.
   **Answer:** the recommendation, from the responsible person.

## Steps

Reading the code before starting refined steps 4 and 5, so the plan was updated before the code: what the agent and the change policy need to know about a platform's CI and Markdown is static, so it lives in a `Conventions` object next to the API interfaces, and the record's storage stays a requirement on adapters, documented in step 10. User-facing message catalogs keep naming GitHub and `.github/workflows/` (decision 5).

1. [x] Normalized domain types in `src/platform/types.ts`: `User` (login, whether a bot), `Issue`, `Comment`, `Review` (with `verdict: "approved" | "changes-requested" | "commented"` and line comments), `CiRun`, `CiJob`, `CiArtifact`, `RepositoryRef`, `FileChange`. `src/tasks.ts` uses them instead of the `*Like` types; mapping from GitHub's shapes moves to the adapter. Done when `src/tasks.ts` and `src/record.ts` import nothing GitHub-shaped and their tests pass unchanged in meaning.
2. [x] `Platform` interface in `src/platform/platform.ts`, grouped by capability: tasks and states (list opted-in tasks, set state, current labels), conversation (list, create and upsert comments on an issue, and on a change request separately), change requests (find by branch, open as draft, mark ready, update description and footer, list reviews with line comments), access (whether a user is a maintainer, the account Codeman writes as), content (default branch, branch head, read file, files under a prefix, commit at a time, atomic commit guarded by the base commit), and links (file, change request, comment anchor, references). Files are identified by their git blob SHA, which is git's, not GitHub's, so every git host can provide it. Done when each group's contract is written as doc comments, including the ID and atomicity requirements from decision 4.
3. [x] GitHub adapter in `src/platform/github/`: the current `Repository` and the mappings from step 1, implementing `Platform`. Done when `src/github.ts` is gone and only `src/platform/github/` imports `@actions/github` for API calls.
4. [ ] `CiResults` interface (runs for a commit, jobs, log, artifacts) with a GitHub Actions adapter, and `WorkflowConventions` (where workflow files live, which files the agent may wait for, the rules that protect CI configuration, and the agent's instructions for writing and reviewing workflows). `src/results.ts`, `src/policy.ts` (proposed rules and staging), `src/output.ts`, `src/prompt.ts` and `apply` take them as arguments. Done when `.github/workflows` appears only in the GitHub adapter, the message catalogs and tests, and the proposed `.codemanignore` and prompts are unchanged for GitHub.
5. [ ] `MarkdownDialect`: how mentions and references are neutralized. `src/text.ts` and the renderers take it, with the comment size limit; the GitHub dialect is today's behavior. Done when the existing `text` and `status` tests pass with the GitHub dialect, and a test shows a dialect with other reference characters neutralizes them.
6. [ ] `Runtime` interface in `src/runtime/`: inputs, outputs, logging (info, warning, error, groups, summary), secret masking, failing the step, workspace and work directory, run ID and URL (and the run ID in an earlier run's URL, for the spend table), and the repository's identity. GitHub Actions adapter over `@actions/core`. Steps and `src/sandbox.ts` receive it instead of importing `@actions/core`. Done when only `src/runtime/github-actions.ts` imports `@actions/core`.
7. [ ] Key names come from `RepositoryRef`, with the GitHub format exactly as today (`codeman/<owner>/<repo>/`). Done when `keys` tests show identical names for GitHub.
8. [ ] Composition root: `src/main.ts` builds the runtime, platform, CI results and conventions for GitHub (`Services`) and passes them to the steps. Done when steps take their dependencies as arguments.
9. [ ] In-memory fake platform and runtime in `src/testing/`, with tests for `select` and `apply` that cover planning, recording answers, a stage, and opening a pull request. Done when they pass without network access.
10. [ ] `docs/architecture.md` gets a "Platforms" section: the interfaces, what each adapter must guarantee (monotonic IDs, atomic guarded commits, an identity that others cannot forge, a maintainer check, a record that survives in a comment, safe Markdown, secret masking or an equivalent, per-job credentials), and that the security model must be reviewed for each new runtime. `docs/development.md` says where adapters live. Done when both describe the new layout.
11. [ ] `npm run check` passes, and the built `dist/index.js` behaves the same on a test repository: plan, answers, stages and pull request. Done when a full task runs as before.

## Out of scope

- Any adapter other than GitHub and the test fake.
- A webhook relay or self-hosted service.
- Workflow templates for other CIs.
- Changing user-facing texts, labels, commands, inputs or the task record's format.
- Moving tasks or records between platforms.
