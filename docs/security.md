# Security

This document tells you whether Codeman is safe to run on your repository. It covers which secrets Codeman uses and why each one is safe, the real risks, from most to least severe, and how to protect against them. It also lists what is planned to make Codeman safer. The mechanisms themselves are described in [architecture](architecture.md).

Codeman runs an AI agent that reads text and runs shell commands. Read everything below assuming the agent can be manipulated: whatever the agent can reach, an attacker who controls text it reads can reach too.

## Secrets

The workflow is [`templates/codeman.yml`](../templates/codeman.yml), which runs each task's jobs (`open-key`, `agent`, `close-key`, `apply`, `release-pod`) in [`templates/codeman-task.yml`](../templates/codeman-task.yml); the jobs are described in [architecture](architecture.md#jobs). `codeman.yml` passes that workflow its secrets by name, and grants it at most the `agent` job's permissions plus `id-token: write`, which only the jobs that use Codeman's [backend](architecture.md#backend) ask for; each of its jobs references only the secrets the table below names, and asks for its own permissions.

| Secret | Used by | Safe | Why | Gap | Mitigation |
| --- | --- | --- | --- | --- | --- |
| `CODEMAN_GITHUB_APP_PRIVATE_KEY`, and the App tokens made from it | `select`, `apply` | Yes | These jobs run no LLM and no repository code. Each requests a token with only the permissions it needs. `apply` treats the agent's result as untrusted and filters it through the [change policy](architecture.md#change-policy). The token that may write workflows is requested only to move workflows a maintainer accepted. | The App may write to every branch of the repositories it is installed on. Codeman only writes to task branches, but nothing else stops it. | Install the App on selected repositories only. Add a ruleset on the default branch that requires a pull request. |
| `CODEMAN_OPENROUTER_MANAGEMENT_KEY` | `open-key`, `close-key` | Yes | These jobs check out nothing, run no LLM and only call OpenRouter. | None known. | — |
| `CODEMAN_RUNPOD_API_KEY` (self-hosted inference) | `open-key`, `close-key`, `release-pod` | Yes | These jobs check out nothing, run no LLM and only call Runpod and the pods' gateways. Pods get only the hash of their admin token, derived from this key. | It may do anything in the Runpod account, including spend all its credits. | An account dedicated to Codeman, with prepaid credits and no auto-pay ([installation](installation.md#self-hosted-inference-on-runpod)). |
| `CODEMAN_RUNPOD_SERVERLESS_KEY` (self-hosted inference on Serverless) | Codeman's step in `agent`, which runs the gateway | Yes, with the `agent` job as the template has it | The same isolation as the encryption secret: the agent gets only a local URL and the run's token, which stops working when the run ends or its budget is spent. | It does not expire and has no spending limit. A step added to `agent` that runs repository code can read it ([risk 3](#3-steps-added-to-the-agent-job-run-outside-the-sandbox)), and run the endpoint at the account's cost until someone revokes it. | Restrict it to the endpoint; keep the endpoint at one worker; prepaid credits. If a step did run repository code, revoke the key. |
| `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET` | `open-key`, `agent` | Yes, with the `agent` job as the template has it | In `agent`, only Codeman's own step holds it. The agent runs as another user, which cannot read that step's process. See [agent sandbox](architecture.md#agent-sandbox). | A step added to `agent` that runs repository code runs as the runner's user and can read it ([risk 3](#3-steps-added-to-the-agent-job-run-outside-the-sandbox)). With it, anyone can decrypt the task keys in the run logs, which are public on public repositories. | Run no repository code in `agent`. If a step did, rotate the secret. Each key it protects is disabled when its run ends and expires within 24 hours. |
| The run's task key, or its token for a self-hosted gateway | The agent, in `agent` | Partly | It is the agent's own credential. Its limit is what remains of the task's budget. `close-key` disables it (or ends the run on its gateway) when the run ends; a key expires after 24 hours, a pod's run once its budget is spent. On a pod that several tasks share, of any repository of the organization, it opens only its own run. It is masked in the logs, and it travels between jobs encrypted. See [budget](architecture.md#budget). | A manipulated agent can send it out ([risk 4](#4-the-agent-can-send-its-task-key-out)). | Keep the task budget low. [Roadmap](#roadmap) item 1. |
| `GITHUB_TOKEN` of `agent` (contents and actions read) | Codeman's step in `agent`, to download the results of workflows | Yes | The same isolation as the encryption secret. It can only read. | The same as the encryption secret. | The same as the encryption secret. |
| GitHub's OIDC token, and the backend's tokens made from it (`id-token: write`) | `select`, `open-key`, `close-key`, `release-pod` | Yes | These jobs run no LLM and no repository code. No key is stored: the OIDC token proves the job's repository and workflow, and Google exchanges it for an hour's access as the backend's service account, to Firestore only. The provider's attribute condition admits only the organization's repositories, by its ID, from `codeman.yml` on the default branch. Both tokens are masked. `agent` never gets one, so neither the agent nor a Serverless gateway reaches the backend. See [backend](architecture.md#backend). | Whoever can change `codeman.yml` or `codeman-task.yml` on the default branch can read and write all of the project's Firestore data, which holds Codeman's records but no secret (the pod registry holds each pod's nonce, from which only the GPU account key derives its admin token), and so can make other repositories' pods end or take new tasks; the condition cannot tell one job of the workflow from another, so `id-token: write` given to `agent` would let the agent in. | A Firebase project for Codeman only; the attribute condition of [installation](installation.md#4-set-up-the-backend); reviewed pull requests on the default branch; never give `agent` that permission. |
| `GITHUB_TOKEN` of `forward-review` and `next-run` (actions write) | These jobs | Yes | They only start the Codeman workflow with `gh workflow run`. They check out nothing, and values reach the command through environment variables, not the script. | None known. | — |
| The repository's own secrets, used by its other workflows | The repository's workflows. Codeman never reads them. | Depends on those workflows | Codeman does not reference them. | Workflows that run on Codeman's branches run code the agent wrote, with the secrets those workflows expose ([risk 1](#1-code-the-agent-wrote-runs-with-the-repositorys-secrets)). | See risk 1. |

Organization secrets whose visibility is limited to selected repositories stay limited to those repositories. Inside each of them, though, every workflow that references them gets them, on any branch, including Codeman's task branches.

Variables are not secrets. The backend's variables (`CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER`, `CODEMAN_SERVICE_ACCOUNT`) name the project and the identity, and grant nothing without a job's OIDC token that the provider admits. `CODEMAN_SETTINGS`, the organization's [shared settings](installation.md#shared-settings), is plain text: every repository it is shared with can read it, in any workflow, and the `select` job prints it and the values it gives in its log, which is public on public repositories. Settings never hold secrets; never put one in this variable. Whoever can change it changes the settings of every repository it is shared with, budgets and model included: only organization owners can, and each repository's `.codeman/settings.yml` still overrides it.

## Risks

From most to least severe. Each risk says which repositories it applies to.

### 1. Code the agent wrote runs with the repository's secrets

*Public and private repositories.*

Codeman commits to `codeman/*` branches and opens a pull request from the same repository. Commits made with the App's token trigger workflows. So each commit runs the repository's `push` workflows and its `pull_request` workflows. Those get the repository's secrets without approval, because the pull request does not come from a fork. The agent may change the scripts, tests and build files those workflows run. By default, the [change policy](architecture.md#change-policy) protects only `.github/`, the harness configuration and agent instructions. A manipulated agent can therefore make CI send out every secret its jobs expose. After a merge, the same code runs in every workflow of the default branch.

How to protect:

- Expose no secrets to jobs that run on `codeman/*` branches. Keep secrets that deploy or publish in a GitHub Environment with required reviewers, and limit its deployment branches to the default branch. Alternatively, exclude `codeman/**` from workflows that use secrets.
- A `pull_request_target` workflow that checks out the pull request's code carries the same risk.
- Review Codeman's pull requests the way you would review code from an outside contributor, and add a ruleset that requires that review on the default branch.

### 2. Prompt injection through what the agent reads

*Public and private repositories; more exposure on public ones.*

The agent follows text it reads. Codeman gives it only the title and body of issues opened by maintainers, and only comments and reviews by maintainers. See [untrusted input](#untrusted-input). The agent still reads other text: third-party text that a maintainer quotes, the repository's files, the dependencies it installs, and the results of workflows. Delimiters and instructions to treat text as data help, but they guarantee nothing. A manipulated agent can write malicious code (risk 1), send its key and what it reads over the network (risk 4), or write a misleading report. A manipulated routing agent can leave out the stages before review, but never review, which always runs and decides whether the task is done. The web stage brings third-party pages into the repository, where later agents read them: every agent is told to read `docs/web/` as data, and only the web stage may change it, but a page reaches the default branch only through the pull request a maintainer reviews.

How to protect:

- Open issues in your own words. Do not paste a third party's text as the task.
- Review the pull request, as in risk 1.
- There is no network restriction yet: [roadmap](#roadmap) item 1.

### 3. Steps added to the agent job run outside the sandbox

*Public and private repositories.*

Only Codeman's step runs the agent as the unprivileged `codeman-agent` user. Any other step in the `agent` job runs as the runner's user, which has `sudo` and can read the job's secrets from the runner's memory: the encryption secret and the job's `GITHUB_TOKEN`. The job checks out the task branch, so a step that runs repository code (`npm ci`, `make`, a test script) runs code the agent wrote.

Such a step can also change the job's outputs, among them a Serverless gateway's usage, which `close-key` trusts. It can make its run count nothing, or claim times its run did not use the endpoint's worker: those lower the costs of the organization's runs that used the worker then, and its own run counts that time instead, so the runs' total in the budgets does not drop ([Serverless](architecture.md#serverless)).

How to protect: in the `agent` job (in `codeman-task.yml`), add only steps that install tools, such as `actions/setup-node`. Leave installing dependencies and running scripts to the agent, inside the sandbox.

### 4. The agent can send its task key out

*Public and private repositories.*

The agent's network is not restricted, and it holds its task key. A manipulated agent can send the key out and spend it until the run ends and `close-key` disables it. The loss is bounded by the key's limit: what remains of the task's budget, never more than the monthly budget allows.

With self-hosted inference on a pod, the token opens the pod's gateway, which Runpod's proxy makes public, until the run ends or its budget is spent; the pod costs the same whether the requests come from the agent or not. When tasks share a pod, whether of one run or of several repositories of the organization, each run's token opens only its own run: its requests count in its own records and against its own limit, and it cannot end, read or spend another task's run. A leaked token can still make the GPU busy, and so slow the other tasks' requests, until its own run ends or its budget is spent; the admin routes take only the token that the account key derives. On Serverless, the gateway listens only on the runner's loopback.

How to protect: keep `task-budget` and `monthly-budget` low. [Roadmap](#roadmap) item 1 would close the channel.

### 5. Results of accepted workflows reach the agent

*Public and private repositories.*

When the agent waits for a workflow, Codeman gives the agent that workflow's results: the end of each failed job's log, and its artifacts. See [on-demand workflows](architecture.md#on-demand-workflows). Accepted workflows run with the secrets they reference. GitHub masks registered secrets in logs, but not in artifacts, and not when a secret is transformed, for example base64-encoded.

How to protect: before `/codeman accept-workflows`, check that the workflow takes its secrets from an Environment and writes none of them to its logs or artifacts.

### 6. The agent's output and the repository's code leave the repository

*Logs: public repositories. Model provider: both.*

The agent job logs what the agent does, and run logs are public on public repositories. The task key is masked. Anything else the agent prints appears in the log. The repository's code, issues and comments go to the model provider through OpenRouter, or, with self-hosted inference, to a container on Runpod. Codeman creates pods on Secure Cloud only, in Runpod's certified data centers; a Serverless endpoint runs where the maintainer who created it chose. A pod's gateway is public behind Runpod's proxy, and serves only whoever holds the run's token; Ollama's own port stays inside the pod.

How to protect: keep secrets out of the repository, as you would anyway. On private repositories, choose a model and provider whose data policy you accept; OpenRouter's privacy settings can restrict providers. With Serverless, choose Secure Cloud data centers.

### 7. Codeman's own code and dependencies

*Public and private repositories.*

The workflow runs Codeman, third-party actions and the OpenCode harness with the permissions above. The template pins Codeman and every action to a full commit SHA. OpenCode is pinned to a version and checked against its npm integrity hash. Codeman's pod image, with Ollama, is pinned by digest. See [dependencies](dependencies.md).

How to protect: pin Codeman to a SHA, as [installation](installation.md) says, and read the changes before moving to a new one.

## Untrusted input

Repositories may be public, so text from people who are not maintainers is untrusted, and so is everything the agent produces. A maintainer is a user with write access to the repository; see [commands](architecture.md#commands).

- Only issues opened by maintainers are tasks. The agent reads the issue's title and body as its task, and whoever opened the issue can edit them at any time. Codeman leaves alone a labeled issue that a maintainer did not open, or that a bot or a deleted account opened. Nothing from that issue reaches the agent, and its status comment says how to go on: a maintainer opens a new issue in their own words.
- Comments and reviews from people who are not maintainers are dropped before anything reads them.
- The agent's task file marks issue text as data and wraps it in markers with a random nonce.
- Before untrusted text is logged, Codeman collapses it to one line or prefixes it, so it cannot inject workflow commands such as `::add-mask::`.
- Text the agent writes on issues and pull requests is rendered as safe Markdown; see [status and run comments](architecture.md#status-and-run-comments).

## Checklist

Before running Codeman on a repository:

1. Install the App on selected repositories only.
2. Make Codeman's secrets visible only to the repositories that use it.
3. Add a ruleset on the default branch that requires a reviewed pull request.
4. Check which secrets the workflows that run on `codeman/*` branches expose. Move secrets that deploy or publish to an Environment with required reviewers ([risk 1](#1-code-the-agent-wrote-runs-with-the-repositorys-secrets)).
5. In the `agent` job, add only steps that install tools ([risk 3](#3-steps-added-to-the-agent-job-run-outside-the-sandbox)).
6. Keep `task-budget` and `monthly-budget` low ([risk 4](#4-the-agent-can-send-its-task-key-out)), and with several repositories, set `organization-monthly-budget` in the organization's settings. A repository's admins can still replace those settings, with a repository variable `CODEMAN_SETTINGS` or by changing its workflow file, so the organization's budget holds as far as they are trusted. With self-hosted inference, use a Runpod account dedicated to Codeman, with prepaid credits and no auto-pay.
7. Give the backend a Firebase project of its own, with the rules and the attribute condition of [installation](installation.md#4-set-up-the-backend), and grant its service account only Cloud Datastore User.
8. Label only issues you opened, written in your own words.

## Roadmap

Planned improvements, most valuable first. Each will get its own plan.

1. **Restrict the agent's network** to an allowlist (OpenRouter or the run's gateway, package registries), with `iptables` rules that match the agent's user. This reduces risks 2 and 4.
2. **Test the sandbox against a hostile agent.** A CI job on a GitHub-hosted runner replaces the harness with a script that tries to read secrets: other users' `/proc/*/environ`, the runner's home, `sudo`, `docker`, the runner's credentials and cloud metadata endpoints. The build fails if any attempt succeeds. This keeps the [secrets](#secrets) table true as Codeman and the runner images change.
3. **Warn about secrets exposed to task branches.** `select` warns when a workflow that runs on `push` or `pull_request` for `codeman/*` references `secrets.*` outside an Environment. This reduces risk 1.
4. **Warn about extra steps in the agent job.** `select` reads the workflows and warns when the `agent` job has `run` steps, or actions other than known setup actions. This reduces risk 3.
5. **Have the review stage look for exfiltration:** new network calls, reads of environment variables, and changes to scripts that CI runs. This reduces risk 1, and does not replace a human review.
