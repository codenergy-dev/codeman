# Codeman's documentation

One subject per file, grouped by what the reader wants to do. The [root README](../README.md) says what Codeman is.

## Setting it up

- [Installation](installation/setup.md): the GitHub App, OpenRouter, the credentials, the backend and the workflow, step by step; then trying it.
- [Shared settings](installation/shared-settings.md): settings an organization gives all its repositories.
- [Self-hosted inference on Runpod](installation/runpod.md): the Runpod account, pods and a Serverless endpoint.
- [Profiles](installation/profiles.md): how to use different providers and models for different runs.
- [Upgrading](installation/upgrading.md): old setting names, a model per provider, and workflow files copied before the backend.

## Using it

- [Settings](settings/reference.md): where settings come from, every setting, and the file's format.
- [Providers](settings/providers.md): each provider's settings, model IDs, secrets and cost.
- [Profiles](settings/profiles.md): conditions, which profile applies, layers and checks.
- [Provider settings across layers](settings/provider-settings-across-layers.md): what a layer or profile that changes provider keeps, with worked examples.
- [Commands](tasks/commands.md): every `/codeman` command.
- [Comments](tasks/comments.md): the status, decisions and run comments, and the conversation's language.

## How it works

- [Task lifecycle](tasks/lifecycle.md): a task's states and their labels.
- [Stages](tasks/stages.md): the seven stages, one per agent run, and which are routed; planning, routing, running a routed stage, and feedback.
- [Runs and jobs](runs/runs-and-jobs.md): what starts a run, parallel tasks, and each job with its credentials.
- [The agent](runs/agent.md): its sandbox, its working rules, and its output and limits.
- [What the agent may change](runs/changes.md): the change policy, on-demand workflows, and third-party documentation.
- [Budget](budget/budget.md): the task's, the month's and the organization's budgets; reservations, expiry and refusals.
- [Spend](budget/spend.md): the spend table, and how self-hosted runs count.
- [OpenRouter](inference/openrouter.md): per-run keys, usage, analytics and key encryption.
- [Self-hosted inference](inference/self-hosted.md): Runpod's providers compared, the interfaces, and the gateway.
- [Pods](inference/pods.md): the pod registry, leases, and shared pods.
- [Serverless](inference/serverless.md): the endpoint's checks, the job queue, and worker-time estimates and splits.
- [Backend](backend/backend.md): Firestore's access, client, rules and cost; the store; the ledger.
- [Data layout](backend/data-layout.md): the backend's collections, documents, IDs, events and queries.

## Security

- [Security](security/overview.md): whom it is for, the checklist, and the roadmap.
- [Secrets](security/secrets.md): each secret, who uses it, why it is safe, its gaps and mitigations.
- [Risks](security/risks.md): the risks, from most to least severe, and untrusted input.

## Working on Codeman

- [Development](development/guide.md): scripts, the source layout, Firestore's emulator and conventions.
- [Platforms](development/platforms.md): the platform interfaces, and what an adapter must guarantee.
- [Dependencies](development/dependencies.md): what Codeman depends on, why, and the last audit.
- [Plans](plans/): one file per piece of work, with its decisions; the project's history.
- [Third-party documentation](web/): the pages of the services Codeman relies on, and how each was fetched.
