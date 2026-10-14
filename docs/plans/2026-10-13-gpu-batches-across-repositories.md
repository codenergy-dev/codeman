---
status: pending
created_at: 2026-10-13T20:52:00-03:00
updated_at: 2026-10-13T20:52:00-03:00
commit: 95962c0
---

# GPU batches across repositories

## Goal

A profile's count (`tasks`, `min-tasks`, `max-tasks`) means the tasks of one batch on one GPU, which may come from several repositories, and several organizations of a declared pool: 2 tasks ready in repository A and 2 in repository B form a batch of 4 on one pod, each running in its own repository's workflow and counting against its own organization's budget.

## Context

- **Today.** `select` reads only its own repository's tasks (`src/steps/select.ts`). `pickAgentTasks` (`src/tasks.ts`) takes the largest count n for which n of the run's agent tasks are served with n: the count is every agent task of the run, whatever its provider (choice 7 of the [plan for profiles that pick the tasks](2026-10-08-profiles-pick-the-tasks.md)). So 2 ready tasks in A and 2 in B wait forever under `tasks: 4`. Pods are shared across the organization's repositories only by chance: a task that opens a key while a pod of the same settings serves or is kept joins it ([shared pods](../inference/pods.md#shared-pods)); the registry joins the oldest serving pod of the settings with no limit on how many runs it holds.
- **Runs.** They start on `issue_comment`, `pull_request_review` (forwarded with `workflow_dispatch`), `workflow_dispatch`, a daily schedule and the `next-run` chain ([runs and jobs](../runs/runs-and-jobs.md)). One run per repository is active (`concurrency: codeman`, one pending run, replaced by the next); that, not any lock, is what keeps two runs off one task.
- **Credentials.** Every App token comes from `actions/create-github-app-token` without `owner` or `repositories`, so it covers only the current repository. The App is private ("only on this account"), with Actions read-only ([setup](../installation/setup.md#1-register-the-github-app)). The backend's Workload Identity provider admits one owner's repositories, from `codeman.yml` on the default branch; [setup](../installation/setup.md#4-set-up-the-backend) already documents `assertion.repository_owner_id in ['<ID>', '<ID>']` for several.
- **Firestore.** Everything is under `organizations/{owner}/` ([data layout](../backend/data-layout.md)): runs, events, the pod registry, the cache of fits and the Serverless endpoints' runs. Budgets read the organization's runs, its pods' untracked time, and reconcile them with the Runpod account's hourly billing ([budget](../budget/budget.md)).
- **Constraints.** GitHub stays the source of truth of tasks ([backend plan](2026-10-07-firestore-backend.md), decision 1). No new dependency. Breaking changes to data and settings are acceptable: Codeman has one user, the responsible person, who owns two organizations ("organization A" and "organization B" below) and wants them in one pool. The `agent` job never gets a new credential.

### What the third-party documentation says

Recorded in `docs/web/github/` for this plan; each fact links to its page.

- **Public Apps.** A public App can be installed by any account; a private one only on its owner's account ([public or private](../web/github/making-a-github-app-public-or-private.md)). Installing grants the App's requested permissions on the repositories chosen ("Only select repositories"); organization owners install, and repository admins may when the App asks no organization permission ([third-party installation](../web/github/installing-a-github-app-from-a-third-party.md)). The same App can be installed on several accounts ([own App](../web/github/installing-your-own-github-app.md)). Making an App public is not listing it in the Marketplace, which is a separate step.
- **Tokens for another owner.** An installation token is minted with the App's JWT for one installation, optionally narrowed to some repositories and permissions; it lasts one hour and can never exceed what the installation granted ([generating a token](../web/github/generating-an-installation-access-token-for-a-github-app.md), [REST for Apps](../web/github/rest-api-endpoints-for-github-apps.md#create-an-installation-access-token-for-an-app)). `actions/create-github-app-token` at the pinned v3.2.0 (`bcd2ba4…`) takes `owner` and `repositories` (names may be `owner/repo`; the owner must match), one owner per step; with `repositories` it scopes the token to them, with `owner` alone to the whole installation; the token is revoked in the step's post action, so it cannot leave the job ([README](../web/github/create-github-app-token.md#inputs)). Its `lib/main.js` at that commit finds the installation with `GET /repos/{owner}/{repo}/installation` (or `GET /users/{owner}/installation` without `repositories`): it never lists installations.
- **Permission changes.** When an App asks for more permissions, each installation's administrator must approve them before its tokens get them ([README, How it works](../web/github/create-github-app-token.md#how-it-works)).
- **Dispatching.** `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` needs Actions write, and accepts installation tokens; it now answers 200 with `workflow_run_id` ([workflows API](../web/github/rest-api-endpoints-for-workflows.md#create-a-workflow-dispatch-event), [permissions](../web/github/permissions-required-for-github-apps.md#repository-permissions-for-actions)). Actions write also lets a token cancel, re-run and delete runs, disable workflows and set the repository's OIDC `sub` customization; `repository_dispatch` needs Contents write instead. `workflow_dispatch` takes at most 25 inputs and 65,535 characters ([events](../web/github/events-that-trigger-workflows.md#workflow_dispatch)). Events from an App token start workflows; those from `GITHUB_TOKEN` do not, except `workflow_dispatch` and `repository_dispatch` ([triggering](../web/github/triggering-a-workflow.md#triggering-a-workflow-from-a-workflow)).
- **Issue events.** `issues` has 20 activity types, among them `opened`, `labeled`, `unlabeled`, `closed` and `reopened`; it runs the default branch's workflow ([events](../web/github/events-that-trigger-workflows.md#issues)). The Markdown source does not show the `label` field of `labeled` payloads ([payloads](../web/github/webhook-events-and-payloads.md#issues)): `github.event.label.name` is to be checked in the end-to-end test. **Codeman's own label changes are made with the App token, so each one starts the workflow**; the `if` must filter them.
- **Skipped jobs.** A job whose `if` is false is never sent to a runner and reports success ([conditions](../web/github/using-conditions-to-control-job-execution.md), [contexts](../web/github/contexts-reference.md#context-availability)). Minutes are runner time, each job rounded up to a whole minute, free on public repositories ([billing](../web/github/github-actions-billing.md), [pricing](../web/github/actions-runner-pricing.md)); so a skipped run costs no minutes (inferred: the pages do not say it in those words).
- **Concurrency.** One pending run per group by default, replaced by the next; `queue: max` keeps up to 100 ([concurrency](../web/github/control-the-concurrency-of-workflows-and-jobs.md)). The workflow's `concurrency` may use `github`, `inputs` and `vars` ([contexts](../web/github/contexts-reference.md#context-availability)), so its group can depend on the event. **A run whose jobs are all skipped still takes its place in the workflow's group** (to confirm in the end-to-end test): today every comment without `/codeman`, Codeman's own comments included, can replace a pending run that had work, and issue events would do it far more often. The concurrency groups API lists a group's running and pending runs with Actions read ([concurrency groups](../web/github/rest-api-endpoints-for-actions-concurrency-groups.md)).
- **Suspending.** The App's owner can suspend any installation through the API, one at a time; an account that installed the App can suspend it in the web interface; each side unsuspends only its own suspensions ([suspending](../web/github/suspending-a-github-app-installation.md), [REST for Apps](../web/github/rest-api-endpoints-for-github-apps.md#suspend-an-app-installation)).

## Decisions

### Answered by the responsible person on 2026-10-13

1. **Batches per GPU across repositories.** A profile's count means the tasks of a batch on one GPU (one pod), which may come from several repositories; not the tasks of one run.
2. **A board in Firestore.** Each `select` publishes its repository's ready tasks (stage, candidate pod settings and profiles). GitHub stays the source of truth and the board is only an index:
   1. each `select` rewrites its repository's whole snapshot at once, so closed, relabeled or started tasks disappear;
   2. entries carry the issue's update time and expire;
   3. a repository whose tasks another repository's batch reserved re-validates each one against GitHub before running it, and drops and releases those no longer ready.

   Worst case, an inconsistency makes a batch smaller; it never runs a task that should not run.
3. **Reserving and dispatching.** When demand for the same pod settings across repositories completes a profile's count, a `select` reserves the batch in a Firestore transaction and dispatches the other repositories' workflows (`workflow_dispatch`), each running exactly its reserved tasks. This needs an App installation token for another owner with Actions write on the target repositories: a permission change, decided in decision 7.
4. **Issue triggers to reduce latency.** `codeman.yml` also runs on `issues` `opened`, `labeled`, `unlabeled` and `closed`; its jobs are skipped for issues without the `codeman` label (no minutes); queued runs are replaced as today.
5. **A pool from the start.** A declared, closed list of organizations shares the board, the pod registry and the Runpod account; by default a pool is the organization alone. Organizations A and B form one pool. Each organization keeps its own budget (`organization-monthly-budget`). Codeman never lists the App's installations: it mints tokens only for owners in the pool's list, so strangers who install the public App are ignored.
6. **The App becomes public**, installable by link and not listed in the Marketplace, so each organization installs it with "Only select repositories"; the same private key is in each organization's secrets.

   Security analysis, to record in [security](../security/overview.md):
   - A stranger who installs the App gains nothing: without the private key they mint no token, and Codeman never acts on owners outside the pool.
   - Whoever holds the key gains access to the stranger's installed repositories, with the App's permissions; Codeman ignores them through the pool's list, but a person with the key does not have to. The App's owner sees every installation in the App's settings and can suspend any.
   - A leaked key reaches every installation, the pool's and any stranger's: rotate it (an App may hold several keys; delete the leaked one) and suspend installations while doing so.
   - A pool is mutual trust: anyone who can change `codeman.yml` on a default branch in any member organization holds the key, and so reaches every member's installed repositories with the App's permissions (Contents and Workflows write already). Inside one organization this is true today.
   - Alternative considered: one private App per organization, each key also in the other organizations' secrets. The same trust, more upkeep (an App, a client ID and a key per member, and each workflow choosing the right one per owner).

### Open: answers needed before work starts

7. **The App's permissions, and which jobs get a token for another owner.** Minimum privilege; `agent` never gets one.
   - (a) A new `dispatch` job in `codeman.yml`, after `select`, one matrix leg per repository to wake. Each leg mints, with `actions/create-github-app-token`, a token for that owner with `repositories: <that repository>` and `permission-actions: write` only, and runs `gh workflow run`. No checkout, no OIDC, `permissions: {}` for its `GITHUB_TOKEN`. The App's Actions permission goes from read to **read and write**, which each installation approves once. `select`, `apply` and every other job keep their tokens as they are.
   - (b) The same, with `select`'s Codeman step minting the tokens itself from the private key (JWT signed with `node:crypto`). No new job, but Codeman's own code then handles the key and the JWT, which the audited action does today.
   - (c) A token for the whole owner (no `repositories`) in `select`. Simpler matrix, broader token: every repository of the owner's installation.

   Recommendation: (a). The only token for another owner is one job's, for one repository, Actions write, for one call, revoked at the end of its step. `repository_dispatch` was ruled out: it needs Contents write.

   **Answer:**

8. **Where the pool is declared, and how a mismatch shows.**
   - (a) A `pool` setting that only the organization's settings set (`CODEMAN_SETTINGS`, like `organization-monthly-budget`): a list of owner logins that must include the organization itself, such as `pool: [organization-a, organization-b]`. Its ID is the sorted logins, lowercase, joined by `+`; without the setting, the pool is the organization alone, and its ID its login. Each `select` writes the pool it declares on its organization's document (`organizations/{owner}`: `pool`, `members`, `declaredAt`); it batches with another member only when that member's document declares the same pool, and otherwise logs, once per run, "Organization B declares pool `b`, not `a+b`: its repositories are not batched with this one's." Each member writes only its own board under its own pool ID, so a mismatch can never mix two pools' data; it only keeps them apart.
   - (b) A separate variable, `CODEMAN_POOL`, with the same handshake.
   - (c) A pool document in Firestore, written by hand in the console.

   Recommendation: (a). One place for the organization's shared settings; the handshake needs both sides to agree, so neither can pull the other in. Owners that are user accounts, and private repositories on GitHub Free, have no organization variables: they set it in a repository variable `CODEMAN_SETTINGS`, as for every shared setting ([shared settings](../installation/shared-settings.md)).

   **Answer:**

9. **Firestore's layout, and the migration.**
   - (a) What belongs to an organization stays under `organizations/{owner}/`: `runs` and `events`, which the budgets and history read. What the pool shares moves under `pools/{pool}/`: `pods`, `endpoints/{endpoint}/runs`, the board (`board/{owner%2Frepository}`) and the batches (`batches/{id}`). The cache of fits, which depends only on image, model, GPU and Ollama settings, moves to a top-level `contexts/{key}`. The old `pods`, `contexts` and `endpoints` stay as history, unread, except that the organization's month also reads the old `pods` collection until the month of the change ends, so untracked time recorded before it still counts. Upgrade every member's repositories at once, with no live pod.
   - (b) Everything under `pools/{pool}/`, runs and events with an `organization` field.
   - (c) Flat top-level collections with `owner` and `pool` fields.

   Recommendation: (a). Budgets stay per organization with their queries unchanged; only what is shared moves.

   **Answer:**

10. **How a batch is formed.**
    - **The board.** One document per repository, rewritten whole by each of its `select`s: the repository, its default branch and workflow file, `updatedAt`, `expiresAt`, and its ready tasks that a pod profile could serve, each with its number, the issue's `updated_at`, its stage, `since` (when the board first listed it ready, carried from the previous snapshot) and its offers: each count n at which its profile serves it, with that profile's name and the pod settings' key (the registry's hash, `num-parallel` included). Tasks this `select` starts, and tasks no pod profile serves, are left out.
    - **Who forms.** (a) Any `select`, after writing its snapshot, forms every batch the pool's board completes, in one transaction with the reservations, whether or not its own repository has tasks in it. (b) Only batches that include its own tasks. (c) One coordinator, such as a scheduled run of one repository.
    - **Priority.** (a) Oldest `since` first across the pool, then repository and issue number. (b) Round-robin across repositories. (c) The forming repository's tasks first.
    - **The algorithm.** For each pod settings key, the largest n (from the cap down) for which at least n unreserved tasks offer (n, key), taking the first n in priority order; repeated while the board completes another batch, up to Codeman's cap of 10 tasks per run for the forming repository's own matrix.

    Recommendation: (a) and (a). A batch the board completes is never left waiting for a particular repository's next run, and age is the only fairness that needs no setting.

    **Answer:**

11. **Reservations, and a target repository that is busy.** A batch's document holds each repository's reserved tasks with their n, profile and settings key, `formedBy` (the run), `formedAt` and `expiresAt`; the target's `select` marks each task `started` or `dropped`.
    - **Whose reservation.** It belongs to the repository, not to the dispatched run: any `select` of that repository honors it, so a dispatched run that GitHub replaces in the queue loses nothing.
    - **How long.** (a) 30 minutes, dispatching always; when the target's group is running a long run, its tasks may miss the window and return to the board, and the batch runs smaller. (b) 2 hours, as a run's reservation: the batch waits for busy repositories, its pod serving fewer runs meanwhile. (c) (a), and the `dispatch` leg reads the target's `codeman` group with the concurrency groups API (Actions read, within its token) and logs when it is running.
    - **The concurrency group.** (a) Dispatched runs join the `codeman` group, one pending as today; runs that will skip every job go to a group of their own, `codeman-skipped-<run id>`, computed in the workflow's `concurrency` from the event, so they never replace a pending run; `forward-review` too. (b) `queue: max` for the `codeman` group. (c) A separate group for dispatched runs, with per-task leases in Firestore instead of one run per repository.

    Recommendation: (c) for how long, (a) for the group. One run per repository stays the guard against two runs on one task; the dynamic group also fixes today's replacements by skipped comment runs.

    **Answer:**

12. **What a count counts, and the picker.**
    - (a) A count is the size of a batch: the tasks that run at once with the same resolved settings. On a pod, the batch may span the pool's repositories, and the board and reservations form it; on OpenRouter or Serverless, it is the tasks of the run that take that profile. Tasks without an agent come first, as today; the run's cap stays the largest count (10 for `min-tasks` alone, 1 with no count). The example of [profiles](../settings/profiles.md#example) changes: 1 planning task and 3 code tasks no longer make 4; the code tasks take `mig` (3).
    - (b) Counts only on `runpod-pod` profiles; a count on another provider's profile stops the run with an error.
    - (c) Batches for pods; the run's count, as today, for other providers.

    Recommendation: (a). One meaning for every provider; parallel OpenRouter runs keep working with `max-tasks`. A waiting task's panel counts the pool: "Waiting for 4 tasks ready for profile `parallel-tasks`; 3 are, in 2 repositories."

    **Answer:**

13. **How many runs a pod holds.**
    - (a) The registry joins a pod only while its unexpired run leases, plus its batch's reservations not yet joined, are fewer than the settings' `num-parallel`; a task that finds every pod of its settings full creates another. A kept pod serves the next batch.
    - (b) A pod per batch: tasks join only their batch's pod.
    - (c) As today: no limit.

    Recommendation: (a). Without it, two batches of 4 on the same settings share one pod sized for 4.

    **Answer:**

14. **Budgets across organizations.** Each run counts against its own organization's month and its repository's (decision 5). Two questions remain.
    - **A pod's untracked time** (its life no run counted): (a) split among the organizations in proportion to the time their runs counted on it, or to the creator's organization when none did; (b) the creator's organization; (c) evenly among the organizations that used it; (d) a pool budget.
    - **Runpod's billing, with one account for the pool.** The organization's month counts, for each billed hour, the higher of the bill and its own runs' estimate: with a shared account, each organization would count the others' GPU time. (a) Each hour, each organization counts its estimate plus its share of what the bill exceeds the pool's estimate, in proportion to its estimate; an hour billed with no estimate splits evenly among the pool's organizations. (b) No reconciliation when the account is shared; only the ledger's estimates and untracked time. (c) One Runpod account per organization: no pod is shared across organizations.

    Recommendation: (a) and (a). Every billed cent counts once, in the organizations that used the account then. Sharing pods across organizations requires one Runpod account: a pod's admin token is an HMAC of the account's key, so another key cannot join or end it.

    **Answer:**

15. **The registry and the orphan sweep across the pool.**
    - (a) A pod's environment carries `CODEMAN_POOL`, `CODEMAN_ORGANIZATION` (its creator's) and the account's fingerprint (an HMAC of the GPU key with a fixed label, never the key); its document carries the fingerprint, and a task joins only pods of its own account. The sweep, as today only with its own account's listing, terminates the pods of its pool that the pool's registry does not hold; pods from before the change that carry `CODEMAN_ORGANIZATION` of its own organization and no pool; and pods of another pool created by its own organization only when that pool's registry does not hold them either.
    - (b) Each organization sweeps only the pods it created.
    - (c) Any pod with Codeman's environment of any member.

    Recommendation: (a). It never ends a pod another pool still uses, and a member that stops running Codeman leaves no pod behind.

    **Answer:**

16. **Workload Identity Federation for the pool.**
    - (a) One provider whose condition lists the pool's owner IDs (`assertion.repository_owner_id in ['<A>', '<B>']`), as [setup](../installation/setup.md#4-set-up-the-backend) documents; adding a member updates the condition.
    - (b) One provider per organization, each admitting its own ID, all impersonating the same service account; each organization's variables name its own provider.

    Recommendation: (a). The condition is the real boundary of the pool: only the owners it admits can write the board, the batches and the registry; Codeman cannot read it, and a member it does not admit fails in `select` with today's backend error.

    **Answer:**

17. **The issue triggers' cost and noise.** The `select` job runs for `issues` when the event's label is `codeman` (`labeled`, `unlabeled`) or the issue has it (`opened`, `closed`); every other `issues` event, and every label change Codeman makes (`codeman:*`), skips every job, in a group of its own (decision 11). Each run that does select costs about one runner minute on private repositories (none on public ones); skipped runs cost none, but each appears in the Actions tab.
    - (a) The approved types: `opened`, `labeled`, `unlabeled`, `closed`.
    - (b) Also `reopened`: a reopened task is ready again.
    - (c) Without `opened`: an issue created with the label also sends `labeled` (to confirm in the end-to-end test), so `opened` adds a second run.

    Recommendation: (b) and (c): `labeled`, `unlabeled`, `closed`, `reopened`.

    **Answer:**

18. **Failure modes.**
    - **A dispatch is refused** (the App is not installed on the repository, its new permission is not approved, the installation is suspended, the workflow is missing or disabled): (a) the `dispatch` leg fails, visibly in the forming run, and the reservation expires after its 30 minutes; the forming repository's tasks run on their pod meanwhile; (b) the leg also releases the reservation at once, which needs `id-token: write` in `dispatch`; (c) `select` checks each target first, which needs a token for each.
    - **A member organization's secrets or variables are missing.** Its runs fail where they fail today (`select` without the backend's variables; `open-key` blocks a task whose provider's key is missing, naming it), and its reservations expire. Nothing new is needed.

    Recommendation: (a). A dispatch that fails is a setup mistake, shown in the job; the batch only shrinks.

    **Answer:**

## Steps

Each step ends with `npm run check` passing, unless it says otherwise.

1. **This plan.** Done when the responsible person has answered decisions 7 to 18, the answers are recorded here, and the status is `in progress`.
2. **Third-party documentation.** Done when the pages this plan cites are in `docs/web/github/` and the web-docs test passes. Done while writing the plan.
3. **Settings** (`src/settings.ts`): the `pool` setting (decision 8), only in the organization's layer, with its errors; the pool ID; counts as batches (decision 12): for a stage, each task's offers (n, profile, pod settings key). Done when `src/settings.test.ts` covers the setting's errors and the offers of the profiles' example.
4. **Layout and migration** (`src/store/layout.ts`, `src/ledger.ts`, `src/inference/registry.ts`, `src/inference/selfhosted.ts`): the paths of decision 9; the organization's month reading the old pods. Done when the contract, ledger, registry and emulator tests pass on the new paths.
5. **The pool's handshake** (decision 8): `select` writes its organization's document and reads the members'. Done when tests cover a pool both sides declare, one side only, and a member that never ran.
6. **The board** (decision 10): each `select` rewrites its repository's snapshot, keeps `since`, and reads the pool's unexpired snapshots. Done when tests on the memory store cover a rewrite that drops a closed task, expiry, and `since` kept.
7. **Batches and reservations** (decisions 10 to 12): a pure `formBatches` over the board; the reservation transaction; `select` honoring its repository's reservations first, re-validating each task against GitHub, dropping and releasing those no longer ready, resolving each task's profile with the batch's n; the pool-wide waiting message; the `dispatches` output (owner, repository, workflow, default branch, batch ID), only for owners in the pool. Done when tests cover: 2 and 2 across two repositories forming 4; oldest first; a reservation honored by a run other than the dispatched one; an expired reservation returning its tasks; a re-validation dropping a closed task; an owner outside the pool never in `dispatches`; and two `select`s at once on the emulator reserving each task once.
8. **The registry across the pool** (decisions 13 and 15): capacity, the account's fingerprint, the pool's sweep. Done when `registry.test.ts` and `selfhosted.test.ts` cover a full pod making the next task create another, a pod of another account left alone, and each sweep case of decision 15.
9. **Budgets** (decision 14): the untracked time's split and the pool's billing reconciliation. Done when `budget.test.ts` and `ledger.test.ts` cover a pod shared by two organizations, its untracked time split, and a billed hour split between them.
10. **Workflows** (decisions 7, 11 and 17): `templates/codeman.yml` gets the `issues` trigger, the `select` job's conditions, the event-dependent concurrency group (with `forward-review` in its own), the `batch` input (for the log only; `select` trusts only Firestore) and the `dispatch` job; `action.yml` the `dispatches` output. Done when `src/templates.test.ts` asserts the triggers, that `dispatch` has no `id-token`, no checkout and only `permission-actions: write`, and that `agent`'s permissions are unchanged.
11. **Docs**: [runs and jobs](../runs/runs-and-jobs.md), [profiles](../settings/profiles.md) (its example), [settings](../settings/reference.md), [task lifecycle](../tasks/lifecycle.md), [pods](../inference/pods.md), [budget](../budget/budget.md), [spend](../budget/spend.md), [backend](../backend/backend.md), [data layout](../backend/data-layout.md), [security](../security/overview.md) with the analysis of decision 6, [secrets](../security/secrets.md) (the key in `dispatch`, Actions write), [risks](../security/risks.md), [setup](../installation/setup.md) (a public App, installing it in each organization, the secrets in each, the condition), [shared settings](../installation/shared-settings.md) (`pool`), [upgrading](../installation/upgrading.md) (counts as batches, the layout, approving the App's new permission, every repository at once) and `docs/README.md`. Done when the docs test and the link checker pass.
12. **Build.** Rebuild `dist/`. Done when `npm run check` passes, the tree is clean, and whether `dist/gateway.js` changed is recorded (a new pod environment variable may need a new image).

## End-to-end test

By the responsible person, with Codeman installed from the plan's last commit. Costs are estimates, with Runpod's RTX PRO 6000 at about US$ 2 an hour and its MIG 2g.48gb partition at about US$ 1; check Runpod's prices. OpenRouter's planning runs cost a few cents each. GitHub Actions minutes are free on public repositories; on private ones each task's jobs take about 15 to 40 runner minutes (`open-key` waits for the pod), within the plans' free minutes.

**Setup, at no cost.**

1. In the App's settings, make it public, and change Actions to read and write. In organization A, approve the new permission.
2. Install the App on organization B, "Only select repositories", choosing one repository of organization B (the "B repository").
3. In organization B, add the same secrets and variables as organization A: the App's client ID and private key, the Runpod key (the same account), the OpenRouter keys, an encryption secret, and the backend's three variables.
4. Update the provider's condition with both organizations' IDs (`gcloud iam workload-identity-pools providers update-oidc ... --attribute-condition=...`).
5. In both organizations' `CODEMAN_SETTINGS`, the same profiles, and `pool: [<organization A>, <organization B>]`. For steps 6 to 10, a profile with `tasks: 2` on the MIG partition; for step 11, the profiles' example with `tasks: 4` on the full GPU.
6. Copy the new workflow files into the test repository, a second repository of organization A (the "second repository") and the B repository. No pod is live.

**Triggers and the queue, at no cost beyond a few runner minutes.**

7. In the test repository, label an issue `codeman`: a run starts and its `select` runs. Change a `codeman:*` label by hand, edit the issue, and let Codeman comment: each event's run skips every job and its group is `codeman-skipped-<id>`. With a run in progress and one pending, comment without `/codeman`: the pending run is not replaced. Close the issue: a run removes it from the board (Firestore: `pools/<a>+<b>/board/...`). Check `github.event.label.name` in a run's log, and whether creating an issue with the label sends `labeled` (decision 17).

**Two repositories of organization A. About US$ 1 to 1.50.**

8. With one task ready past planning in the test repository and none elsewhere, start a run: its panel says "Waiting for 2 tasks ready for profile `…`; 1 is, in 1 repository." No pod. Then make one task ready in the second repository: its `select` forms the batch, its run starts its task, and its `dispatch` leg starts the test repository's workflow, whose `select` logs the reserved task, re-validates it and starts it. One MIG pod holds both runs, seats of both repositories; each repository's ledger has its run. Cost: one pod for about 30 minutes, US$ 0.50.
9. **Re-validation.** Repeat with a new pair, and close the test repository's issue before its dispatched run's `select`: it drops the task and releases it; the batch's document says `dropped`; the second repository's task runs alone on its pod. Cost: about US$ 0.50.
10. **A refused dispatch.** Remove the test repository from the App's installation, and repeat: the `dispatch` leg fails; after 30 minutes the reservation expires and the task's panel says it waits again. Put the repository back. Cost: about US$ 0.50, the forming task's pod.

**Two organizations. About US$ 0.50 to 1.**

11. One task ready in the B repository and one in the test repository, `tasks: 2`: one pod holds both. The B run's document is under `organizations/<b>/runs`, the test repository's under `organizations/<a>/runs`, the pod under `pools/<a>+<b>/pods`. When the pod ends, its untracked time is split between both organizations' months, and each `open-key` logs its organization's month with its own runs only. The next day, compare Runpod's billing with both months' counts.
12. **A mismatch.** Remove `pool` from organization B's settings: organization A's `select` logs that B declares pool `<b>`; B's ready task is not batched with A's. Put it back. No cost.
13. **A stranger.** Install the App on a personal account outside the pool, on one repository: nothing in any run mentions it; no token is minted for it. Uninstall it. No cost.

**The real target. About US$ 1 to 2.**

14. With the profiles' example (`tasks: 4` on the full GPU, `mig` up to 3), two tasks ready in the test repository and two in the B repository: one batch of 4 on one full-GPU pod, two in each repository's run.

Total: about US$ 3 to 5 on Runpod, a few cents on OpenRouter, and Firestore within its free quota.

## Out of scope

- Batches for Serverless endpoints, which scale by themselves, and for OpenRouter beyond the run.
- A budget for the whole pool.
- Listing the App's installations, or suspending unknown ones automatically: the App's owner does that by hand.
- Moving tasks' state out of GitHub.
- Per-task leases that would let two runs of one repository run at once (option (c) of decision 11's group).
- Pull requests as tasks.
