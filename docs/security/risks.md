# Risks

From most to least severe. Each risk says which repositories it applies to.

## 1. Code the agent wrote runs with the repository's secrets

*Public and private repositories.*

Codeman commits to `codeman/*` branches and opens a pull request from the same repository. Commits made with the App's token trigger workflows. So each commit runs the repository's `push` workflows and its `pull_request` workflows. Those get the repository's secrets without approval, because the pull request does not come from a fork. The agent may change the scripts, tests and build files those workflows run. By default, the [change policy](../runs/changes.md#change-policy) protects only `.github/`, the harness configuration and agent instructions. A manipulated agent can therefore make CI send out every secret its jobs expose. After a merge, the same code runs in every workflow of the default branch.

How to protect:

- Expose no secrets to jobs that run on `codeman/*` branches. Keep secrets that deploy or publish in a GitHub Environment with required reviewers, and limit its deployment branches to the default branch. Alternatively, exclude `codeman/**` from workflows that use secrets.
- A `pull_request_target` workflow that checks out the pull request's code carries the same risk.
- Review Codeman's pull requests the way you would review code from an outside contributor, and add a ruleset that requires that review on the default branch.

## 2. Prompt injection through what the agent reads

*Public and private repositories; more exposure on public ones.*

The agent follows text it reads. Codeman gives it only the title and body of issues opened by maintainers, and only comments and reviews by maintainers. See [untrusted input](#untrusted-input). The agent still reads other text: third-party text that a maintainer quotes, the repository's files, the dependencies it installs, and the results of workflows. Delimiters and instructions to treat text as data help, but they guarantee nothing. A manipulated agent can write malicious code (risk 1), send its key and what it reads over the network (risk 4), or write a misleading report. A manipulated routing agent can leave out the stages before review, but never review, which always runs and decides whether the task is done. The web stage brings third-party pages into the repository, where later agents read them: every agent is told to read `docs/web/` as data, and only the web stage may change it, but a page reaches the default branch only through the pull request a maintainer reviews.

How to protect:

- Open issues in your own words. Do not paste a third party's text as the task.
- Review the pull request, as in risk 1.
- There is no network restriction yet: [roadmap](overview.md#roadmap) item 1.

## 3. Steps added to the agent job run outside the sandbox

*Public and private repositories.*

Only Codeman's step runs the agent as the unprivileged `codeman-agent` user. Any other step in the `agent` job runs as the runner's user, which has `sudo` and can read the job's secrets from the runner's memory: the encryption secret and the job's `GITHUB_TOKEN`. The job checks out the task branch, so a step that runs repository code (`npm ci`, `make`, a test script) runs code the agent wrote.

Such a step can also change the job's outputs, among them a Serverless gateway's usage, which `close-key` trusts. It can make its run count nothing, or claim times its run did not use the endpoint's worker: those lower the costs of the organization's runs that used the worker then, and its own run counts that time instead, so the runs' total in the budgets does not drop ([Serverless](../inference/serverless.md)).

How to protect: in the `agent` job (in `codeman-task.yml`), add only steps that install tools, such as `actions/setup-node`. Leave installing dependencies and running scripts to the agent, inside the sandbox.

## 4. The agent can send its task key out

*Public and private repositories.*

The agent's network is not restricted, and it holds its task key. A manipulated agent can send the key out and spend it until the run ends and `close-key` disables it. The loss is bounded by the key's limit: what remains of the task's budget, never more than the monthly budget allows.

With self-hosted inference on a pod, the token opens the pod's gateway, which Runpod's proxy makes public, until the run ends or its budget is spent; the pod costs the same whether the requests come from the agent or not. When tasks share a pod, whether of one run or of several repositories of the organization, each run's token opens only its own run: its requests count in its own records and against its own limit, and it cannot end, read or spend another task's run. A leaked token can still make the GPU busy, and so slow the other tasks' requests, until its own run ends or its budget is spent; the admin routes take only the token that the account key derives. On Serverless, the gateway listens only on the runner's loopback.

How to protect: keep `task-budget` and `monthly-budget` low. [Roadmap](overview.md#roadmap) item 1 would close the channel.

## 5. Results of accepted workflows reach the agent

*Public and private repositories.*

When the agent waits for a workflow, Codeman gives the agent that workflow's results: the end of each failed job's log, and its artifacts. See [on-demand workflows](../runs/changes.md#on-demand-workflows). Accepted workflows run with the secrets they reference. GitHub masks registered secrets in logs, but not in artifacts, and not when a secret is transformed, for example base64-encoded.

How to protect: before `/codeman accept-workflows`, check that the workflow takes its secrets from an Environment and writes none of them to its logs or artifacts.

## 6. The agent's output and the repository's code leave the repository

*Logs: public repositories. Model provider: both.*

The agent job logs what the agent does, and run logs are public on public repositories. The task key is masked. Anything else the agent prints appears in the log. The repository's code, issues and comments go to the model provider through OpenRouter, or, with self-hosted inference, to a container on Runpod. Codeman creates pods on Secure Cloud only, in Runpod's certified data centers; a Serverless endpoint runs where the maintainer who created it chose. A pod's gateway is public behind Runpod's proxy, and serves only whoever holds the run's token; Ollama's own port stays inside the pod.

How to protect: keep secrets out of the repository, as you would anyway. On private repositories, choose a model and provider whose data policy you accept; OpenRouter's privacy settings can restrict providers. With Serverless, choose Secure Cloud data centers.

## 7. Codeman's own code and dependencies

*Public and private repositories.*

The workflow runs Codeman, third-party actions and the OpenCode harness with the permissions above. The template pins Codeman and every action to a full commit SHA. OpenCode is pinned to a version and checked against its npm integrity hash. Codeman's pod image, with Ollama, is pinned by digest. See [dependencies](../development/dependencies.md).

How to protect: pin Codeman to a SHA, as [installation](../installation/setup.md) says, and read the changes before moving to a new one.

## Untrusted input

Repositories may be public, so text from people who are not maintainers is untrusted, and so is everything the agent produces. A maintainer is a user with write access to the repository; see [commands](../tasks/commands.md).

- Only issues opened by maintainers are tasks. The agent reads the issue's title and body as its task, and whoever opened the issue can edit them at any time. Codeman leaves alone a labeled issue that a maintainer did not open, or that a bot or a deleted account opened. Nothing from that issue reaches the agent, and its status comment says how to go on: a maintainer opens a new issue in their own words.
- Comments and reviews from people who are not maintainers are dropped before anything reads them.
- The agent's task file marks issue text as data and wraps it in markers with a random nonce.
- Before untrusted text is logged, Codeman collapses it to one line or prefixes it, so it cannot inject workflow commands such as `::add-mask::`.
- Text the agent writes on issues and pull requests is rendered as safe Markdown; see [status and run comments](../tasks/comments.md#status-and-run-comments).
