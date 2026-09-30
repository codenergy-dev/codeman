---
status: completed
created_at: 2026-09-30T12:40:00-03:00
updated_at: 2026-09-30T13:30:00-03:00
commit: 4be0658
---

# Security model and maintainer-only issues

## Goal

A maintainer can decide whether Codeman is safe to run on a public or private repository by reading one document, `docs/security.md`. The document says who holds each secret and why it is safe, lists the real risks from most to least severe with how to protect against each, and holds a roadmap of security improvements. Codeman also accepts only issues opened by maintainers, which closes the easiest path for prompt injection.

## Context

A review of how secrets flow through the workflow (2026-09-30) found:

- Codeman's own secrets are well isolated. The App's private key reaches only `select` and `apply`, and the OpenRouter management key reaches only `open-key` and `close-key`. None of these jobs runs an LLM or repository code. The agent runs as `codeman-agent`, without `sudo`, with an allowlisted environment and without access to the runner's home. The only credential it holds is the run's task key, which has a spending limit, expires, is disabled after the run and is masked in logs.
- The issue's title and body are read fresh on every run, whoever wrote them (`toTask` in `src/tasks.ts`). A non-maintainer can open a harmless issue, wait for a maintainer to label it, then edit it into a prompt injection. Comments from non-maintainers are already dropped; the issue itself is not.
- The target repository's own CI runs on Codeman's commits (`push` to `codeman/*`, and `pull_request` from the same repository, which gets secrets without approval). The agent can change scripts, tests and build files that CI runs, so a manipulated agent can reach every secret those CI jobs expose.
- Steps a user adds to the `agent` job that run repository code (such as `npm ci`) run as the runner user, who has `sudo` and can read the job's secrets from the runner's memory. The installation guide does not warn against it.
- Security knowledge is spread across `docs/architecture.md` (Agent sandbox, Untrusted input, On-demand workflows) and `docs/installation.md`, with no single place that answers "is it safe?".

Constraints:

- Checking secrets that other workflows use without a GitHub Environment is left for later. The responsible person creates secrets at organization level, visible only to selected repositories. Organization-level visibility limits which repositories get a secret, not which workflows or branches within them. The document says so.
- Only one run per repository is active, and permission checks cost one API call per user per run, already cached in `select`.

## Decisions

Answer these before work starts.

Answered on 2026-09-30: the recommendation of each, (a). The responsible person also authorized the commit once the plan is complete.

1. **What happens to a labeled issue whose author is not a maintainer.** Options:
   - (a) Codeman leaves the issue alone (no state label, no agent), creates or updates its status comment on the issue to say why and how to go on (open a new issue as a maintainer with the content), and warns in the run's summary. The status comment is updated only when its content changes, so repeated runs do not spam the issue.
   - (b) Only a warning in the run's summary. The issue shows nothing.
   - (c) Set `codeman:blocked` with the reason in the status comment.

   Recommendation: (a). The maintainer who labeled the issue sees why nothing happens, on the issue itself. (b) is invisible to them. (c) suggests that `/codeman continue` helps, and it does not.

2. **Tasks already in a later state whose author is not a maintainer** (tasks from before this change, or an author who lost write access). Options:
   - (a) The same rule applies in every state. The task stops where it is, with the status comment explaining why.
   - (b) The rule applies only to `new` tasks.

   Recommendation: (a). The body is read again on every run, so the risk does not depend on the state.

3. **Where the "Untrusted input" section of `docs/architecture.md` lives.** Options:
   - (a) Move it to `docs/security.md`, and link to it from `docs/architecture.md`. Mechanisms that belong to the architecture (Agent sandbox, Change policy, On-demand workflows) stay there, and `docs/security.md` links to them.
   - (b) Keep it in `docs/architecture.md`, and link to it from `docs/security.md`.

   Recommendation: (a). "What input do we trust" is the core of the security document, and each fact stays in one place.

## Steps

1. **Maintainer-only issues.** `select` reads each labeled issue's author (`user.login`, `user.type`), checks the author's permission with the existing per-run cache, and applies decisions 1 and 2 to issues whose author is not a maintainer. An issue opened by a bot counts as not opened by a maintainer. Nothing from that issue (title, body, comments) reaches the task file. Add the message to both i18n catalogs. Done when unit tests cover: a maintainer's issue proceeds; a non-maintainer's issue is left alone with the status comment in each case of decision 2; an issue opened by a bot is left alone; the status comment is not rewritten when unchanged.
2. **`docs/security.md`**, with these sections:
   - **Secrets.** A table with the columns Secret, Used by, Safe, Why, Gap and Mitigation. One row each for: `CODEMAN_GITHUB_APP_PRIVATE_KEY` and its scoped tokens; `CODEMAN_OPENROUTER_MANAGEMENT_KEY`; `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET`; the run's task key; the `GITHUB_TOKEN` of `agent`; the `GITHUB_TOKEN` of `forward-review` and `next-run`; and the target repository's own secrets, used by its other workflows.
   - **Risks**, from most to least severe, each with who it affects (public, private or both repositories), what happens, and how to protect against it, or "no protection yet" with a link to the roadmap. Expected order, to be confirmed while writing:
     1. The repository's CI runs code the agent wrote, with the secrets it exposes.
     2. Prompt injection through what the agent reads: maintainer text that quotes third parties, repository files, dependencies, workflow results.
     3. Steps added to the `agent` job that run repository code outside the sandbox.
     4. The agent sends the task key out over its unrestricted network, bounded by the key's limit.
     5. The results of accepted workflows (logs, artifacts) reach the agent, including any secret a workflow wrote into them.
     6. The agent's output is in the run's logs, which are public on public repositories, and the repository's code goes to the model provider.
   - **Untrusted input**, moved from `docs/architecture.md` (decision 3), now with the maintainer-only issue rule.
   - **Checklist** for a new repository: App installed on selected repositories only; Codeman's secrets visible to selected repositories only; a ruleset on the default branch that requires a reviewed pull request; no secrets in jobs that run on `codeman/*` branches, or secrets behind an Environment with required reviewers; no repository code in the `agent` job; low budgets.
   - **Roadmap**: the improvements listed below, each with the risk it reduces.

   Done when every row of the table and every risk points to the code or document section that backs it, and nothing in it repeats what `docs/architecture.md` already says in full.
3. **Other documentation.** In `docs/architecture.md`: tasks are issues opened by a maintainer (Tasks and states, Commands), with a link to `docs/security.md`. In `docs/installation.md`, step 4: a warning against running repository code in the `agent` job, and a link to the checklist. In `templates/codeman.yml`: the same warning next to the place for setting up tools. In `README.md`: "you open an issue and label it", and `docs/security.md` under Learn more. Done when these files link to the new document and nothing contradicts it.
4. **Build and checks.** Rebuild `dist/`, run the tests and Biome. Done when all pass.
5. **Manual check** by the responsible person: on a test repository, label an issue opened by an account without write access and check the status comment; label a maintainer's issue and check that it plans as before.

### Roadmap to write in `docs/security.md`

These items are not implemented by this plan. Each will get its own plan.

1. **Restrict the agent's network** to an allowlist (OpenRouter, package registries), with `iptables` rules that match the agent's user (`-m owner --uid-owner`). This reduces risks 2 and 4.
2. **Test the sandbox against a hostile agent.** A CI job on a GitHub-hosted runner replaces the harness with a script that tries to read secrets (other users' `/proc/*/environ`, the runner's home, `sudo`, `docker`, the runner's credentials, cloud metadata endpoints) and fails the build if any attempt succeeds. This guards every claim in the Secrets table against regressions and runner image changes.
3. **Warn about secrets exposed to task branches.** `select` warns when a workflow that runs on `push` or `pull_request` for `codeman/*` branches references `secrets.*` outside an Environment. This reduces risk 1. It is deferred, as the constraints above explain.
4. **Detect extra steps in the `agent` job.** `select` reads the workflow file and warns when the `agent` job has `run` steps or unknown actions besides setup actions. This reduces risk 3.
5. **Review stage checks for exfiltration.** The review prompt looks for new network calls, reads of environment variables and changes to scripts that CI runs. This reduces risk 1 without replacing a human review.

## Out of scope

- Implementing any roadmap item.
- Checking who applied the `codeman` label. With maintainer-only authors, a label from a triage user only starts work on text a maintainer wrote.
- Pull requests as tasks, which Codeman does not handle yet.
- Changes to secrets, permissions or the App's registration.

## Outcome

Steps 1 to 4 are done.

- `toTask` keeps the issue's author (undefined for a bot or a deleted account), and `openedByMaintainer` in `src/tasks.ts` decides. `select` checks every labeled issue before its state, so decision 2 holds in any state, and nothing from a refused issue becomes a candidate. The panel comes from `renderRefused` in `src/status.ts`. It has no run link, so `select` writes it only when it differs from the current status comment (`findStatus` now returns the comment's body). `select` itself has no unit tests, since it only calls GitHub. The tests cover the author mapping, the maintainer check (maintainer, other user, bot, deleted account) and the panel: its record, its text in both catalogs, and that it is the same on every run.
- `docs/security.md` holds the secrets table, seven risks and the roadmap. While writing it, two risks joined the expected six: merged code, folded into risk 1, and Codeman's own supply chain, as risk 7. The roadmap puts the sandbox test second, since it guards every claim in the table.
- "Untrusted input" moved from `docs/architecture.md` to `docs/security.md`, now with the maintainer-only rule. `README.md`, `docs/installation.md` and `templates/codeman.yml` link to it or warn against running repository code in the `agent` job.

Step 5, the manual check, is left to the responsible person.
