---
status: pending
created_at: 2026-10-07T14:56:15-03:00
updated_at: 2026-10-07T14:56:15-03:00
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

1. Third-party docs in `docs/web/` ([third-party documentation](../../AGENTS.md#third-party-documentation)): Firestore's REST API (documents, `commit`, `beginTransaction`, `runQuery`, preconditions), the emulator, security rules, quotas and pricing; Google's STS token exchange, IAM Credentials' `generateAccessToken`, and Workload Identity Federation with GitHub; GitHub's OIDC (permission `id-token`, the token's claims, reusable workflows' claims). Done when each page the code relies on is recorded.
2. A store interface (`src/store/`), with an in-memory implementation for unit tests and shared contract tests. The contract tests also run against the emulator when it is available (started with `java -jar` from Firebase's cache, or `FIRESTORE_EMULATOR_HOST`), and are skipped otherwise. Done when both implementations pass the same tests: reads, conditional writes, queries, and transactions that conflict.
3. The Firestore REST client and the authentication (OIDC, STS, impersonation), with tests on a fake `fetch`. Tokens are never logged. Done when tests cover a token exchange, a refusal, a transaction retried after a conflict, and the emulator path (no authentication).
4. The data layout: collections, document IDs and fields, keyed by organization and repository so that one project serves several, documented in [`docs/architecture.md`](../architecture.md). Security rules deny every client access: only the service account, through IAM, reaches the data. Done when the layout is documented and the rules file is in the repository.
5. Wiring: the backend's settings (project, Workload Identity provider, service account) as variables, not secrets, passed to the action; `id-token: write` in the jobs that use the store, and never in `agent`. A run without them fails in `select` and says what to set. Done when `templates.test.ts` checks the permissions and a test covers the missing settings.
6. The run ledger: each run's document (repository, task, workflow run, stage, provider, model, start and end, limit, cost, tokens) and events (task picked, key opened or refused, pod created, joined or terminated, run stopped, run closed), written by the jobs that know them. Writes are idempotent (a re-run writes the same documents) and retried; a write that still fails fails its job, after the job's GitHub writes. Nothing reads them yet. Done when tests on the in-memory store cover a run's documents and a re-run.
7. Docs: [installation](../installation.md) (create the Firebase project, Firestore in Native mode and its location, the rules, the Workload Identity pool and provider with its attribute condition, the service account and its role, the variables), [architecture](../architecture.md) (a Backend section), [security](../security.md), [dependencies](../dependencies.md) (no new package), [development](../development.md) (the emulator). Done when a reader can set it up from the docs alone.
8. Rebuild `dist/` and run `npm run check`. Done when it passes.

## End-to-end test

1. Set up the backend as [installation](../installation.md) says, on the test repository's organization.
2. Run a task to its first stage. In the Firestore console, the run's document and its events are there, with the run's cost and tokens as the spend table shows them.
3. Re-run the workflow's failed or last jobs: the run's documents are the same, not duplicated.
4. The `agent` job's permissions list no `id-token`.
5. Remove the service account variable: the next run fails in `select`, saying what to set. Restore it.
6. From a repository outside the organization, the token exchange is refused (the provider's attribute condition).

## Out of scope

- Reading the ledger: the next three plans do.
- Moving the organization's settings from the `CODEMAN_SETTINGS` variable to Firestore. A later plan may, if GitHub Free's limit on organization variables in private repositories matters.
- Firebase Analytics, Cloud Functions, or any hosted Codeman service.
