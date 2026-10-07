---
status: in progress
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T15:36:20-03:00
commit: a8594ea
---

# Firestore backend

## Goal

Codeman gets an operational store, Cloud Firestore in a Firebase project, which its workflow jobs reach without a stored key, and it records each run and its events there. No behavior changes yet: this plan lays the ground for the [ledger budgets](2026-10-07-budgets-from-the-ledger.md), [pod registry](2026-10-07-pod-registry.md) and [Serverless split](2026-10-07-serverless-cost-split.md) plans.

## Context

- **Each job sees only its own state.** What jobs share goes through GitHub (labels, the task record in a comment, artifacts, job outputs) or through the pods themselves (`CODEMAN_REPOSITORY`, `CODEMAN_GROUP` in their environment, the gateway's `/admin/status`). Nothing is shared across repositories, and nothing is atomic across jobs. That is why shared pods are found by waiting and listing again, and a rare race still creates two ([shared pods](../architecture.md#shared-pods)); why parallel tasks reserve the month by an approximation ([budget](../architecture.md#budget)); why the month on Runpod is the account's late billing ([spend](../architecture.md#spend)); and why Serverless runs at once count shared time twice ([Serverless](../architecture.md#serverless)).
- **No server to host.** The responsible person wants no Codeman service to run. Firestore is a managed database with transactions and a free daily quota, reachable over HTTPS.
- **Security.** Every job with credentials must keep them from the agent: the `agent` job runs the agent in a sandbox, and the Serverless gateway beside it holds only the endpoint's key ([jobs](../architecture.md#jobs)). Long-lived keys in secrets are what Codeman avoids where it can. Dependencies are critical decisions, and small needs are written in-house ([AGENTS.md](../../AGENTS.md)).
- **Users.** Codeman is used by its responsible person alone; breaking changes are fine (2026-10-07).
- **Local tests.** The development machine has Java 21 and Firestore's emulator in Firebase's cache (`~/.cache/firebase/emulators/cloud-firestore-emulator-v1.20.4.jar`), but no `firebase` command.

## Decisions

The responsible person approved each recommendation on 2026-10-07.

1. **What goes in Firestore.** Options:
   - (a) Operational state only: runs, their costs and limits, reservations, pods and their leases, gateways' request intervals, events. GitHub stays the source of each task's state (labels, comments, record), which people read and change.
   - (b) Also the tasks' state, with GitHub as a view of it.

   Recommendation: (a). Tasks' state belongs where maintainers work on it; what needs sharing and atomicity is the operation.

   **Answer:** (a).
2. **Client.** Options:
   - (a) Firestore's REST API (v1), with an in-house client of what Codeman uses: get, create, update with preconditions, queries, transactions.
   - (b) `firebase-admin` or `@google-cloud/firestore`: large dependency trees (gRPC, Google's auth library).

   Recommendation: (a), as with Codeman's YAML subset.

   **Answer:** (a).
3. **Authentication.** Options:
   - (a) Workload Identity Federation with GitHub's OIDC: a job asks GitHub for an ID token (`getIDToken` of `@actions/core`, already a dependency), exchanges it at Google's STS for a federated token, and impersonates a service account that may use Firestore. The provider's attribute condition admits only the organization's repositories. No key is stored anywhere.
   - (b) A service account's JSON key in a secret.

   Recommendation: (a). Only the jobs that use Firestore get `id-token: write`; the `agent` job never does, so neither the agent nor the Serverless gateway can reach Firestore.

   **Answer:** (a).
4. **Required or optional.** Options:
   - (a) Required: a repository without the backend's variables fails with a message that says what to set. Codeman keeps one way of doing each thing.
   - (b) Optional, keeping today's behavior without it.

   Recommendation: (a). Two paths would keep the approximations the next plans remove.

   **Answer:** (a).
5. **Events and analytics.** Options:
   - (a) An events collection in Firestore, written by the jobs.
   - (b) Firebase Analytics (Google Analytics 4), made for web and mobile apps: sampled, limited, and hard to query.

   Recommendation: (a). An export to BigQuery can come later if heavy queries are needed.

   **Answer:** (a).

## Steps

1. Third-party docs in `docs/web/` ([third-party documentation](../../AGENTS.md#third-party-documentation)): Firestore's REST API (documents, `commit`, `beginTransaction`, `runQuery`, preconditions), the emulator, security rules, quotas and pricing; Google's STS token exchange, IAM Credentials' `generateAccessToken`, and Workload Identity Federation with GitHub; GitHub's OIDC (permission `id-token`, the token's claims, reusable workflows' claims). Done when each page the code relies on is recorded. **Done on 2026-10-07**: two tools, [Google Cloud](../web/tools/google-cloud.md) and [Firebase](../web/tools/firebase.md): both sites serve each page's Markdown at its URL plus `.md.txt`, and license their content CC BY 4.0 in the HTML page's footer, so pages are full copies.
   - [`docs/web/google-cloud/`](../web/google-cloud/): Firestore's REST resource for documents and its methods `batchGet`, `commit`, `beginTransaction`, `rollback` and `runQuery`, with `Precondition`, `Write`, `StructuredQuery`, `TransactionOptions` and `Value`; STS's `token`, IAM Credentials' `generateAccessToken`, Workload Identity Federation with deployment pipelines (GitHub included), and the provider resource, which says the default audience.
   - [`docs/web/firebase/`](../web/firebase/): the REST API's guide, the emulator, security rules, Firestore's IAM roles, usage and limits, billing, and transaction serializability.
   - [`docs/web/github/`](../web/github/): OpenID Connect, its reference (claims, `id-token: write`, reusable workflows), its setup for Google Cloud, and with reusable workflows.
   - Not recorded: Firestore's `get` method; reads use `batchGet`, since the emulator never answers a `get` inside a transaction (step 3).
2. A store interface (`src/store/`), with an in-memory implementation for unit tests and shared contract tests. The contract tests also run against the emulator when it is available (started with `java -jar` from Firebase's cache, or `FIRESTORE_EMULATOR_HOST`), and are skipped otherwise. Done when both implementations pass the same tests: reads, conditional writes, queries, and transactions that conflict. **Done on 2026-10-07**:
   - [`src/store/store.ts`](../../src/store/store.ts): `get`, `query` (equality and range filters on top-level fields, order, limit; a collection's own documents only), `write` (create, set, merge, delete, each applied all or none, with preconditions on existence or version), and `transaction`, which runs its work again when what it read changed, and throws `StoreConflict` after its attempts. Values are JSON's, plus dates.
   - [`src/store/memory.ts`](../../src/store/memory.ts) keeps Firestore's semantics where the contract checks them: typed order, a write that changes nothing keeps its version, and transactions checked at commit (optimistic), including their queries' results.
   - [`src/store/contract.ts`](../../src/store/contract.ts): nine tests, run by `memory.test.ts` and `emulator.test.ts`. Two transactions that read the same document, or run the same query and then insert into it, both commit in the end, one after running again: the second sees the first's write. The emulator, like Firestore's Standard edition, locks what a transaction reads (pessimistic), and aborts both after its 2-second lock timeout; they then retry.
   - `emulator.test.ts` uses `FIRESTORE_EMULATOR_HOST`, or starts the newest `cloud-firestore-emulator-v*.jar` of Firebase's cache with `java -jar` on a free loopback port, and gives each test a project of its own. It skips otherwise, as on CI, which has neither: adding the emulator to CI would be a CI change and a download, outside this plan.
3. The Firestore REST client and the authentication (OIDC, STS, impersonation), with tests on a fake `fetch`. Tokens are never logged. Done when tests cover a token exchange, a refusal, a transaction retried after a conflict, and the emulator path (no authentication). **Done on 2026-10-07**:
   - [`src/store/firestore.ts`](../../src/store/firestore.ts): the `(default)` database of the Firebase project, through `batchGet`, `runQuery`, `commit`, `beginTransaction` and `rollback`. Reads use `batchGet`, inside transactions and out: the emulator never answers `get` with a transaction. A failed precondition (`ALREADY_EXISTS`, `FAILED_PRECONDITION`, `NOT_FOUND` on a commit) is a `StoreConflict`; an aborted transaction (`ABORTED`) runs again after a random wait, naming the one before it (`retryTransaction`), up to 5 times; a transaction whose work fails is rolled back, which releases its locks. Each request has 30 seconds. Other errors say Firestore's status and message, and are not retried here: the ledger retries its writes (step 6).
   - [`src/store/google.ts`](../../src/store/google.ts): the job's OIDC token, for the provider's default audience (`https://iam.googleapis.com/<provider>`), goes to STS (`token`, scope `cloud-platform`), whose federated token calls IAM Credentials' `generateAccessToken` for the service account, scope `datastore` only, for an hour. The token is kept until 5 minutes before it expires; both tokens are masked, and errors carry only the services' error codes and messages.
   - The emulator path has no token, and only tests take it: the action never reads `FIRESTORE_EMULATOR_HOST`, so no setting can send a job's writes to an unauthenticated server (a choice this plan did not settle).
4. The data layout: collections, document IDs and fields, keyed by organization and repository so that one project serves several, documented in [`docs/architecture.md`](../architecture.md). Security rules deny every client access: only the service account, through IAM, reaches the data. Done when the layout is documented and the rules file is in the repository. **Done on 2026-10-07**: [`src/store/layout.ts`](../../src/store/layout.ts) and architecture's [data layout](../architecture.md#data-layout).
   - `organizations/{owner}/runs/{run}` and `organizations/{owner}/events/{event}`; the repository is a field (`owner/name`), not a level, so an organization's and a repository's runs of a month, and a task's runs, are equality queries, which Firestore's automatic single-field indexes serve without composite indexes. A collection group across levels would need indexes enabled by hand. Owners and repositories are lowercase, as GitHub compares them; logins rather than numeric IDs, as everywhere else in Codeman (key names, `CODEMAN_REPOSITORY`).
   - A run's ID is `{workflow run}-{attempt}-{task}`, where the attempt is the one in which `select` picked the task: a re-run of failed jobs keeps it, a re-run of the whole workflow is a new run. An event's ID is its run's, then its type, then its subject (a pod).
   - Runs have documents only when their task runs an agent; `task-picked` events cover every task `select` picks. `month` is the UTC month in which `select` picked the run, for the budgets' queries.
   - The rules, [`firebase/firestore.rules`](../../firebase/firestore.rules), deny every read and write; the emulator test loads them and checks that a request without a token is refused.
5. Wiring: the backend's settings (project, Workload Identity provider, service account) as variables, not secrets, passed to the action; `id-token: write` in the jobs that use the store, and never in `agent`. A run without them fails in `select` and says what to set. Done when `templates.test.ts` checks the permissions and a test covers the missing settings. **Done on 2026-10-07**:
   - Variables `CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER` and `CODEMAN_SERVICE_ACCOUNT`, passed as the inputs `firebase-project`, `workload-identity-provider` and `service-account` to `select`, `open-key`, `close-key` and `release-pod`, which alone have `id-token: write`. The `task` call in `codeman.yml` grants it too, since a called workflow's jobs can only reduce what the call grants; `agent` and `apply` declare their own permissions without it.
   - `apply` does not use the store (a choice): the one event it could write, the agent job's result, `close-key` writes with a new input, `agent-job-result`, which keeps `id-token: write` to four jobs.
   - `select` gives each task its run's ID as a new matrix field and input of `codeman-task.yml`, `ledger-run`, which the three key jobs take. Workflow files must be copied again, as they must anyway for the variables.
   - [`src/store/backend.ts`](../../src/store/backend.ts): a step without a setting fails, naming the missing variables and the installation's section; a malformed provider, service account or project ID fails the same way. `select` and `open-key` read the store before anything else, so a backend that refuses the job also fails them before they mark a task or open a key (a choice: failing first is the conservative reading of decision 4).
   - The runtime gained the run's attempt (`GITHUB_RUN_ATTEMPT`) and `idToken`, which calls `getIDToken` and, without the permission, says to add `id-token: write`.
   - The attribute condition in [installation](../installation.md#4-set-up-the-backend) is stricter than the plan's "the organization's repositories" (a choice): the owner's numeric ID, which Google advises over its name, and `workflow_ref` equal to the repository's `.github/workflows/codeman.yml` on `main`. So no other workflow of the organization, such as one that runs code the agent wrote on a task branch, reaches the backend.
   - Tests: `templates.test.ts` checks which jobs have `id-token: write`, the variables and `ledger-run`; `backend.test.ts` covers the missing and malformed settings, and a `select` that fails before it marks any task.
6. The run ledger: each run's document (repository, task, workflow run, stage, provider, model, start and end, limit, cost, tokens) and events (task picked, key opened or refused, pod created, joined or terminated, run stopped, run closed), written by the jobs that know them. Writes are idempotent (a re-run writes the same documents) and retried; a write that still fails fails its job, after the job's GitHub writes. Nothing reads them yet. Done when tests on the in-memory store cover a run's documents and a re-run. **Done on 2026-10-07**: [`src/ledger.ts`](../../src/ledger.ts).
   - `select` starts each agent run's document (repository, task, workflow run, attempt, month, stage, model, provider, mode, profile, `pickedAt`) and writes `task-picked` for every task it picks. `open-key` adds `openedAt` and `limit`, and `key-opened`; or `refusedAt`, `refusal` and `reason`, and `key-refused`. `close-key` adds `closedAt`, the cost, the token figures it knows and the pod, and `run-closed`, plus `run-stopped` when the agent job did not succeed. Pods' events (`pod-created`, `pod-joined`, `pod-terminated`) come from the provider, which now reports what it did with pods when it opens and closes a run, and from `release-pod`.
   - Each job writes at its end, in one commit: `select` after it marks its tasks, `close-key` and `release-pod` after they end the run's access and terminate pods. A run's fields are merged, and events replace the document of their ID, so a re-run writes the same documents. A write is tried four times, 1, 3 and 9 seconds apart, then fails the job.
   - Tests on the in-memory store, `ledger.test.ts`: a run's documents through every job, a refusal, retries and a failure, and a task from `select` to `close-key` whose key jobs run again in the next attempt, writing the same documents.
7. Docs: [installation](../installation.md) (create the Firebase project, Firestore in Native mode and its location, the rules, the Workload Identity pool and provider with its attribute condition, the service account and its role, the variables), [architecture](../architecture.md) (a Backend section), [security](../security.md), [dependencies](../dependencies.md) (no new package), [development](../development.md) (the emulator). Done when a reader can set it up from the docs alone. **Done on 2026-10-07**: installation's new part 4 sets the backend up step by step, with `gcloud` commands for the parts the Firebase console does not cover (APIs, service account, pool, provider and binding), and the variables; the workflow became part 5. Architecture has a Backend section (the store, the data layout, the ledger), and the jobs' credentials; security, a row for the OIDC token and the backend's tokens, and a checklist item; dependencies, the external services and an audit of Firestore; development, the emulator; the README mentions the Firebase project.
8. Rebuild `dist/` and run `npm run check`. Done when it passes.

## End-to-end test

On the test repository, in its organization, with the Google account that will own the Firebase project. Nothing here costs money: the project needs no billing account, and Firestore's free quota covers it.

1. **Set up the backend** as [installation](../installation.md#4-set-up-the-backend) says, and note each value:
   1. Create the Firebase project, and the Firestore database: Standard edition, `(default)`, a location, production mode.
   2. Publish [`firebase/firestore.rules`](../../firebase/firestore.rules). In **Rules → Rules Playground**, simulate a `get` of `/organizations/x`, unauthenticated: it is denied.
   3. In Cloud Shell, enable the APIs, create the service account `codeman` with `roles/datastore.user`, create the pool `codeman` and the provider `github` with the attribute condition (the organization's ID from `gh api orgs/<organization> --jq .id`, and the test repository's default branch in place of `main` if it differs), and bind `roles/iam.workloadIdentityUser` to the pool's identities.
   4. Add the three variables to the organization, visible to the test repository (or to the repository itself, if it is private on GitHub Free).
   5. Copy `templates/codeman.yml` and `templates/codeman-task.yml` of the commit under test into the test repository's `.github/workflows/`, with `COMMIT_SHA` replaced by that commit, and keep the steps the test repository adds to the `agent` job.
2. **A run's documents.** Open an issue in the test repository, label it `codeman`, and run the workflow manually. When the plan is posted:
   - The logs of `select`, `open-key` and `close-key` each end with "Recorded N document(s) in Codeman's ledger.", and none warns that it could not write.
   - In **Firestore Database → Data**, `organizations/<owner>/runs/<run ID>-1-<issue>` has `status: closed`, the stage `plan`, the model and provider, `pickedAt`, `openedAt` and `closedAt`, the `limit` of the spend table's row, and its `cost` and tokens as `close-key` reported them (the spend table shows the same, until a later run refreshes the cost).
   - `organizations/<owner>/events` has `<run ID>-1-<issue>-task-picked`, `-key-opened` and `-run-closed`; with a pod profile, also `-pod-created-<pod>`, and `-pod-terminated-<pod>` from `close-key` or `release-pod`.
3. **A re-run.** In the run's page, re-run the task's `Close key` job, with whatever jobs GitHub re-runs after it. The ledger has no new run document (no `<run ID>-2-<issue>`); the run's `closedAt` and its `run-closed` event changed, and the event's `attempt` is 2. Then cancel a later run while its agent works, and use **Re-run failed jobs**: again the same run's documents, now with a `run-stopped` event.
4. **Permissions.** In each job's log, **Set up job → GITHUB_TOKEN Permissions**: `select`, `Open key`, `Close key` and `Release pod` list `IdToken: write`; `Agent` and `Apply` do not.
5. **Missing settings.** Remove `CODEMAN_SERVICE_ACCOUNT` and run the workflow: `select` fails with "Codeman's backend is not set up: this step has no `CODEMAN_SERVICE_ACCOUNT`", and no task's labels or comments change. Restore it.
6. **Other workflows and owners.** Copy `codeman.yml` in the test repository as `codeman-copy.yml` (changing nothing else) and run it: `select` fails with "Google's STS refused the request", for the attribute condition. Delete the copy. From a repository of another owner, with the same variables and templates, `select` fails the same way.
7. **Usage.** Under **Firestore Database → Usage**, the day's reads and writes are a few dozen, far within the free quota.

## Out of scope

- Reading the ledger: the next three plans do.
- Moving the organization's settings from the `CODEMAN_SETTINGS` variable to Firestore. A later plan may, if GitHub Free's limit on organization variables in private repositories matters.
- Firebase Analytics, Cloud Functions, or any hosted Codeman service.
