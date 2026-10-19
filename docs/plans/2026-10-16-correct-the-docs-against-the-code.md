---
status: in progress
created_at: 2026-10-16T17:52:56-03:00
updated_at: 2026-10-19T13:11:32-03:00
commit: ebb63ac
---

# Correct the docs against the code

## Goal

Every statement in `README.md` and `docs/` (outside `docs/web/` and `docs/plans/`) matches what the code at the plan's commit does. Statements that overstate a protection are corrected first.

## Context

Eight reviewers read the docs against `src/`, `templates/`, `docker/`, `action.yml` and `firebase/`, each taking one group of files. Most mechanisms match the code. They found:

- 10 high-severity findings. Four concern security and overstate a protection.
- About 45 medium-severity findings.
- About 60 low-severity findings.

These corrections come before the [restructuring](2026-10-16-restructure-the-docs-for-readers.md). Fixing facts in small diffs first keeps each fix reviewable, and keeps wrong facts out of the new tables and diagrams.

Some findings are behaviors that may be bugs rather than doc errors. Those are listed under Decisions. The doc follows the code until the owner decides.

## Decisions

Answered by the responsible person on 2026-10-16. They authorized correcting the problems found, which approves the recommended option of each decision below.

The code changes those options call for (2b, 3b, 4b, 6b and 7a) each get a plan of their own. Until a change lands, the docs describe the code as it is. For 3b, that plan settles which limit both counters follow.

Each decision asked whether to document the current behavior or change the code.

1. **`/codeman set model` and `set gpu` are dropped together.** If either the task's `model` or its `gpu` does not fit, `resolveOwn` drops both (`src/steps/select.ts:234-242`). The docs say only the failing one is dropped, in 4 places.
   - a) Document "both are dropped" (recommended for now).
   - b) Change the code so it drops only the setting that failed.
2. **A `fix` or `continue` posted while a task is `codeman:awaiting-decision` is lost silently.** The `record` run advances `processedCommentId` past the comment (`src/record.ts:186-211`, `src/tasks.ts:269`). Fixed by the [plan for commands around decisions and review rounds](2026-10-19-commands-around-decisions-and-review-rounds.md), step 1.
   - a) Document it.
   - b) Report it as a problem in the run comment (recommended, as a code change), and document it until then.
3. **`max-runs` blocks one round later for review than for other stages.** An unfinished stage blocks at `runs >= max` (`src/steps/apply.ts:367`). Review blocks at `rounds > max` (`apply.ts:477`).
   - a) Document both limits exactly.
   - b) Align the code (recommended: ask whether the difference is intended).
4. **A `route` run refused for the monthly budget still posts a run comment.** `quiet` covers only `plan` and `implement` (`apply.ts:1154`).
   - a) Document "except routing".
   - b) Add `route` to `quiet` (recommended: it looks like a bug).
5. **The settings log prints raw layer values.** It lists provider settings that a change of provider dropped, and does not name the provider's defaults (`src/settings.ts:960-982`).
   - a) Add a callout that the lines show what each layer sets, not what the run uses (recommended).
   - b) Log only the values in effect.
6. **A repository variable `CODEMAN_SETTINGS` replaces the organization's whole.** Anyone with write access can create one, which removes `organization-monthly-budget` and `pool` for that repository.
   - a) Document it as a warning, in shared settings and in security (recommended now).
   - b) Also look for a code or template mitigation, in a separate plan.
7. **Possible sandbox escape through `PATH`.** After the agent, Codeman's step resolves `sudo`, `unzip` and `id` from the job's `PATH` (`src/sandbox.ts:18,26,42,81,199`; `src/results.ts:95`). If a setup action put a directory that `codeman-agent` can write on that `PATH`, the agent could plant a binary there.
   - a) Investigate on the runner images in a separate security plan (recommended).
   - b) Only document the condition.

## Steps

Each step is one commit or a few, touching only the files named. A step is done when its rows below are fixed and `npm test` passes. Rows marked with a decision number wait for that decision.

1. **Security statements** (high). **Done on 2026-10-17.** `security/overview.md` has the new section `## Who can read Codeman's secrets`. Replacing artifacts is not stated, since no saved source shows it; the `PATH` escape awaits decision 7. Done when all of these are fixed:
   - **Who can read Codeman's secrets.** Anyone with write access to a repository that receives Codeman's secrets can read every one of them, with a workflow on any branch. The docs say "whoever can change `codeman.yml` on the default branch" instead. Fix `security/overview.md` (checklist, "A public App and a pool"), `security/forks.md` (recommendation 3), `security/risks.md` §7 and `installation/setup.md:175`. State the boundary once, in `security/overview.md`, and link to it.
   - **Who can change `CODEMAN_SETTINGS`.** The docs disagree:
     - `security/secrets.md` says organization owners;
     - `security/overview.md:16` says admins;
     - `security/risks.md:73` says write access.

     Align all three to write access, and add the bypass warning to `installation/shared-settings.md` (decision 6).
   - **The OpenRouter management key's gap.** `security/secrets.md` says "None known". The key creates keys without limits on the account's credits. Add mitigations: a dedicated account, prepaid credits, no automatic top-up.
   - **What an extra `agent` step can read** (`security/risks.md` §3). Add the Serverless key, the decrypted task key, and the fact that setup actions are third-party code with the same reach. Verify whether such a step can replace the artifacts that `apply` reads before stating it.
   - **The agent and `opencode.json`.** `development/dependencies.md` says the agent "cannot change `opencode.json` or `.opencode/`". They are protected only by default `.codemanignore` rules, which a repository can re-allow (`src/policy.ts:24-41`).
   - **Medium security rows:**
     - Pods are shared across the pool, not only the organization (`secrets.md` task key row, `risks.md` §4).
     - CI workflows with `secrets: inherit` on `codeman/*` (`risks.md` §1).
     - An outsider's `/codeman` comment replaces a pending run (`forks.md`).
     - The intro of `forks.md` overstates "credentials do not work".
2. **Done on 2026-10-17.** **Onboarding** (`README.md`, `installation/setup.md`, `installation/shared-settings.md`, `installation/profiles.md`):
   - Copying `templates/settings.yml` overrides the organization's shared settings. The file is optional (`src/steps/select.ts:97-101`). This is high severity.
   - The trigger list leaves out `issues` (`templates/codeman.yml:39-40`). "Try it" says to run the workflow by hand, but adding the label already starts a run.
   - An OpenRouter key is made per agent run, not per task.
   - `CODEMAN_COMMIT_SHA`:
     - say how to get the SHA;
     - say that it must be on Codeman's `main` (`codeman.yml:141-146`);
     - set it before §3 and §4 use it.
   - The workflow files must be committed to the default branch.
   - The GitHub Free restriction applies to organization secrets too, not only variables.
   - The Runpod key with `organization-monthly-budget` is also needed when the month's runs used Runpod (`src/steps/keys.ts:72-81`).
   - The pull request opens when review passes if the route has no code stage.
   - The README says pods run "Ollama"; they run Ollama or vLLM.
3. **Done on 2026-10-17.** **Settings** (`settings/*.md`):
   - Decision 1: the `model`/`gpu` rule, in 4 places.
   - A manual run's inputs are only `model`, `task-budget`, `monthly-budget` and `max-runs`.
   - Decision 3: the exact `max-runs` limits. Make `templates/codeman.yml` and `action.yml` describe them the same way.
   - Decision 5: the settings log.
   - `profiles.md#budgets` is a stale copy of `budget/budget.md`: replace it with a link.
   - A repository variable replaces the organization's settings whole (layer 2).
   - `pool` takes 1 to 10 logins. Profile `name` rules.
   - The description is read first, then the comments, and the last command wins.
   - Units and types: `max-file-bytes` is in bytes.
   - `gpu` quoting is optional; make the examples consistent.
4. **Done on 2026-10-17.** **Pod engines and Runpod** (`settings/ollama.md`, `settings/vllm.md`, `installation/runpod.md`):
   - Ollama's estimate also subtracts `gpu-overhead`, and falls back to the model's own context (`src/gateway/fit.ts:65,107-108`).
   - vLLM has a third failure message, "no context … in K starts" (`src/gateway/vllm.ts:347-349`).
   - vLLM has a second CUDA message, for no host at all (`src/inference/selfhosted.ts:1027-1032`). The CUDA check runs before the Hugging Face check.
   - vLLM's four block-combination errors.
   - The cached-context path skips auto-fit.
   - `runpod.md`:
     - the orphan sweep works per pool (`CODEMAN_POOL`);
     - the account may serve a pool;
     - name the key jobs: `open-key`, `close-key`, `release-pod`.
   - "Not published yet" for the vLLM image is stale (`src/inference/images.ts:14-15`).
   - List all 11 serial Ollama families.
   - Remove the upgrade-history line from `vllm.md#how-they-apply`.
5. **Done on 2026-10-17.** **Tasks and runs** (`tasks/*.md`, `runs/*.md`):
   - Decision 2: commands posted during `awaiting-decision`.
   - Review reports only `done`, `changes`, `blocked`, `decisions` (`src/output.ts:157-163`). Web never runs in a fallback route. The router chooses among four stages.
   - The agent's time limit: `agent-minutes` 50, in a 60-minute job, with 2 minutes kept for the fix pass.
   - The `agent` job also receives the encrypted key and `CODEMAN_KEY_ENCRYPTION_SECRET`. Keep the per-job credentials in `security/secrets.md` only, and link to it from `runs-and-jobs.md`.
   - How to unblock depends on the cause (`src/steps/apply.ts:1052-1056`, `src/i18n/en.ts:198-213`). Budget refusals send a task back to its previous state.
   - Decision 4: routing comments on a budget refusal.
   - `agent.md`:
     - Codeman passes every `##` section of its `AGENTS.md`, "Third-party documentation" included;
     - those rules come from Codeman's checkout at `CODEMAN_COMMIT_SHA`;
     - files that the work tree's `.gitignore` ignores are not collected;
     - the sandbox is sealed after the fix pass.
   - Command details:
     - `continue` on a `done` task;
     - `replan` needs a record;
     - `accept-workflows` works in any state;
     - free text is limited to 2,000 characters;
     - only created comments are read;
     - a review's line comments are not parsed.
   - What "moved" means for the next run.
   - The commit check also requires a commit on Codeman's `main`.
   - Staging takes any depth under `.github/workflows/`. `max-files` counts after the drops.
6. **Done on 2026-10-17.** **Inference, budget and backend** (`inference/*.md`, `budget/*.md`, `backend/*.md`):
   - Transactions make 5 attempts by default, and 20 for the reservation, the split, the registry and the board (`src/store/store.ts:19`, `src/ledger.ts:112,117`).
   - `status: expired` is written only by an OpenRouter refresh (`src/ledger.ts:227-230`).
   - A failed `open-key` blocks the task. A task in `planning` goes back to `new`.
   - Serverless requires exactly 1 max worker and 0 active workers (`src/inference/gpu.ts:115-126`). Jobs have a 30-minute execution limit.
   - `key-expiry-hours` is 24 by default.
   - `release-pod` writes only `pod-*` events.
   - The reservation is not wrapped in the 3-retry write.
   - The claim wait has a bound, about 40 polls.
   - A pod that `close-key` cannot reach terminates itself after 15 idle minutes.
   - Queries use the pool's pods.
   - Name the Serverless key the agent job uses.
7. **Done on 2026-10-17**, with four Google Cloud pages and `gh run list` saved in `docs/web/`. **Operations** (`installation/backend-maintenance.md`, `installation/upgrading.md`):
   - "A spent pod waits for its close": the gateway part is not in any pinned image yet (`src/inference/images.ts:11,14`). This is high severity. The responsible person has published the rebuilt images:
     - `ghcr.io/codenergy-dev/codeman-ollama@sha256:1be16bba4040cbdc9f68276cb98dbc41707c4c38d4e16cf7a490003aa79ca08c`
     - `ghcr.io/codenergy-dev/codeman-vllm@sha256:2ffa65329f98ac14f184ea46f596b5d10ff89024914ef7c885e65796e30aa434`

     Pinning them is step 6 of the [plan for keeping a spent pod for its close](2026-10-15-keep-a-spent-pod-for-its-close.md), in a commit of its own. Before pinning, confirm the commit each image was built from ([pod images](../development/guide.md#pod-images)). Then the section says the change applies from that pin.
   - Add an entry for the attribute mapping that gained `repository_id` (`c4da7e2`).
   - Add `CODEMAN_KEY_ENCRYPTION_SECRET` before copying the templates again.
   - Disabling the Workload Identity pool may leave already-issued service-account tokens valid for up to about 55 minutes (`src/store/google.ts:12,79-90`). Verify this or state the bound.
   - The service account can be disabled.
   - Deleting the database resets the budgets and terminates live pods.
   - How to check that no run is in progress.
   - The exact error lines, including "after 4 attempts".
   - In the `dispatch` job, it is the App token that asks for `metadata: read`.
   - Make clear that `parallel-tasks` there is a profile name, not the removed setting.

   Fetch the missing Google Cloud pages into `docs/web/` before writing about them.
8. **Done on 2026-10-17.** **Development** (`development/*.md`):
   - `src/steps/` has 5 modules for 6 jobs (`keys.ts`).
   - `Services` has 8 members.
   - A gateway change reaches pods only after the digests are pinned again.
   - OpenCode's only provider is `openrouter`, or Codeman's gateway when self-hosted.
   - Firestore's data is built, not "next".
   - The emulator has 6 checks.
   - esbuild also bundles `dist/gateway.js`.
   - Biome has platform packages.
   - `.npmrc` also sets `engine-strict`.
   - Tests run every step on the fake platform.
   - Pods also carry `CODEMAN_POOL`.
9. **Code comments that are wrong.** List them for the owner; this plan does not change code. The comment on the `dispatch` token in `templates/codeman.yml` ("revoked when its step ends") was corrected to "its job", since it is a template comment and needs no version bump:
   - `src/settings.ts:82-83` (`pod-reuse: task`);
   - `src/state.ts:1` (pull requests);
   - `src/tasks.ts:260` (`pendingWork`).

## Progress

Every doc correction is in, as of 2026-10-17. `npm run lint`, `npm run typecheck` and `npm test` pass: 624 tests, 621 pass and 3 skipped.

Pinning the images from `e26a8c9` in `src/inference/images.ts` closed the last step of the [plan for keeping a spent pod for its close](2026-10-15-keep-a-spent-pod-for-its-close.md). It goes in a commit of its own.

The plan stays `in progress` until the code plans that the decisions call for exist. Correcting the docs surfaced these behaviors, which the docs now describe and those code plans should take up:

- **A review during `awaiting-decision` chains `record` runs.** While a task is `codeman:awaiting-decision`, a maintainer review that requests changes, or has `/codeman` in its text, makes every run a `record` run. Each one chains to the next and posts a run comment until the decisions are answered. A probe on the fake platform reproduced it. This is likely a bug, related to decision 2. Fixed by the [plan for commands around decisions and review rounds](2026-10-19-commands-around-decisions-and-review-rounds.md), step 2.
- **`/codeman continue` does not reset review rounds; a `fix` does.** After review blocks a task, the next round that asks for changes blocks it again, although the message says to continue. This goes with decision 3. Fixed by the [plan for commands around decisions and review rounds](2026-10-19-commands-around-decisions-and-review-rounds.md), step 3; the `max-runs` difference between stages and review stays open.
- **Commands ignored or refused in some places:**
  - Answers, `set` and `accept-workflows` written in a review's text are ignored.
  - Extra text on an `approve` or `decide` line makes the command invalid.
- **No source for some figures:**
  - No source gives the size of Codeman's vLLM image, "about 9.1 GB" in `settings/vllm.md`.
  - No template sets `key-expiry-hours`.
- **Disabling the service account versus the pool.** Disabling the service account rejects tokens it already issued. Disabling the Workload Identity pool leaves a job's service-account token valid for up to about 55 minutes.
- **Deleting the database does not reset every budget:**
  - A task's spend carries over from its record on GitHub.
  - The organization's month still counts what a GPU account billed.

## Out of scope

- Restructuring pages, new headings, diagrams, the glossary and the index. They are in the [restructuring plan](2026-10-16-restructure-the-docs-for-readers.md).
- Code changes, including those the decisions may lead to. Each one gets its own plan.
- Refreshing pages in `docs/web/`. Pages that are missing are only added.
