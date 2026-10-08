# Architecture

Codeman is a GitHub Action written in TypeScript. A workflow in the target repository runs it; see [installation](installation.md). The workflow templates are [`templates/codeman.yml`](../templates/codeman.yml) and [`templates/codeman-task.yml`](../templates/codeman-task.yml), which runs each task's jobs. Codeman's logic reaches GitHub only through interfaces, so other platforms can be added; see [platforms](#platforms).

## Tasks and states

A task is an open issue with the `codeman` label, opened by a maintainer. A maintainer applies the label to opt in; Codeman ignores everything else. (Pull requests are not handled yet.) A labeled issue that a maintainer did not open is left alone, and its status comment says why; see [untrusted input](security.md#untrusted-input).

Each task has at most one state label. A task without one has not started yet (`new`).

| Label | Meaning |
| --- | --- |
| `codeman:planning` | Agent is writing the plan. |
| `codeman:awaiting-decision` | Plan posted; decisions pending. |
| `codeman:ready` | All decisions answered; the next run starts the routing agent. |
| `codeman:routing` | The routing agent is choosing the stages that run next. |
| `codeman:researching` | The web stage is recording third-party documentation. |
| `codeman:designing` | The design stage is working. |
| `codeman:coding` | The code stage is working. |
| `codeman:testing` | The test stage is working. |
| `codeman:reviewing` | The review stage is working. |
| `codeman:in-progress` | Left from before stages: the task goes on in the code stage. |
| `codeman:awaiting-workflow` | Waiting for workflows the agent asked for; see [on-demand workflows](#on-demand-workflows). |
| `codeman:blocked` | Needs human attention; the status comment says how to go on (usually `/codeman continue`), and the last run comment says why. |
| `codeman:done` | Reviewed; the pull request is ready for a human review. |

A task with more than one state label is invalid: Codeman reports a warning and leaves it alone.

## Runs

- Triggers: a daily schedule, `workflow_dispatch`, and `issue_comment` when the comment contains `/codeman` and its author is not a bot. Anyone can start a run this way, but `select` ignores comments from non-maintainers, so the run finds nothing new to do.
- Reviews also trigger a run: `pull_request_review`, on a pull request from a `codeman/` branch of the same repository, when the review requests changes or mentions `/codeman`. A review event runs the workflow file of the pull request's branch, which may be older than the default branch's, so its only job, `forward-review`, starts the default branch's workflow with `workflow_dispatch`. It holds no secrets; its `GITHUB_TOKEN` has `actions: write` only.
- Only one run per repository is active (`concurrency`). GitHub keeps at most one queued run and replaces older queued runs.
- Each run reads the state of every task from GitHub instead of reacting only to the event that started it. A replaced or failed run therefore loses no work; the next run picks it up.
- When a run moved a task (it recorded answers, or the agent ran), the `next-run` job starts another run with `workflow_dispatch`, carrying over a manual run's inputs. That run's `select` picks the next tasks, or stops without an LLM when none can move. A task without a key (monthly budget reached, or the key job failed) does not count as moved, because it would be picked again without moving, and a run in which no task moved starts no other run. The loop is bounded by the budgets, `max-runs` and the states: tasks that are blocked, done or awaiting an answer never start a run.
- Each run works on up to `parallel-tasks` tasks (default 1), picked in this order: accepting workflows and recording answers first, because they need no LLM; then the oldest task that needs a plan; then the oldest task in a stage or routing: resumed with `fix` or `continue`, or already in a stage, before `codeman:ready`. One run picks them all, so no two runs work on the same task. Each task runs its own jobs, at once with the others', and one that fails leaves the others; the run ends when its slowest task does, and the next run starts then. Tasks on pods with the same settings share one pod, whatever run or repository they belong to ([shared pods](#shared-pods)). The choice was made in the [parallel tasks plan](plans/2026-10-06-parallel-tasks-and-inference-profiles.md) (decisions 1 and 2).

## Jobs

Each stage of a run is its own job, so the workflow graph shows where a run is and where it stopped.

```
codeman.yml:       select ──▶ task (one per task, at once) ──▶ next-run
codeman-task.yml:  open-key ──▶ agent ──▶ close-key ──▶ apply ──▶ release-pod
```

`codeman.yml` calls `codeman-task.yml`, a reusable workflow, once per task `select` picked, as a matrix (`fail-fast: false`). A task's jobs pass their outputs to each other as one workflow's jobs do; GitHub keeps only one value per output of a matrix, so nothing passes between tasks that way. `select` gives each task its inputs (its `tasks` output) and writes each task's context to the `codeman-task` artifact (`task/<number>.json`); each task's agent uploads its result as `codeman-result-<number>`.

Jobs that do not apply to a task are skipped: a task that only records answers goes straight to `apply`, and `release-pod` runs only after a run whose task kept its pod; see [self-hosted inference](#self-hosted-inference).

| Job | Does | Credentials |
| --- | --- | --- |
| `select` | Reads the settings and `.codemanignore` from the default branch, and the organization's settings from its `settings` input, picks the tasks and each one's action (`plan`, `route`, `implement` with its stage, `record`, `accept`; `none` when nothing can move) and [profile](#profiles), sets `codeman:planning`, `codeman:routing` or the stage's label, and writes each task's context as an artifact. | App token: issues write; contents, pull requests and actions read; OIDC token, for the [backend](#backend) |
| `open-key` | Checks the task's and the months' budgets against Codeman's ledger, where it reserves the run's limit, and gives the run access to its model: an OpenRouter key, or a token for a self-hosted model's gateway, on a pod of the [pod registry](#pods) that it joins or creates; it first terminates the organization's pods that nothing holds. | The key of each account whose provider the settings or a profile name: OpenRouter's management key, Runpod's API key; encryption secret; OIDC token |
| `agent` | Runs the harness on a copy of the checkout and uploads what it changed as an artifact, even when the agent fails or runs out of time. For a Serverless run, also runs the gateway, outside the sandbox. | `GITHUB_TOKEN` with contents and actions read (for workflow results; the agent never sees it), the run's key or token; for Serverless, the endpoint's key, which only Codeman's step holds |
| `close-key` | Ends the run's access (disables the key, or ends the run on its gateway), reads what it spent, and records it in the ledger with what the providers say now of the task's earlier runs, and for Serverless, splits the worker's time with the runs that shared it; reports the task's spend from the ledger. Keeps the pod for the next run on its settings (a keep lease) or leaves it, and terminates it when no other task uses or keeps it. Runs whatever happened before. | OpenRouter management key or GPU account key; OIDC token |
| `apply` | Validates the agent's result and writes it to its own task: commits, pull request, labels, run and status comments, spend. When the action is `record`, it applies the maintainers' answers instead; when it is `accept`, it moves the accepted workflows. Says whether the task goes on to another agent run (`continues`), and, when the task moved, uploads an artifact that says so (`codeman-chain-<number>`). | App token: contents, issues and pull requests write; for `accept` only, a second token with contents and workflows write |
| `release-pod` | Ends the task's keep lease on the pod `close-key` kept, when the task does not go on to another run now, or `apply` failed, and terminates the pod when no other task uses or keeps it. | GPU account key; OIDC token |
| `next-run` | Starts another run when this one moved a task: when the run has a `codeman-chain-` artifact, which only an `apply` that succeeded uploads. | `GITHUB_TOKEN` with `actions: write`, which also lists the run's artifacts |

Only `agent` runs an LLM. The jobs that write to GitHub never run one, and they treat everything the agent produced as untrusted.

`select`, `open-key`, `close-key` and `release-pod` also record what they did in Codeman's ledger, through the [backend](#backend), after their GitHub writes. `agent` never reaches the backend.

## Agent sandbox

The agent reads text that may be hostile (see [security](security.md#risks)) and runs shell commands. It runs as `codeman-agent`, a user without `sudo`, on a copy of the checkout in that user's home.

- It cannot read the runner's processes, so it cannot reach the job's tokens or the secrets of other steps.
- The runner's home, which holds the job's temporary files, is closed to other users before the agent starts. The agent is not in the `docker` group.
- Its environment is rebuilt from an allowlist: its own `HOME` and XDG directories, the job's `PATH` without entries in the runner's home, and the harness's variables. Nothing else from the runner passes, including what `sudo`'s PAM session adds from `/etc/environment`.
- Its tools and network are not restricted: it can use what the runner image has and what earlier steps of the job set up. The sandbox protects credentials, not the runner.
- Its credential (the run's OpenRouter key, or its token for a self-hosted gateway) reaches it only through its environment. It is the only credential the agent holds: a Serverless endpoint's key stays in Codeman's step, outside the sandbox.
- When the harness exits or reaches its time limit, every process of that user is killed.
- Codeman finds changes with `git status`, using the original checkout's `.git` against the agent's copy; the agent's `.git` is never used. Changed files are copied without following symlinks.

## Agent rules

Every agent run gets Codeman's working rules: the `##` sections of Codeman's own [`AGENTS.md`](../AGENTS.md) (language, documentation, plans, commits, third-party code, decisions), after a short section on applying them without a person to ask. The agent job writes them to `.codeman/rules.md` in the agent's copy, and the harness loads that file as instructions next to the repository's `AGENTS.md` (OpenCode: the `instructions` setting). The repository's files are not changed.

- The repository's `AGENTS.md` (or `CLAUDE.md`) wins for its own conventions, such as where documentation lives or which language it uses. The rules in the task file always hold: plan path and format, output file, protected paths, no secrets.
- A section the repository's file already contains is left out: when 60% or more of its three-word sequences appear there, ignoring case and punctuation. So a repository that copied Codeman's `AGENTS.md`, even with edits, does not get it twice. The job's log lists the sections left out.

## Budget

Codeman's [ledger](#the-ledger) records what each run spent, whatever served it, and the budgets are checked against it, so they hold across providers, across the tasks of a run and across repositories. The choices were made in the [ledger budgets plan](plans/2026-10-07-budgets-from-the-ledger.md). With self-hosted inference, spend is counted from GPU time ([spend](#spend)); with [profiles](#profiles), a task's runs may use several providers, and the ledger adds them up.

- **Task.** The task budget (default US$ 2) covers the whole task, from the first plan to the last fix: its runs in the ledger, each at its cost once closed and at its limit while open. A task's runs on one pod count at least the pod's cost as `close-key` last read it, which includes the pod's time between them. A task that started before the ledger carries what its record counted then (`carried`, on its first run in the ledger).
- **Month.** `monthly-budget` (default US$ 20) limits the repository's runs of the calendar month (UTC): their costs, and the limits of those still open.
- **Organization.** `organization-monthly-budget`, which only the organization's settings set ([settings](#settings)), limits the month of all the organization's repositories together, reconciled with each GPU account's billing: each hour Runpod billed counts the higher of its bill and the ledger's estimate of the runs in it, so a pod's time no run accounts for still counts; each hour not billed yet counts the estimate, so a run counts as soon as it ends. It also counts the time of each pod Codeman terminated that no task counted ([spend](#spend)). A run's amount spreads evenly over its time (a task's runs on one pod, over their span), and open runs count their whole limit. Without the setting, the organization's month has no limit.
- **Reservations.** Before it opens a run, `open-key` reads the task's runs and the month's in one store transaction. When what remains of the task's budget, in whole cents rounded down, is US$ 0.10 or more and fits in the repository's month and the organization's, it writes it as the run's limit, open; otherwise it refuses the run and reserves nothing. Tasks and repositories that open at once each see the others' reservations, or run their transaction again once those are written, so together they never pass a budget. `close-key` replaces the limit with the run's cost.
- **Expiry.** A reservation whose run never closes, as after a cancelled job, expires 2 hours after it was made, longer than the jobs' timeouts add up to, and the run goes on counting its whole limit. An expired OpenRouter run's key tells what it spent: the task's next `open-key` or `close-key` takes its cost from there. A run whose provider fails to open it costs nothing, and its reservation ends.
- **Refusals.** Below US$ 0.10, the task becomes `codeman:blocked`; a maintainer can raise the budget with `/codeman set task-budget <usd>` and then comment `/codeman continue`. A run that does not fit the repository's month or the organization's goes back to the task's previous state, until a later run finds room. `open-key`'s log shows the task's total, the repository's month and what its open runs reserve of it, and the organization's month.
- **Secrets.** `open-key` needs the key of the run's provider's account; with an organization's budget, also Runpod's account key when the settings or a profile name a Runpod provider, or when the organization's runs used Runpod this month, to read its billing ([providers](#providers)). When one is missing, it opens nothing, and the task becomes `codeman:blocked` with an error that names the secret.
- Each run gets its own OpenRouter key, expiring after 24 hours. Keys are named `codeman/<owner>/<repo>/<issue>/<run>` and are disabled, not deleted, so their usage still counts.
- After the agent, `close-key` disables the key and reads its final usage, waiting briefly while OpenRouter still counts the last requests. The key's usage may still read zero when the analytics already has the run's tokens; then it waits up to about a minute more. It also lists the task's keys, and in the ledger replaces the cost of each earlier run of the task with what its key says now (by run ID, the end of the key's name). Then it reports, from the ledger, the task's total and what each run spent, including a Serverless run's cost that a later close on its endpoint lowered ([Serverless](#serverless)). `apply` refreshes the cost of each row in the spend table from that, so a run that read its cost too soon gets it right on the next run, shows what the task spent at the end of the pull request's description, and keeps the task's total in the task record.
- The status comment has a spend table, with one row per run that used the agent: when, stage, model, provider, how long the agent ran, input and output tokens, context length, tokens per second, cost, the key's limit, the task budget, and the month: what the repository's runs counted this month in the ledger before the run, of the monthly budget. The provider is where the run's model was served: `OpenRouter`, `Runpod (pod)` or `Runpod (Serverless)` (the [providers](#providers) `openrouter`, `runpod-pod` and `runpod-serverless`); rows recorded before providers keep the name they had, and rows recorded before the record kept it show "—". Each run comment shows its own row.
- Under the table, a note for each provider in its rows says how a run's cost is measured, since only OpenRouter's is exact (see [Spend](#spend) for Runpod), and a last note how the month is; a run comment has its own row's notes. The month counts estimates and open runs' limits, so its column is named "Month (estimated)", while the `monthly-budget` setting it is spent against keeps its name. The record keeps the last 30 rows; older ones fold into one, with their sums, and their costs are no longer refreshed. A run with several rows (a re-run of the whole workflow) keeps them as they are. The task's total comes from the ledger, so when the rows add up to less (a run whose `apply` failed has no row, or a pod's time between runs), a row shows the difference.
- A last row totals every run of the task: agent time, tokens and cost are summed, so its cost is the task's total; the context length is the largest of the task, and tokens per second the mean over every request (each run's mean weighted by its requests). Limits and budgets are left empty. Under the table goes what the task spent of its budget.
- The agent job measures the agent's time outside the sandbox. `close-key` reads the key's tokens from OpenRouter's analytics (`POST /api/v1/analytics/query`, filtered by the key's hash), as OpenRouter counts them: input includes cached prompt tokens, and output is the completion tokens. Analytics and billing may count a request at different times, so it asks again for up to about a minute; a run whose tokens are not there by then shows "—".
- From the same analytics, `close-key` reads the run's requests, their mean throughput (`avg_throughput`: completion tokens per second) and its context length: the input tokens of its largest request (`tokens_prompt` by `generation_id`, largest first), cached tokens included. These come from OpenRouter, never from the harness, whose counts differ. Analytics keeps throughput and single requests for 31 days, longer than any key lives.
- Values passed between jobs appear in plain text in the logs of the job that reads them. `open-key` therefore passes the key encrypted with AES-256-GCM, using a key derived from `CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET`.

## Self-hosted inference

With `provider: runpod-pod` or `provider: runpod-serverless` ([providers](#providers)), a task's agents use a model that Codeman serves on GPUs rented from Runpod, instead of OpenRouter. The choice was made in the [self-hosted inference plan](plans/2026-10-02-self-hosted-inference.md), which records its decisions. Runpod charges per second of GPU, whether or not the agent is generating, so a run's cost is time, not tokens.

| Provider | GPU | Engine | Billed | Start |
| --- | --- | --- | --- | --- |
| `runpod-pod` | A pod Codeman creates, with the task's `gpu`, on Secure Cloud | Ollama, in Codeman's pod image | Every second the pod exists, from its creation | Minutes, unless the task's pod was kept |
| `runpod-serverless` | The workers of an endpoint a maintainer created ([installation](installation.md#self-hosted-inference-on-runpod)) | Runpod's vLLM worker | Every second a worker runs, its model's load and idle timeout included | Minutes, while vLLM prepares the model, unless a worker is still up; a run with no worker for 25 minutes fails |

### Choosing

What Codeman's tests on Runpod showed (step 8 of the plan):

- **OpenRouter** bills tokens only: nothing for starts or for the time the agent spends running tools. For a task at a time, it gives the most for the money and time, with the strongest models.
- **A pod** bills its whole life, used or not, but not per token: long contexts and many requests cost the same. It pays off when a smaller model does the work and runs follow each other, since a pod is kept between runs. The organization's tasks on the same pod settings share one pod, at once or one after another, and split its cost by the second ([shared pods](#shared-pods)): one task's tool runs leave the GPU to another's requests, and one repository's next run finds the pod another kept.
- **Serverless** bills each worker's start (minutes, compilation included), its requests and the idle timeout after its last one, at the flex price. It cost the most: US$ 1.96 for three runs of a task, against US$ 1.90 for a four-run task on a pod, though twice as fast on its GPUs. It pays off only when its worker stays busy, such as one endpoint serving several repositories at once (a worker takes several requests at once), so that starts and idle time are shared; never for a single task. Each run counts the worker time it used, and time it shared with other runs, of any of the organization's repositories, is split among them ([Serverless](#serverless)).

[Profiles](#profiles) combine them in one task, such as OpenRouter for planning and a pod for the stages whose runs follow each other.

### Layers

| Interface | Covers | Implementations |
| --- | --- | --- |
| `InferenceProvider` ([`src/inference/provider.ts`](../src/inference/provider.ts)) | What the key jobs use: opening a run with a limit (a handle, a credential, an API) and closing it (its usage, and what the task's other runs and pods cost, when the provider can tell). | OpenRouter; pods and Serverless ([`selfhosted.ts`](../src/inference/selfhosted.ts)) |
| `GpuProvider` ([`gpu.ts`](../src/inference/gpu.ts)) | Pods (price, create, get, list, terminate, URL, billing) and Serverless endpoints (settings, price, job queue URL), and the account's billing by the hour. | Runpod's REST API v2 ([`runpod.ts`](../src/inference/runpod.ts)) |
| `InferenceEngine` ([`engine.ts`](../src/inference/engine.ts)) | Model names and usage from responses. | Ollama, vLLM |
| Gateway ([`src/gateway/`](../src/gateway/)) | In front of the engine: the runs' tokens, forwarding, a record per request, each run's budget limit and share of a pod, and usage in OpenRouter's terms. | One program, in the pod or in the agent job |

### The gateway

- It serves several runs at once, one per task (on a pod, per seat: [shared pods](#shared-pods)): a pod serves the tasks that share it, and a Serverless agent job's gateway its one run. Each run's token, random, reaches its agent encrypted, like an OpenRouter key; the gateway keeps only its hash, and a token opens only its own run, with its own records and limit. A task's new run replaces its last one (a run that names no task, as Serverless runs and Codeman before shared pods start them, replaces every run), and ending a run revokes its token and leaves the others.
- Only `POST /v1/chat/completions`, `POST /v1/completions` and `GET /v1/models` reach the engine. Streamed requests ask the engine for usage in their last chunk.
- It records each request's input and output tokens (as the engine reports them; cached prompt tokens are input), when its response began, and when it ended. A run's usage is reported like OpenRouter's: tokens, requests, the largest request's input tokens (the context length), and mean completion tokens per second over streamed requests, from the first token to the end (a plain response arrives whole).
- It stops serving a run, with `402`, once the run's cost reaches its limit: for a pod, its share of the pod's time since it started, at the pod's price (each second split evenly among the runs on the pod; alone, the whole time, so its deadline is known in advance); for Serverless, the estimated time a worker was billed for the run.
- `GET /usage` and the `/admin/` routes, which start, end and release runs and report the gateway's state (with its API `version`: 2 serves several runs; an older gateway reports none), take an admin token: an HMAC of the GPU account key and a nonce in the pod's environment, which also holds the token's hash. Only the jobs with the account key manage pods, and no token is stored anywhere.
- A pod's gateway is public, through Runpod's proxy, which drops a request that gets no response within 100 seconds. The gateway answers a streamed request at once, and sends SSE comments while the engine is silent. Ollama listens only on the pod's loopback.

### Pods

Codeman keeps the organization's pods in a registry in the [backend](#backend): a document per pod, with the settings it serves and the leases of the tasks that use or keep it ([data layout](#data-layout)). The choices were made in the [pod registry plan](plans/2026-10-07-pod-registry.md), which records its decisions.

1. **Orphans.** `open-key` lists the account's pods, then reads the registry's live pods. It terminates the pods that carry the organization's environment (`CODEMAN_ORGANIZATION`, or `CODEMAN_REPOSITORY` of one of its repositories, as pods created before the registry do) and that no live document holds, and the registry's pods whose leases all expired, or that stopped or failed; a pod the provider no longer has leaves the registry. It never touches a pod without that environment, nor another organization's. A task that keeps a pod of other settings, as after a model change, drops that keep lease. Each termination is logged with its reason, and recorded as a `pod-terminated` event. A creator writes its pod's document before it creates the pod, and the sweep lists pods before it reads the documents, so a pod being created is always held.
2. **Claiming.** In one store transaction, `open-key` reads the live pods of its settings (a hash of model, GPU type, image and `pod-reuse`) and joins the oldest that serves them, with a run lease; or, while another task holds the settings' creation lease, waits, looking again every 10 seconds; or takes the creation lease, for 5 minutes, and creates the pod. Tasks that claim at once see each other's writes, or run their transaction again: one creates, the others wait for its pod. A creation lease that expires, as when its job died, goes to the next task, and a pod created after its creator's lease was taken is terminated; its creator joins the other.
3. **Creating.** Codeman's image, pinned by digest, on Secure Cloud, with the model, the admin token's hash, its limits, and the organization, the settings' hash and the document's nonce in the environment. The run's cost starts with the pod, since Runpod bills the image and model pulls. It waits up to 25 minutes for the gateway to report the model served, and ends and terminates a pod that does not.
4. In the pod, the gateway starts Ollama, pulls the model, restarts Ollama with the model's own context length, and loads it.
5. **Leases.** A task holds one lease on a pod: a run lease while its run is open, for 2 hours at most, as a reservation; then, with `pod-reuse: task` (the default), a keep lease from its `close-key`, for 15 minutes, which keeps the pod for the next run on its settings. `close-key` ends the run on the gateway and reads its usage: the run's cost is the pod's time since the run started, at its billed rate, or its share of a shared pod. `release-pod` ends the task's keep lease when `apply` says the task does not go on (it is not ready, routing or in a stage). The job that leaves no unexpired lease on the pod ends it in the registry and terminates it: `close-key` with `pod-reuse: run` or when the gateway does not answer, or `release-pod`. A pod whose gateway did not answer a close, or that a task could not join, takes no new task, and stays while other leases hold it.
6. A pod also terminates itself: it asks Runpod to, with the pod-scoped key Runpod gives it, and stops its container either way. It does so when its model is not served within 25 minutes of its creation (and at once when its container restarts after that), once every run on it has spent its budget or gone 30 minutes without a request (a spent or silent run among others is stopped alone, and stops costing them), and after 15 minutes without a run while kept.

### Shared pods

The organization's tasks whose pods' settings are the same share one pod, whether they run at once or one after another, in any of its repositories ([decision 2 of the pod registry plan](plans/2026-10-07-pod-registry.md)). Each keeps its own run, token, limit and share.

1. **Seats.** The registry gives each task a seat on the pod when it first joins it, for the pod's life, and the gateway names the task's runs by it: two repositories' tasks with the same issue number never mix.
2. **Starting.** Each task starts its own run on the pod, with its own token and limit. A task that waited for the pod's start shares it: its run's cost starts with the pod's creation; one that joins a pod already serving starts then.
3. **Splitting.** Each second of the pod is split evenly among the runs on it; a second with no run goes to the tasks that keep the pod then ([decision 3 of the parallel tasks plan](plans/2026-10-06-parallel-tasks-and-inference-profiles.md)). The gateway measures both, since it sees every run; `release-pod` releases the task on the gateway before it ends its keep lease.
4. **Keeping.** A kept pod serves the next run on its settings, whichever task kept it, of whichever repository.
5. **Older images.** The pod image pinned before shared pods serves one run at a time: Codeman lists it (`SINGLE_RUN_IMAGES` in [`ollama.ts`](../src/inference/ollama.ts)), and its pods' settings include the task, so each task has a pod of its own, which it keeps for its next run. Any other image (`pod-image`) must serve several runs: a pod whose gateway reports an older `version` fails the run, and the error says to list its image.

### Serverless

- `open-key` checks the endpoint before each run: no active workers, at most one worker, a queue, an idle timeout of 300 seconds or less, and a vLLM worker that serves the task's model and calls tools (`ENABLE_AUTO_TOOL_CHOICE` and `TOOL_CALL_PARSER`). Runpod's API does not say whether an endpoint runs on Secure Cloud; the installation steps do.
- The agent job runs the gateway on the loopback, with the endpoint's key, and gives the agent a local URL and the run's token. When the agent ends, the gateway stops, and its usage becomes the job's `gateway-usage` output, with the times its estimate counts (`busy`). GitHub keeps 1 MB of a job's outputs ([workflow syntax](web/github/workflow-syntax-for-github-actions.md#jobsjob_idoutputs)): a report above 200,000 characters, which would take thousands of separate times, leaves them out, and the run then takes no part in the split below.
- The gateway sends each request through the endpoint's job queue ([`src/gateway/queue.ts`](../src/gateway/queue.ts); [operation reference](web/runpod/operation-reference.md)): it queues a job (`/run`) and reads its output (`/stream`) until the job ends. A job waits as long as no worker serves it, while the gateway keeps a streamed request alive; Runpod's OpenAI-compatible route gave up after 5 minutes. A job nobody waits for anymore, because the agent gave up on its request or the run ended, is cancelled (`/cancel`), so it neither runs later nor piles up in the queue. A job lives an hour at most.
- Runpod bills endpoints by the hour at the finest, so a run's cost is estimated, at the flex price of the endpoint's dearest GPU type. Runpod bills a worker only while it is running: from its handler's start, the model's load included, through its requests and its idle timeout; not while it pulls its image or a cached model, nor while it waits for a GPU ([worker states](web/runpod/overview.md#worker-states)). So the gateway asks the endpoint's `/health` every 5 seconds ([operation reference](web/runpod/operation-reference.md#health)), and counts the time when a worker is running (`running` above 0) and the run has a request open or is within the idle timeout after one. Between two samples, the time counts unless both saw no worker running; a sample that fails, or that the gateway cannot read, is unknown and counts, as does the time after the last sample, which includes the idle timeout after the run's last request. The run's limit (`402`) uses the same estimate ([decision 1 of the plan](plans/2026-10-06-serverless-cost-from-worker-state.md)). An endpoint's workers may serve other repositories, and the other tasks of a run with `parallel-tasks`, each through its own agent job's gateway: their time counts for this run only while it has a request open or within the idle timeout after one. The run's limit counts time it shares with other runs whole, since its gateway cannot see theirs (decision 3 of the [Serverless split plan](plans/2026-10-07-serverless-cost-split.md)).
- **Splitting.** Runs that used an endpoint's worker at the same times split that time in the [ledger](#the-ledger), as runs on a [shared pod](#shared-pods) split its seconds ([Serverless split plan](plans/2026-10-07-serverless-cost-split.md)). `close-key` writes the run's billed times under the endpoint, and in one store transaction reads the endpoint's runs of the last hours, splits each millisecond evenly among the runs whose times hold it, each at its own price, and writes each overlapping run's share as its cost. A run that closes first counts its whole estimate until another run that overlapped it closes; each later close lowers the costs it overlaps, never below a run's share, so the runs' costs add up to the worker's estimated time. Only closed runs change: an open run counts its limit, and a run `open-key` opened again keeps what its earlier attempt spent. The budgets read the new costs at once (the task's total and both months); a task's spend table shows them at its next run, when `close-key` reports its runs' costs again. Each run's times are its own gateway's estimate, so a millisecond one gateway counted and another did not counts for the first alone.
- A run without a worker fails, as a pod run without a GPU does: when a request has waited 25 minutes while every sample saw no worker initializing or running, the gateway fails the waiting requests, stops serving the run, and the agent job stops the agent and fails, saying why. Unknown samples neither stop the run nor prove a worker. The wait costs nothing, except the idle timeout after the last request ([decision 2](plans/2026-10-06-serverless-cost-from-worker-state.md)).
- An agent job that fails before the agent reaches its model reports that nothing was used. Without a report, as after a cancelled job, the run counts its whole limit.

### Spend

- **Month.** A pod run counts its time at the pod's price, and a Serverless run its estimate, in the ledger as soon as they close, so they count in the repository's month at once. The organization's month reconciles them with Runpod's billing by the hour (`GET /v2/billing`), which also counts the time no run accounts for ([budget](#budget)). Runpod cannot list terminated pods, and pods serve the organization rather than one repository, so the whole account's billing counts in the organization's month: use an account dedicated to Codeman, for the organization's repositories.
- **Untracked time.** When a Codeman job terminates a pod, it records on the pod's document the pod's life at its price, what the ledger's runs on it count, and the difference: the time after its tasks' last closes, kept or not, and a pod that never served a run ([decision 4 of the pod registry plan](plans/2026-10-07-pod-registry.md)). That difference counts in the organization's month at once, spread over the pod's life and reconciled with the billing like the runs; no repository's month and no task counts it. A pod that terminated itself has no known end, and its time counts once Runpod bills it.
- **Task.** Providers bill pods, not tasks, so the task's record lists its pods (the last 20), whose billing `close-key` reads at each of the task's runs. A pod's cost is its billing or, for the run's own pod, its whole life so far at its rate, when higher: that includes a kept pod's time between runs, which Runpod bills late. `close-key` records it in the ledger (`podCost`, on the task's last run on the pod), and the task counts for each pod the higher of that and its runs' costs on it. The spend table shows the difference in its row for what the task spent outside its runs. A run whose pod served it alone gets the pod's cost as its own. Serverless runs count their share of the worker's estimated time ([Serverless](#serverless)). The minutes between a task's last run and its pod's termination count as the pod's untracked time, in the organization's month.
- **A shared pod.** A run's cost is its share of the pod. Runpod bills the pod as a whole, so a task counts for a shared pod what the gateway measured for it, as of each of its closes: its runs' shares and the kept time it was given. The record marks such a pod (`shared`), whose billing `close-key` then no longer reads, since the gateway, which knew who used each second, is gone with the pod. The tasks' counts therefore add up to no more than the pod's bill: they leave out the time after a task's last close that it kept the pod, unless it runs on the pod again, and the time after the last task left it, which count as the pod's untracked time.
- **The spend table.** Its rows name `Runpod (pod)` or `Runpod (Serverless)`, and the notes under it say how their figures are measured: a pod run's cost is its pod's time at its price, and the task also counts its pod's time between runs, refreshed from billing; a Serverless run's is an estimate, which counts in the month as soon as the run ends, and shrinks when other runs that used the worker at the same times close. The month is the repository's, from the ledger.
- `select` passes the task's pods and its record's total, which the ledger carries for a task that started before it, to the key jobs (`inference` output), with the rest of its choice: the run's provider and its settings, its profile, and the account of every provider the settings name.
- A task whose runs use several providers, through [profiles](#profiles) or a change of `provider`, adds them up in the ledger.

## Backend

Codeman keeps its operation in Cloud Firestore, in a Firebase project of its own: what its jobs need to share across runs and repositories, and atomically, which GitHub cannot give them. Tasks' state stays on GitHub (labels, comments, the task record), where maintainers read and change it. The choices were made in the [backend plan](plans/2026-10-07-firestore-backend.md), which records its decisions; the [ledger budgets](plans/2026-10-07-budgets-from-the-ledger.md), [pod registry](plans/2026-10-07-pod-registry.md) and [Serverless split](plans/2026-10-07-serverless-cost-split.md) plans build on it.

- **Required.** Every repository needs the backend's three variables ([installation](installation.md#4-set-up-the-backend)). A step without them fails, naming them; `select` fails first, before it marks any task, and so does a backend it cannot read.
- **Access.** A job asks GitHub for its OIDC token (`id-token: write`), exchanges it at Google's Security Token Service for a federated token, and with it gets an access token of the backend's service account from IAM Credentials, for Firestore only (scope `datastore`), for an hour ([`src/store/google.ts`](../src/store/google.ts)). The Workload Identity provider's attribute condition admits only tokens of the organization's repositories, from Codeman's workflow on their default branch. No key is stored anywhere, and the tokens are masked. Only `select`, `open-key`, `close-key` and `release-pod` ask for an OIDC token; `agent` never does, so neither the agent nor a Serverless gateway can reach Firestore.
- **Client.** Firestore's REST API v1, called with `fetch` ([`src/store/firestore.ts`](../src/store/firestore.ts)); no Google package. The project's `(default)` database, in Native mode, Standard edition.
- **Rules.** [`firebase/firestore.rules`](../firebase/firestore.rules) denies every client: only the service account, which IAM authorizes and the rules do not apply to, reaches the data.
- **Cost.** Firestore's free quota is 50,000 document reads and 20,000 writes a day; a run writes about six documents, plus one per pod it creates, joins or terminates, and a pod run two or three more in the registry ([usage and limits](web/firebase/usage-and-limits.md)). Each `open-key` reads the task's runs and the month's (the organization's, with its budget): a month of 500 runs, 40 of them a day, reads about 20,000 documents a day, and more when transactions run again. A pod run also reads the organization's live pods, a few; a Serverless run's `close-key` reads the endpoint's runs of the last hours and their run documents, and writes its own and the costs it lowers, a few more.

### The store

[`src/store/store.ts`](../src/store/store.ts) is the interface the steps use: reads (`get`, and `query` with equality and range filters, order and limit), writes applied all at once with preconditions (a document exists, is missing, or is at a version), and transactions. A transaction's reads see one state, and its writes apply only if nothing it read, queries included, changed before it committed; otherwise it runs again, up to five times. Firestore's Standard edition locks what a transaction reads until it ends, so two transactions that read the same documents wait for each other, and one runs again ([serializability](web/firebase/transaction-serializability-and-isolation.md)).

Tests use the store in memory ([`src/store/memory.ts`](../src/store/memory.ts)), which passes the same contract tests as Firestore's emulator ([`src/store/contract.ts`](../src/store/contract.ts); [development](development.md)).

### Data layout

Everything belongs to an organization, the repositories' owner (a user account is its own organization), so one project can serve several. Owners and repositories are lowercase, as GitHub compares them ([`src/store/layout.ts`](../src/store/layout.ts)).

| Path | One document per | Fields |
| --- | --- | --- |
| `organizations/{owner}/runs/{run}` | Run of a task's agent | `repository` (`owner/name`), `task`, `workflowRun`, `attempt`, `month` (`2026-10`), `status` (`picked`, `open`, `refused`, `failed`, `closed`, `expired`), `pickedAt`, `stage`, `model`, `provider` (`openrouter`, `runpod-pod` or `runpod-serverless`; runs picked before providers have the account, `openrouter` or `runpod`, and a `mode`: `openrouter`, `pod` or `serverless`), `profile`; then `reservedAt`, `expiresAt`, `limit`, `carried` (on the task's first run in the ledger) and `openedAt`, or `refusedAt`, `refusal` and `reason`, or `failedAt`, `reason` and a `cost` of 0; then `closedAt`, `cost`, `inputTokens`, `outputTokens`, `requests`, `maxInputTokens`, `tokensPerSecond`, `pod` and `podCost`, `endpoint` (Serverless), when known; `spentBefore` when `open-key` ran again after the run closed |
| `organizations/{owner}/events/{run}-{type}[-{subject}]` | Thing a job did | `type`, `repository`, `task`, `run`, `workflowRun`, `attempt` (the job's), `job`, `at`, and the type's own fields |
| `organizations/{owner}/pods/{nonce}` | Pod Codeman created, named by the nonce of its admin token | `settings` (a hash), `model`, `gpuType`, `image`, `reuse`, `provider` (`runpod`, the cloud that runs and bills the pod), `status` (`creating`, `serving`, `abandoned`, `ended`), `live`, `claimedAt`, `claimedBy`, `creatingUntil`, `leases` (`holder`: `owner/name#task`, `run`, `kind`: `run` or `keep`, `until`), `seats` (holders, by seat); then `pod`, `createdAt`, `pricePerSecond`; `endedAt` and `reason`; when a job terminated it, `terminatedAt`, `month`, `lifeCost`, `counted` and `untracked` |
| `organizations/{owner}/endpoints/{endpoint}/runs/{run}-{reservation}` | Serverless run's time on the endpoint's worker, by the run and its reservation's time in milliseconds | `run`, `repository`, `task`, `reservedAt`, `from` and `to` (its billed times' bounds), `pricePerSecond`, `busy` (its billed times, as JSON text of `[from, to]` pairs in milliseconds), `estimate` (its gateway's), `share` (the last split's), `splitAt` |

- A run's ID is `{workflow run}-{attempt}-{task}`: the workflow run, the attempt in which `select` picked the task, and the task. Workflow runs' IDs grow with time, so runs sort in the order they started. `select` gives it to the task's jobs (its `ledger-run` output). A re-run of failed jobs keeps the attempt that picked the task, and so writes the same run; a re-run of the whole workflow picks again, as a new run.
- Event types: `task-picked` (`action`, `stage`; for every task `select` picks, also those without an agent), `key-opened` (`limit`), `key-refused` (`status`, `reason`), `key-failed` (`reason`), `pod-created`, `pod-joined` and `pod-terminated` (`pod`, also the subject; `reason` for a termination), `run-stopped` (`result`: the agent job's, when it did not succeed) and `run-closed` (`cost`).
- The queries the budgets need, an organization's or a repository's runs of a month, a task's runs, a pod's runs, and the pods that ended in a month, filter on equality only, which Firestore's automatic single-field indexes serve; so do the registry's, the live pods of some settings or of the organization. The split's, an endpoint's runs whose times end after a moment, is a range on one field, which they serve too.
- A pod's document is written before the pod exists, by the task that takes the creation lease, and stays after it ends, as its record.

### The ledger

[`src/ledger.ts`](../src/ledger.ts) writes the runs and their events, and the budgets read it ([budget](#budget)). Each job adds its own fields to the run's document and its events: `select` when it picks the task, `open-key` when it reserves, opens, refuses or fails the run, `close-key` with what the run used, and `release-pod` when it ends a keep lease. A job that terminates a pod also records the pod's untracked time on its document, after its own writes; `close-key` then splits a Serverless run's time with the endpoint's other runs, in a transaction that may lower their costs ([Serverless](#serverless)). A job writes them at its end, after its GitHub writes, in one commit; `close-key` and `release-pod` first end the run's access and terminate pods, whatever the ledger does. Two writes do not wait for the end: `open-key`'s reservation, a transaction before it opens the run, and the costs that `open-key` and `close-key` refresh in the task's earlier runs.

- Writes are idempotent: fields are merged into the run's document, and an event replaces the one of the same ID. A re-run job writes the same documents again.
- A write that fails is tried again three times, over 13 seconds; then the job fails. A failed `select` runs no task's jobs; a failed `open-key` runs no agent, and its run is closed as any other.

## Planning

1. `select` picks a `new` task, one left in `planning` by an interrupted run, or one with a `/codeman replan` request, and chooses the branch `codeman/<issue>-<slug>` and the plan path `docs/plans/<date>-<slug>.md`.
2. `agent` gives the harness a task file with the rules, the issue and the maintainer comments. The agent writes the plan and `.codeman/output.json`, which lists the decisions: a title, a question, options and a recommendation each. See [agent output](#agent-output) for its limits.
3. `apply` accepts only the plan file; other changes are ignored and listed in the run comment. It validates `output.json` strictly, commits the plan to the task branch through the Git Data API, and sets `codeman:awaiting-decision`, or `codeman:ready` when there are no decisions.

A revised plan (`/codeman replan`) keeps the decisions settled so far, with their numbers and answers, and the agent numbers its new decisions after every earlier one, so one number never means two decisions. The plan's `## Answers` section lists the settled answers from the start. The task record keeps its history: the spend table, the pull request, the handled accepts, the stages' reports and the suggested squash message. What starts over is the stages' progress, from design, and the decisions comment: the revised decisions get a new one, after the run comments before it, unless the revised plan has none.

If the agent fails, runs out of time or produces an invalid result, the task becomes `codeman:blocked`.

## Stages

After planning, a task goes through up to five stages, one run and one agent each, in this order: web, design, code, test and review. A routing agent chooses which of the first four run; review always runs last, and has the last word on whether the task is done. Every task therefore goes through planning, routing and review, at least.

| Stage | Does |
| --- | --- |
| Web | The documentation of the third-party services the task relies on, in `docs/web/`, following the rules for [third-party documentation](#third-party-documentation). It changes nothing else but the plan. |
| Design | Flowcharts in Mermaid (`docs/flows/*.md`), screen drafts in plain HTML (`docs/design/*.html`) and their images (`docs/screenshots/*.png`, rendered with the runner's headless Chrome), linked from the plan. It may ask the maintainers decisions, such as a choice between two layouts. |
| Code | The implementation, with unit tests for the code it writes, and the documentation it changes. |
| Test | Integration and end-to-end tests where they apply, more unit tests where coverage is thin, and every check the repository has. What can only be tested outside the task branch (a deploy, a release) goes in a "Manual tests" section of its report, which the pull request's description shows; it is no reason to block. |
| Review | A critical review against the plan and the decisions, and a merge of the default branch in its sandbox to find conflicts and integration problems early. It changes nothing; its report goes on the pull request. It is not an approval to merge. |

### Routing

The routing agent runs, in a run of its own, whenever the task needs to know what comes next: after the decisions are answered (or the plan has none), after a `fix` request, and after review asks for changes. It reads the plan, the decisions, the requests, the earlier run comments and the task branch's changes, and chooses:

- the stages that run, in the order above, each with a brief for its agent, always ending with review;
- the stages it leaves out, each with a reason. None of the stages before review is required: each task has its own needs.

Its run comment shows the route, the briefs and the reasons. Its file changes are discarded.

- When no other stage should run (the request is already done, or it needs a revised plan), the route is review alone, and the router's brief says why: review decides. On a task branch that changes nothing but the plan, review reports `blocked` when the task needed no change, so a maintainer closes the issue; no pull request opens.
- A route without review is an invalid result. Records from before review always ran may hold a route without it, which still ends with review, or an empty one, from when the router could block the task: `/codeman continue <guidance>` routes it again.
- When its result cannot be used (it failed, ran out of time, or wrote an invalid output), the stages run in their fixed order, from where the task was: design after planning, code after a request or a review. The run comment says so.
- The stages of a route read the requests the router handled, as well as newer ones.
- `/codeman continue`, accepting workflows and an unfinished stage go on with the stage they belong to; they do not route. Tasks from before routing go on in the fixed order.

### Running a stage

1. `select` picks the task and its stage, from the task record, and sets the stage's label. The agent starts from the head of the task branch, with the default branch's history, and gets the notes the previous stage left and the router's brief.
2. Each stage's agent first decides whether its stage has work; when it does not, it reports `skipped` with the reason. It writes `.codeman/output.json`: a status, a summary and, when it changed files, a commit message. Each stage may report only some statuses: `done`, `skipped`, `partial` (more work for another run of the same stage), `blocked`, `awaiting-workflow` (code and test), `decisions` (design and review) and `changes` (review).
3. `apply` filters the changes through the [change policy](#change-policy) and commits the rest to the task branch through the Git Data API, even when the agent failed or ran out of time, so no work is lost. Review's changes are discarded.
4. Then, by status:
   - `done` or `skipped`: the route's next stage runs next, with this stage's summary (or reason) as its notes. When code ends, Codeman opens the pull request as a draft, titled like the issue (`Closes #<issue>`, the plan's summary, and the code stage's commit message as the suggested squash message), so the repository's CI runs during test and review. Repositories without draft pull requests get a regular one.
   - `done` from review: Codeman adds its proposed `.codemanignore` if the repository has none, opens the pull request if there is none yet or updates its description, marks it ready for review, posts review's report on it, and sets `codeman:done`. While the agent's workflows are still staged, the task waits for them to be accepted instead, and the pull request stays a draft; see [on-demand workflows](#on-demand-workflows).
   - `changes` from review: the report goes on the pull request, and the routing agent chooses what addresses it. After `max-runs` rounds in a row, the task becomes `codeman:blocked`.
   - `decisions`: the task becomes `codeman:awaiting-decision`, with the new decisions after the plan's. When they are answered, the routing agent runs, with review's report if review asked them.
   - `partial`, or out of time: the stage runs again, up to `max-runs` runs in a row. Then the task becomes `codeman:blocked`, and a maintainer can grant another round with `/codeman continue <guidance>`.
   - `blocked`, or an invalid result: `codeman:blocked`, with the reason. `/codeman continue <guidance>` tries the stage again, and so does accepting the task's staged workflows. When the agent reported `blocked`, the run comment also suggests `/codeman replan`: a request the plan does not cover, such as a `fix` that widens the task's scope, needs a revised plan.

### Feedback

After the pull request is open, maintainers ask for changes in either of these ways:

- a review that requests changes; its text is the request;
- `/codeman fix <what to change>` in a comment on the pull request or the issue, or in a review's text.

The routing agent chooses the stages that carry out the request, and each of them gets the requests and every maintainer review since the last run that handled reviews, with the line comments and their file and line. They push to the same branch, and when the route ends, Codeman updates the pull request's description. `/codeman replan` also works on the pull request.

Codeman records the last comment and review it handled. A request is handled once a run for it ends, whatever the outcome, so a failing request does not start run after run; when the monthly budget stopped the run from starting, the request waits for a later run.

## Third-party documentation

Repositories keep the documentation of the third-party services they rely on in `docs/web/`: one page per file in `docs/web/<third-party>/<slug>.md`, and in `docs/web/tools/` how each kind of page is fetched. The format, and when a page may be a full copy, are rules in [`AGENTS.md`](../AGENTS.md) ("Third-party documentation"), which every agent receives. Codeman's own catalog is in [`docs/web/`](web/).

- Only the web stage writes there; the other stages' changes under `docs/web/` are dropped, and every agent is told to read it as data. The web stage changes nothing else but the plan.
- Before committing, `apply` checks each page and tool: its path, a file name that is the slug of its title, the front matter's fields, ISO 8601 dates, a `tool` that exists on the branch or in the same run, and a non-empty `license` when there is one. A file that fails is dropped, with why, in the run comment.
- The web stage gets Codeman's generic tool in `.codeman/fetch-markdown.md`, and copies it into `docs/web/tools/` when the repository has none.
- Pages are not refreshed on their own. After each run, Codeman reads the front matter of the pages on the task branch (only those whose blob changed; the record keeps the rest), and the status comment lists the pages fetched more than 30 days ago, or whose `updated_at` cannot be read, with how to ask for a refresh: a request such as `/codeman fix Refresh docs/web/<third-party>/`, which the routing agent sends to the web stage.

## Agent output

The agent reports in `.codeman/output.json`: a summary and decisions when planning, and a status, a summary, a reason, a commit message and decisions in a stage. What it writes there ends up in comments on GitHub, which hold at most 65,536 characters, so each text has a limit; see [settings](#settings).

- The prompt states the limits. Codeman accepts each text up to twice its limit, without telling the agent: LLMs count characters poorly, and a text a little too long is not worth losing a run. The commit message's limit is 1,000 characters.
- Counts have no margin: at most `max-decisions` decisions, with 2 to `max-options` options each.
- All decisions of one output together (titles, questions and labels) may have at most 50,000 characters; the agent is told 25,000.
- When the harness exits, the agent job checks the output as `apply` will. If it is missing or invalid, or a text would be cut, and at least two minutes are left, it continues the agent's session once with the problems, stated with the limits the agent was told. A fix that fails or runs out of time leaves the first outcome.
- `apply` validates the output again. A text still longer than twice its limit is cut, and the run comment lists it under Problems. Any other problem blocks the task.

## Change policy

Apply commits only regular files that pass these rules; it drops the others and lists them in the run comment.

- `.codemanignore` at the repository's root lists the paths the agent may not change, in `.gitignore` syntax. `!` re-allows a path. A file inside an excluded directory cannot be re-allowed: to re-allow a whole subdirectory, add both `!/dir/sub/` and `!/dir/sub/**`.
- Without that file, Codeman uses its own rules: `/.github/**`, the harness's configuration (`opencode.json`, `opencode.jsonc`, `/.opencode/**`) and agent instructions (`AGENTS.md`, `CLAUDE.md`, `/.claude/**`, `/.agents/**`). Its first pull request proposes them as the repository's `.codemanignore`. Agent instructions are protected because later runs would follow a changed version before anyone reviewed it.
- When the repository's file stops protecting one of those paths, `select` warns in the run's summary.
- Whatever the file says, the agent never changes `.codemanignore` or `.codeman/`, since it must not change its own rules.
- Workflow files are never committed where they would run; see [on-demand workflows](#on-demand-workflows). The proposed rules protect all of `.github/`. To let the agent write workflows while keeping the rest of `.github/` protected, use `/.github/**`, `!/.github/workflows/` and `!/.github/workflows/**`.
- The plan file is always accepted.
- Only the web stage changes `docs/web/`, and it changes nothing else; see [third-party documentation](#third-party-documentation).
- Each file may have at most `max-file-bytes`. A run that changes more than `max-files` files commits nothing and blocks the task.

Codeman reads the rules from the default branch, never from the task branch, so one run cannot loosen them for the next. Matching uses `git check-ignore` in an empty repository, so git's own rules apply.

## On-demand workflows

A workflow file runs as soon as it reaches a branch, if it listens to `push`, and on pull requests from the same repository, and it gets the repository's secrets. So Codeman never lets a workflow the agent wrote run before a maintainer reads it.

- When the agent writes or changes a file directly under `.github/workflows/`, and `.codemanignore` allows it, apply commits it to `.codeman/workflows/` on the task branch instead, where it does not run. The status comment lists these files. Deleting a workflow is left to a maintainer.
- After reading them in the pull request or on the branch, a maintainer comments `/codeman accept-workflows`. The next run moves them into `.github/workflows/` with a token that may write workflows, which apply requests only for this. If a staged file changed after the comment, nothing moves, and the maintainer must read them again and comment again. Codeman records the accepted comment, and the commit names who accepted.
- A workflow can be what the task delivers (a deploy workflow, for example), or something the agent needs: another operating system, a device, a secret. In that case the agent writes a workflow that runs on pushes to the task branch and reports `awaiting-workflow`, with the workflows it waits for. The task becomes `codeman:awaiting-workflow`. The agent never waits for a workflow that deploys, publishes or releases: from the task branch, it would ship work nobody reviewed.
- A stage that waits for workflows that are still staged does not stop the task: they cannot run before a maintainer accepts them. The stage records the wait, and the task goes on to the next stages and review. Review also checks the staged workflows as workflows: triggers, `permissions`, secrets only through a GitHub Environment, actions pinned to a full commit SHA, and `paths` filters and no deploy for a workflow that runs on the task branch. If it asks for changes, the code stage makes them. If it passes while workflows are still staged, the task becomes `codeman:awaiting-workflow` until they are accepted, and the pull request stays a draft, since merged from `.codeman/workflows/` they would never run.
- After that accept, a stage that waited for their runs waits for them, then goes on with their results, and the stages after it run again. If no stage waited, the task is done and the pull request becomes ready for review. The accept moves only files that did not change since review read them.
- A workflow the agent waits for includes its own file in its `paths` filters, so the push that accepts it runs it. Codeman looks for the runs on the branch's head, so a later commit that the filters skip leaves the task waiting; `/codeman continue <guidance>` goes on without them.
- Accepting workflows of a blocked task resumes the stage that blocked, with a new run count. The stage's agent is told which workflows were accepted, and by whom.
- Once accepted, the workflow runs on the push that moved it. When every awaited workflow has a finished run on the branch's head, the next run resumes the task. The agent job downloads each run's job conclusions, the last 64 KiB of the log of each job that did not succeed, and the artifacts, up to 50 MiB in total; the agent finds them in `.codeman/results/`. They came from code on the branch, so the agent treats them as data. `/codeman continue <guidance>` resumes the task without waiting.
- A workflow that needs secrets should take them from a GitHub Environment with required reviewers, so a human also approves each run.

## Settings

Each value comes from the first of these that sets it:

1. A `/codeman set` command on the task, in a comment or in the issue's description (only `model`, `task-budget`, `max-runs`, `language` and `gpu`).
2. The workflow's inputs, in a manual run.
3. `.codeman/settings.yml` on the default branch.
4. The organization's settings: the `settings` input of the `select` step, which the template fills from the `CODEMAN_SETTINGS` variable, in the file's format. They are defaults that several repositories share; a repository's file overrides them, value by value. Empty, or not passed by an older workflow file, means none. Only they set `organization-monthly-budget`: a repository's file or profile that sets it stops the run with an error, and neither commands nor a manual run's inputs take it. See [installation](installation.md#shared-settings).
5. Codeman's default.

When `select` picks a task, its log has a line per layer, naming the values that come from it; the values no line names are Codeman's defaults.

| Name | Default | Meaning |
| --- | --- | --- |
| `model` | none; required | Model ID, in the form the provider takes ([providers](#providers)) |
| `task-budget` | `2` | Spending limit of each task, across all its runs, in USD |
| `monthly-budget` | `20` | Spending limit per calendar month for the repository, in USD |
| `organization-monthly-budget` | none | Spending limit per calendar month for all the organization's repositories together, in USD, with the GPU accounts' billing; only the organization's settings set it. See [budget](#budget) |
| `max-runs` | `3` | Implementation runs in a row without finishing before a task is blocked |
| `max-files` | `300` | Files one run may change |
| `max-file-bytes` | `1048576` | Size limit of each changed file |
| `max-decisions` | `10` | Decisions in one output of the agent, at most 10 |
| `max-options` | `4` | Options of each decision, from 2 to 6 |
| `max-title-chars` | `80` | Characters of a decision's title, at most 200 |
| `max-question-chars` | `600` | Characters of a decision's question, at most 1,500 |
| `max-label-chars` | `150` | Characters of an option's label, at most 300 |
| `max-summary-chars` | `2000` | Characters of the agent's summary and reason, at most 4,000 |
| `language` | `auto` | The language Codeman talks to maintainers in, as a BCP 47 tag such as `pt-BR`; `auto` uses the conversation's. See [conversation language](#conversation-language) |
| `provider` | `openrouter` | Where agent runs get their model: `openrouter`, `runpod-pod` or `runpod-serverless`. Each provider accepts only its own settings; see [providers](#providers) |
| `profiles` | none | A provider, a model and that provider's settings for some runs; see [profiles](#profiles) |
| `parallel-tasks` | `1` | Tasks one run works on at once, from 1 to 10, each in its own jobs; see [runs](#runs). Tasks on pods with the same settings share one, whatever this says ([shared pods](#shared-pods)) |

The settings that only some providers accept (`engine`, `gpu`, `endpoint`, `pod-reuse`) are in [providers](#providers). Some settings had other names before the [provider settings plan](plans/2026-10-08-provider-settings.md): `inference`, `gpu-provider` and `gpu-mode` are now `provider`; `gpu-type` is `gpu`; `serverless-endpoint` is `endpoint`; `inference-profiles` is `profiles`. An old name stops the run with an error that gives the new one, in the file, the organization's settings and a profile; `/codeman set gpu-type` is reported as a problem that does too.

The `max-*-chars` and count limits are what the agent is told; see [agent output](#agent-output) for the margin.

The settings file is a strict subset of YAML, read without a dependency ([`src/yaml.ts`](../src/yaml.ts)): `name: value` lines, block mappings and lists (indented with spaces) for the profiles, lists of values in brackets (`[code, test]`), plain or quoted values, comments and blank lines; see [`templates/settings.yml`](../templates/settings.yml). Anything else, such as `{...}`, anchors, tags or multi-line values, stops the run with an error that names its line, so the file never means something other than what it looks like. The organization's settings follow the same rules, and their errors name the `settings` input instead of the file.

### Providers

`provider` chooses where a run's model is served. Each provider accepts its own settings beside `model`, and a setting it does not accept, a value it does not offer, or a required setting it lacks stops the run with an error that names the provider. The registry in [`src/inference/providers.ts`](../src/inference/providers.ts) holds them; a new provider is a new entry. The choices were made in the [provider settings plan](plans/2026-10-08-provider-settings.md).

A provider's settings go with it: a layer of settings ([above](#settings)) or a [profile](#profiles) that names another provider than the one below it leaves out that one's settings, so a repository with `provider: openrouter` drops the organization's `gpu`, and a profile on Serverless over a top level on pods takes no `gpu`. `model` carries over, and must fit the new provider.

Each provider bills an account, whose key opens its runs and whose billing the [budgets](#budget) read: `openrouter`, or `runpod` for both Runpod providers.

#### `openrouter`

The default. It accepts no setting beside `model`.

- **Model ID:** OpenRouter's, such as `deepseek/deepseek-v4.1-flash`.
- **Secrets:** `CODEMAN_OPENROUTER_MANAGEMENT_KEY`, in the key jobs.
- **Cost:** what the run's key used, exact, from OpenRouter.

#### `runpod-pod`

A pod Codeman creates on Runpod's Secure Cloud, shared by the organization's tasks with the same pod settings ([pods](#pods)).

| Setting | Default | Meaning |
| --- | --- | --- |
| `gpu` | none; required | The pod's GPU type, by Runpod's GPU ID (not its display name), such as `"NVIDIA RTX A6000"` (quoted or not in the file; `/codeman set gpu` takes the rest of its line) |
| `pod-reuse` | `task` | `task`: a pod is kept after a run for the next run on its settings, of any task; `run`: a pod ends with its runs |
| `engine` | `ollama` | What serves the model; `ollama` is the only engine on pods so far |

- **Model ID:** Ollama's, such as `qwen3-coder:30b`.
- **Secrets:** `CODEMAN_RUNPOD_API_KEY`, in the key jobs.
- **Cost:** the pod's time at its price, split among the runs on it ([spend](#spend)).

#### `runpod-serverless`

The workers of a Serverless endpoint a maintainer created, running Runpod's vLLM worker ([Serverless](#serverless)). An endpoint's GPU types are set on the endpoint, so it takes no `gpu`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `endpoint` | none; required | The endpoint's ID, or a URL of it from Runpod's console (`https://api.runpod.ai/v2/<id>/...`), whose path gives the ID. A URL on any other host, or not on HTTPS, is an error, since the endpoint's key goes there |
| `engine` | `vllm` | What serves the model; `vllm` is the only engine on Serverless |

- **Model ID:** what the worker serves, its Hugging Face ID, such as `Qwen/Qwen3-Coder-30B-A3B-Instruct`.
- **Secrets:** `CODEMAN_RUNPOD_API_KEY`, in the key jobs; `CODEMAN_RUNPOD_SERVERLESS_KEY`, the endpoint's key, in the agent job.
- **Cost:** an estimate of the time Runpod bills the endpoint's worker for the run, split with the runs that used it at the same times ([Serverless](#serverless)).

### Profiles

`profiles` is a list of profiles, each with a `name`, optional conditions under `when`, and the settings it changes: only `provider`, `model` and the provider's settings. Budgets and limits stay at the top level. The choice was made in the [inference profiles plan](plans/2026-10-06-parallel-tasks-and-inference-profiles.md) (decisions 4 to 6), and the names in the [provider settings plan](plans/2026-10-08-provider-settings.md).

```yaml
model: deepseek/deepseek-v4.1-flash      # when no profile applies
profiles:
  - name: small-pod
    when:
      stages: [code, test]
    provider: runpod-pod
    gpu: NVIDIA RTX A6000
    model: qwen3-coder:30b
```

- **Conditions.** `stages` lists what the agent works on: `plan`, `route`, or a stage (`web`, `design`, `code`, `test`, `review`). `parallel-tasks: N` holds when at least N of the run's tasks run an agent (recording answers and accepting workflows do not), whatever the `parallel-tasks` setting allows. A profile without conditions always applies.
- **Which applies.** `select` takes the first profile, in the list's order, whose conditions all hold for the run, and its values replace the top-level ones; with none, the top-level settings apply. A profile that names another provider than the top level's leaves out the top level's provider settings ([providers](#providers)). Runs without an agent (recording answers, accepting workflows) use the top-level settings. The run's log names the profile, and the spend table's model and provider columns show what each run used.
- **Layers.** The list is one value: the first layer that has one gives it whole, so a repository's file with `profiles` replaces the organization's list, and `profiles: []` removes it. A profile's values replace those of every layer below the task's commands, a manual run's inputs included: a manual run's `model` applies only to runs whose profile sets none. A task's `/codeman set model` wins over any profile; where it does not fit the run's provider, it is reported as a problem, and the run goes on without it. A task's `/codeman set gpu` applies to the runs whose provider accepts it, and is reported as a problem when none of the settings' providers does.
- **Checks.** The top-level settings, and each profile over them, must fit their providers on their own, whichever stage runs: a mistake stops the first run, with an error that names the profile.
- **Budgets.** The task and the months count every run in the ledger, whatever served it; with an organization's budget, `open-key` reads the billing of the Runpod account when a profile names a Runpod provider. See [budget](#budget).

## Commands

Maintainers steer a task with comments on its issue or on its pull request, and with review texts. Each line that starts with `/codeman`, outside a fenced code block, is a command; one comment may hold several. Answers (`decide`, `approve`, `answer`) count while the task is `codeman:awaiting-decision` or `codeman:ready`; `fix` and `continue` once it is ready or later; `replan` and `set` in any state.

| Command | Effect |
| --- | --- |
| `/codeman decide 1 a` | Answers decision 1 with option `a`. Several at once: `/codeman decide 1 a 2 b`. `1=a` also works. |
| `/codeman approve` | Accepts the recommendation for every unanswered decision. |
| `/codeman answer 2 <text>` | Answers decision 2 in the maintainer's own words instead of an option. The text continues on the following lines, up to the next command. |
| `/codeman replan <text>` | Sends the task back to planning. The agent revises the plan with the text (which may continue on the following lines), the maintainer comments and the answers given so far; answered decisions are written into the plan as settled, and only open or new decisions are listed. |
| `/codeman fix <text>` | Asks for changes to the implementation. Also a review that requests changes. See [feedback](#feedback). |
| `/codeman accept-workflows` | Moves the workflows the agent staged under `.codeman/workflows/` into `.github/workflows/`, after a maintainer has read them. See [on-demand workflows](#on-demand-workflows). |
| `/codeman continue <text>` | Resumes a blocked or unfinished task with a new run count. The text is optional guidance for the agent. |
| `/codeman set <name> <value>` | Changes `model`, `task-budget`, `max-runs`, `language` or `gpu` for this task from now on. The last valid one wins. |
| `/codeman model <id>` | Short for `/codeman set model <id>`. |

The issue's description may also hold `set` and `model` lines, to choose settings when opening the issue. Comments come after it, so a `set` in a comment wins. The agent reads the description without its command lines. Any other command in the description is a problem. Problems in the description, including invalid settings, are reported in every run while the description has them. The description does not start a run.

Text after `decide` or `approve` is not part of the command: the agent sees it later as a maintainer comment, but it is not recorded as an answer. Use `answer` or `replan` when the text matters.

Only comments from maintainers count, both for commands and for the text the agent sees, and only issues they opened are tasks. A maintainer is a user with `admin`, `maintain` or `write` access to the repository, read from `GET /repos/{owner}/{repo}/collaborators/{user}/permission`. The `author_association` field is not used: GitHub computes it for the reader, and an App token sees private organization members as `CONTRIBUTOR`. Answers are recorded in the status comment and in an `## Answers` section of the plan. When no decision is pending, the task becomes `codeman:ready`. A `replan` in a batch of new commands wins: the run plans again instead of only recording answers.

## Status and run comments

Codeman keeps one status comment per task up to date, as the task's panel: where the task is now and what comes next, plan and pull request links, a link to the decisions, workflows to review, the task's spend, the model, and links to the last run and its report. A hidden block in it stores the task record (branch, plan path, decisions, answers, last handled comment and review, pull request, runs in a row, spend), gzip-compressed and in base64url, because the comment holds at most 65,536 characters. Records written before compression are still read. Codeman reads that block only from comments written by its own GitHub App, because anyone can post a comment containing it.

Once a task has decisions, a decisions comment shows them, with the recommendations, the answers and how to answer. Codeman renders it from the task record, edits it in place, and never reads it back: the record stays the only state, and an update that fails is repaired by the next one. The record keeps its ID; if it was deleted, Codeman posts a new one. A revised plan's decisions get a new comment, and the earlier one stays as it was; when a revised plan has no decisions, the earlier comment says so. Tasks from before this comment existed get it in their next run.

No comment Codeman writes exceeds the platform's limit: 65,536 characters on GitHub. When the decisions do not fit, answered ones are shown in one line each, then left out, then pending ones from the last, with a note that the plan has them all. When the panel does not fit, it keeps its record and links and leaves out the rest, with a note.

Each run that moves the task also posts a new comment on the issue, so the issue keeps the task's history in order: its title says what the run worked on (the plan, the route, a stage, recorded answers or accepted workflows) and how it ended (such as "Design stage: skipped"); then come the agent's report, problems, what comes next (the next stage, the maintainers' decisions, accepting workflows, a maintainer, or reviewing the pull request), and what the run spent. A run that only waits to try again later, because the monthly budget is reached, updates the panel only.

Each stage's agent reads Codeman's earlier run comments on the task, oldest first, up to 20,000 characters (older ones are dropped first). Only comments by the App with the run marker count, and the agent treats them as data: the agents that wrote them read untrusted text.

Text written by the agent is rendered as safe Markdown: emphasis, code, lists, quotes and tables work, but HTML is escaped, links and images show as their text followed by the URL, and @mentions and issue references are broken with an invisible space, so they notify and link nothing. Its headings are lowered to level 5, so it cannot imitate Codeman's own, and a code block it leaves open is closed. Short fields stay on one line. Text written by users, such as free-text answers, is rendered fully inert.

## Conversation language

Codeman talks to maintainers in the task's language: the fixed texts of the status and run comments, the pull request's description and review comments, and what the agent writes for them (summaries, reasons, decisions, reports). Code, comments, commit messages and documentation, the plan included, follow the [agent rules](#agent-rules) instead.

- With `language: auto` (the default), the planning agent reports the conversation's language, from the issue and the maintainer comments, and the task record keeps it. Until then, Codeman writes in English. Any other value of `language` wins over the reported one.
- Fixed texts come from catalogs in `src/i18n/`: English and Brazilian Portuguese. A language without a catalog uses its base language's (`pt-PT` uses Brazilian Portuguese), or else English. Numbers and dates follow the language.
- Commands, labels, file paths, the workflow's logs and technical details of an invalid agent result stay in English.
- The pull request's title is the issue's title.

## Platforms

The steps reach the platform and the runtime only through interfaces. GitHub and GitHub Actions are the only implementations so far; [`src/main.ts`](../src/main.ts) wires them into `Services`, which each step takes. Tests run `select` and `apply` on an in-memory platform unlike GitHub ([`src/testing/`](../src/testing/)).

| Interface | Covers | GitHub implementation |
| --- | --- | --- |
| `Platform` ([`src/platform/platform.ts`](../src/platform/platform.ts)) | Tasks and their state labels, comments on issues and on change requests, change requests and their reviews, who is a maintainer, the account Codeman writes as, files and commits, links and references. | [`src/platform/github/platform.ts`](../src/platform/github/platform.ts): the REST and GraphQL APIs, through the App's token. |
| `CiResults` | Runs of CI on a commit, their jobs, logs and artifacts. | [`src/platform/github/ci.ts`](../src/platform/github/ci.ts): GitHub Actions. |
| `Conventions` ([`src/platform/conventions.ts`](../src/platform/conventions.ts)) | The Markdown dialect (mentions and references to break), the comment size limit, where CI configuration lives, the rules that protect it, and what the agent is told about writing and reviewing it. | [`src/platform/github/conventions.ts`](../src/platform/github/conventions.ts). |
| `Runtime` ([`src/runtime/runtime.ts`](../src/runtime/runtime.ts)) | Inputs and outputs of a step, logs, the run's summary, secret masking, the workspace, the run's ID, attempt and link, the repository, and the job's OIDC token. | [`src/runtime/github-actions.ts`](../src/runtime/github-actions.ts). |

Every adapter must guarantee:

- **Ordered IDs.** Comment and review IDs are numbers that grow with time within an issue or change request: Codeman marks requests as handled by the highest ID it has read. A platform without them, such as reviewer votes, synthesizes them.
- **An identity nobody else has.** `self()` names an account only Codeman can post as. The task record and the run history are read only from its comments.
- **A real maintainer check.** `isMaintainer` reads the platform's permissions (write access or more), never what a user or a comment claims.
- **Comments kept as written.** The task record lives in a hidden HTML comment inside the status comment, so the platform must keep Markdown as written, HTML comments included, up to its `commentLimit`, which must be at least 65,536 characters: the agent's output limits are set for it.
- **Atomic, guarded commits.** `commit` writes all changes at once, without running git on the agent's files, and fails without writing if the branch moved since the base commit.
- **Safe Markdown.** The dialect matches every mention and reference the platform renders. This is a security boundary: a reference it misses lets the agent notify or link anyone.
- **Unambiguous key names.** OpenRouter keys are named `codeman/<owner>/<repo>/<issue>/<run>`. An owner of several segments, such as a group path, must not make one repository's name a prefix of another's. Pods carry the owner, lowercase, in `CODEMAN_ORGANIZATION`, compared whole.

The [security model](security.md) relies on GitHub Actions: credentials scoped to each job, secrets masked at runtime, and runs started by comments and reviews. Another runtime must provide each of these or an equivalent, and the security document must be reviewed for it before Codeman runs there.

