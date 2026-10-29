# Writing e2e scenarios

This page is for whoever adds a scenario to the [end-to-end suite](suite.md): the file's format, the world it sets up, the agent's script, and each action and check. The types are in [`e2e/runtime/scenario/schema.ts`](../../../e2e/runtime/scenario/schema.ts), and the validator in `validate.ts` beside it.

## The file

- **Where:** a `.yaml` file under `e2e/scenarios/<subject>/`. Its ID is its path there without `.yaml`, such as `happy-path/openrouter-plan-only`.
- **YAML:** version 1.2 with the core schema. Custom tags, merge keys (`<<`) and duplicate keys are errors, and aliases may expand at most 100 times.
- **Keys** are kebab-case, such as `max-runs`. Any unknown key is an error, in the fakes' own shapes too (`runpod.catalog`, `runpod.endpoints`) and in the agent's script.
- **Errors** name the file, the line and the field, such as `actions[3].expect.labels: missing.`
- **Check it:** `npm test` loads every scenario, so a new one is checked before any Docker run.

> [!NOTE]
> Quote a number that is text, such as a port in a label: `label: "8080"`. A field that takes text refuses a bare number.

## Example

[`happy-path/openrouter-plan-only.yaml`](../../../e2e/scenarios/happy-path/openrouter-plan-only.yaml), whole:

```yaml
name: OpenRouter, a labeled issue gets its plan and decisions
tags: [happy-path, openrouter]
runner: simulator
world:
  organizations:
    - name: acme
      settings: { model: deepseek/deepseek-v4.1-flash, task-budget: 2 }
  repositories:
    - { name: acme/app, fixture: node-small, maintainers: [alice] }
agent:
  i1:
    plan:
      - steps:
          # The plan's path holds the day's date: the agent reads it from its task file.
          - bash: plan=$(sed -n 's/.*Create the plan at `\([^`]*\)`.*/\1/p' .codeman/task.md) && mkdir -p "$(dirname "$plan")" && printf '# Add a health route\n' > "$plan"
          - output:
              summary: Adds a health route.
              decisions:
                - id: 1
                  title: Port
                  question: Which port?
                  options: [{ key: a, label: "8080" }, { key: b, label: "3000" }]
                  recommendation: a
actions:
  - open-issue: { ref: i1, as: alice, title: Add a health route, labels: [codeman] }
  - run: { event: issues.labeled }
  - expect:
      issue: i1
      labels: [codeman:awaiting-decision]
      comments: [{ kind: decisions, contains: Which port? }]
```

1. The world has one organization, with its `CODEMAN_SETTINGS`, and one repository made from the `node-small` fixture.
2. `open-issue` opens the issue and names it `i1`. Its `codeman` label records an `issues.labeled` event.
3. `run` starts Codeman's workflow for that event, and waits for its jobs and the runs they start.
4. The planning agent's one round writes the plan, then its [agent output](../../runs/agent.md#agent-output).
5. `expect` checks the issue's state label and its decisions comment.

[`openrouter-to-done.yaml`](../../../e2e/scenarios/happy-path/openrouter-to-done.yaml) goes on to `codeman:done`, with `comment` and `advance`.

## Top-level fields

| Field | Required | Value | Default |
| --- | --- | --- | --- |
| `name` | Yes | What the scenario shows, in one line | |
| `tags` | No | Words that select it on the command line: lowercase letters, digits and `-`. `known-bug` marks a scenario that reproduces a bug of Codeman not fixed yet ([known bugs](suite.md#known-bugs)) | None |
| `runner` | No | `simulator`, `act`, or a list of both, such as `[simulator, act]`: the file then makes one scenario per runner ([under act](suite.md#under-act)) | `simulator` |
| `profiles` | No | The Compose profiles it needs: `ollama`, `vllm` ([memory](suite.md#profiles-and-memory)) | None |
| `timeout` | No | The whole scenario's time limit | `15m` |
| `world` | Yes | The users, organizations and repositories; see [the world](#the-world) | |
| `agent` | No | The scripted agent's replies; see [the agent's script](#the-agents-script) | None |
| `actions` | Yes | The steps, in order, at least one; see [actions](#actions) | |

## Values

| Kind | Written | Notes |
| --- | --- | --- |
| Duration | `500ms`, `90s`, `25m`, `2h`, `1d` | Decimals allowed, such as `1.5m` |
| Issue ref | `i1`: letters, digits, `.`, `_`, `-` | Defined by `open-issue`; an action may name only refs defined before it |
| Pod ref | The same characters | Defined by a `pods` check's `ref` |
| `repo` | `owner/name` | Optional when the world has one repository |
| User | A login of the world | `as:` must name one |
| Label | Any text | One in `codeman:` must be a [state label](../../tasks/lifecycle.md#tasks-and-states) |

## The world

`world` takes `repositories`, required, and `users`, `organizations`, `app`, `runpod` and `openrouter`. Every user named anywhere in it is created.

### Organizations and repositories

| Field | Of | Value | Default |
| --- | --- | --- | --- |
| `name` | Both, required | An organization's login; a repository's `owner/name` | |
| `owners`, `members` | Organization | Logins | None |
| `fixture` | Repository, required | A directory of `e2e/fixtures/`, such as `node-small` | |
| `maintainers` | Repository | Logins, with the `maintain` role: [maintainers](../../glossary.md#maintainer) | None |
| `collaborators` | Repository | `{ login: role }`, such as `{ bob: read }` | None |
| `private`, `drafts` | Repository | `true` or `false` | `true` |
| `settings` | Both | `CODEMAN_SETTINGS`, as a mapping or as the [settings file's](../../settings/reference.md) text. A repository's replaces the organization's whole | Unset |
| `variables` | Both | Other variables, `{ NAME: value }`, not `GITHUB_*` nor `CODEMAN_SETTINGS` | None |
| `secrets` | Both | The provider secrets given: `openrouter`, `runpod`, `runpod-serverless` | A repository's organization's, else all three |
| `submodules` | Repository | `{ path: sha }`: gitlinks of its first commit, as `git submodule add` records them, such as `{ vendor/lib: "<40 hex>" }`. The commit need not exist; the checkout leaves the path empty | None |

A repository whose owner is no organization of the world belongs to a user account.

### The rest of the world

| Field | Value | Default |
| --- | --- | --- |
| `users` | Logins with no role, such as a stranger who comments | None |
| `app.slug` | The App's slug | `codeman` |
| `app.installations` | `[{ owner, repositories, permissions }]`: `repositories` is `all` or names; `permissions` is `{ name: read \| write \| admin }` | One per owner, on all its repositories, with Codeman's permissions |
| `runpod.catalog` | GPU types, in the fake Runpod's shape ([`catalog.ts`](../../../e2e/fakes/runpod/catalog.ts)), with its camelCase keys, such as `maxCount` | The fake's catalog |
| `runpod.endpoints` | [Serverless endpoints](../../glossary.md#serverless-endpoint), in the fake's shape ([`serverless.ts`](../../../e2e/fakes/runpod/serverless.ts)), such as `workers: { min, max, idleTimeout }` | None |
| `runpod.tee.meet` | `{ issues, timeout }`: the tee of each pod holds the agents' turns until turns of `issues` issues, at least 2, wait together, each for at most `timeout`, 2 minutes by default ([the tee](fakes.md#the-tee)) | No holding |
| `openrouter.prices` | `{ prompt, completion }`, USD per token | The fake's |
| `openrouter.lags` | `{ usage, analytics }`: a duration, or `hold` until settled | None |
| `openrouter.credits` | The account's credits, in USD | 100 |

> [!NOTE]
> A pod run's cost counts from the pod's creation ([the budget cut-off](../../inference/self-hosted.md#the-budget-cut-off)), and no action moves that clock. A scenario that spends a run's budget on a pod, through a high `runpod.catalog` price, must leave the agent time to start first: its first request came 59 seconds after the pod's creation on a loaded machine. `budgets/spent-run-gets-402` gives it 180 seconds.

### What the runtime adds

- Codeman's workflow templates in each repository's `.github/workflows/`.
- Codeman's own repository on the fake, at the commit `CODEMAN_COMMIT_SHA` names.
- The App, its private key, the key encryption secret, and fake provider keys.
- The Google side, which admits the world's repository owners, and a new Firestore project.

## The agent's script

`agent` holds, per issue ref, per [stage](../../glossary.md#stage), a list of rounds. Round *n* answers the stage's *n*-th run on that issue. The stages are `plan`, `route`, `web`, `design`, `code`, `test` and `review`.

```yaml
agent:
  i1:
    code:
      - usage: { prompt: 1200, completion: 300 }
        steps:
          - write: { path: src/health.ts, content: "export const ok = true;\n" }
          - output: { status: done, summary: Adds the route., commitMessage: Add a health route }
        fix:
          - output: { status: done, summary: Shorter. }
```

| Round field | Value |
| --- | --- |
| `steps` | Required. One model turn each, in order |
| `fix` | The steps of the [fix pass](../../runs/agent.md#the-fix-pass), when Codeman resumes the session with its output's problems |
| `wrap-up` | The steps of the [wrap-up](../../runs/agent.md#wrap-up), the new session after the round ran out of time. Like `steps`, its first turn reads the task file |
| `usage` | `{ prompt, completion, cached }` tokens that each reply reports, for deterministic costs |
| `final` | The text of the last reply, which ends OpenCode's loop. `Done.` by default |

| Step | Value | Turns into |
| --- | --- | --- |
| `write` | `{ path, content }` | OpenCode's `write` tool |
| `edit` | `{ path, old, new, all }` | `edit` |
| `bash` | A command, or `{ command, timeout, workdir }` | `bash` |
| `read` | A path, or `{ path, offset, limit }` | `read` |
| `output` | The stage's output, as a mapping | `.codeman/output.json`, written as JSON |
| `raw` | Text | `.codeman/output.json`, written as is: an invalid output |
| `hang` | The bare word | A reply that starts and never ends |
| `exit` | The bare word | A reply that starts, then the connection drops |
| `delay` | Milliseconds, such as `delay: 2000` | Waits before the next turn |
| `usage` | `{ prompt, completion, cached }` | Sets the next turn's usage |

`delay` and `usage` apply to the turn after them; after the last step, to the final reply.

> [!NOTE]
> `delay` takes a number of milliseconds, not a duration such as `2s`.

> [!NOTE]
> `delay` waits in the scripted model, after the engine's reply: it keeps the agent's turn away from the engine, not at it. To make two tasks' agents meet at a pod's engine, which start seconds apart, use `world.runpod.tee.meet`, as `parallel/vllm-two-seats` does.

> [!NOTE]
> A reply's usage counts the request's size unless `usage` sets it, and OpenCode compacts its conversation once that nears the run's context. On a pod with a small context, such as `parallel/vllm-two-seats`'s 8192 tokens, its own prompt takes about 4,500: keep the rounds to a few steps. A compaction's request matches no step, so it fails the scenario as unscripted.

A request that no round covers gets an error and a violation, which fails the scenario. How the model tells the scenario, issue, stage and round apart is in [the scripted model](fakes.md#the-scripted-model).

## Actions

Each action is a mapping with one key, its kind.

### Users' actions

Each one runs on the fake GitHub as the user `as:` names, and records the events GitHub would send.

| Action | Fields | Does |
| --- | --- | --- |
| `open-issue` | `ref`, `as`, `title` required; `repo`, `body`, `labels` | Opens an issue, and defines its ref. The runtime adds [the marker](fakes.md#the-scripted-model) to its body |
| `comment` | `issue` or `pull`, `as`, `body` | Comments on the issue, or on the pull request of the task `pull` names |
| `label`, `unlabel` | `issue` or `pull`, `as`, `label` | Adds or removes a label |
| `close`, `reopen` | `issue` or `pull`, `as` | Closes or reopens it |
| `review` | `pull`, `as`, `state` required; `body`, `comments` | Reviews the task's pull request: `approve`, `request-changes` or `comment`, with `comments` as `[{ path, line, body }]` |
| `push` | `as`, `files` required; `branch` with `repo`, or `task`; `message`, `base`, `force`, `age` | Commits `files` (`{ path: content }`, `null` deletes) to a branch, or to the [task branch](../../glossary.md#task-branch) of the ref `task` names. `age`, a duration, dates the commit that far back, as git lets whoever commits date it |

### Workflow runs

| Action | Fields | Does |
| --- | --- | --- |
| `run` | `event` required; `repo`, `inputs`, `max-runs` | Runs Codeman's workflow for the repository's last such event, then the chain it starts, until none is left |
| `advance` | `until`, `max-runs` required; `repo` | Runs the events and dispatches not run yet, oldest first, until `until` holds |
| `parallel` | Two or more lists of actions | Runs the lists at once |

- **Events:** `issues.labeled`, `issues.unlabeled`, `issues.closed`, `issues.reopened`, `issue_comment.created`, `pull_request_review.submitted`, `schedule` and `workflow_dispatch`.
- **`inputs`** are only for `workflow_dispatch`: the [manual run's inputs](../../glossary.md#manual-runs-inputs) `model`, `task-budget`, `monthly-budget`, `max-runs` and `batch`.
- **`max-runs`** counts runs that were not skipped. `advance` fails when it is reached, or when nothing is left to run. `run`'s, 10 by default, counts the runs its chain starts, beyond its first.
- **A `run`'s chain:** on GitHub, `next-run`'s and `dispatch`'s dispatches, and the events Codeman's App causes, start their runs at once. So `run` runs them too, those that appeared since it began, until none is left. Users' events, such as a comment made after the `run`, wait for an `advance`.
- **`parallel`:** each list sees the refs defined before it. After it, every list's new refs are defined.

### Settings and the store

| Action | Fields | Does |
| --- | --- | --- |
| `set-variable` | `org` or `repo`, `value` required; `name` | Sets a variable for the next runs: `CODEMAN_SETTINGS` by default, as text or a mapping. `value: null` deletes it |
| `seed` | `doc`, `data` required; `age` | Writes a store document, as written `age` ago |

In `seed`'s `data`, `now`, `now-45m` and `now+1h` are times relative to when it was written. So timers and expiries are tested with past timestamps, not a faster clock. `doc` must be a document of the [data layout](../../backend/data-layout.md), such as `organizations/acme/pods/p1`.

### Faults

`fault` takes one key: where the fault goes.

| Key | Value | Effect |
| --- | --- | --- |
| `github`, `openrouter`, `runpod`, `google`, `llm`, `npm`, `huggingface` | `{ path, method, status, body, delay, drop, times }`, `path` required | An HTTP fault on the fake's routes that `path` matches, such as `/v1/token`. One of `status`, `delay` or `drop` is required. `times` limits it |
| `runpod` | `{ pod-start, low-balance, hold-queues, pod-age }` | `pod-start: never` makes a pod that never serves, `fail` one that fails to start. `low-balance: true` makes each valid pod creation answer 402, as Runpod does for an account short of credit. `hold-queues` holds the Serverless queues: `true` or endpoint IDs. `pod-age`, a duration, dates the pods created from then on that far back, as Runpod reports and bills them: the seeded past of the timers that count from a pod's creation, such as `open-key`'s 25 minutes |
| `google` | `{ refuse-repositories, disabled-accounts, expiry }` | Refuses those repositories' tokens or those service accounts, or shortens the tokens' expiry |
| `openrouter` | `{ lags: { usage, analytics } }` | Changes the lags from now on |
| `pod` | `{ pod, action }` | The pod a ref names: `restart`, `exit` or `fail` |
| `job` | `{ name, issue, conclusion, times }`, `name` required | The template's job, for one task or all. `failure`, the default: it fails instead of running. `cancelled`: the run is cancelled, as a user would, when the job reaches its Codeman step (its first step, for `next-run`, `dispatch` and `forward-review`); that step does not run, and the job's and the run's `always()` steps and jobs do |
| `firestore` | `down` or `up` | Takes the emulator off the jobs' network, or back |
| `clear` | A list of fakes, or `all` | Clears their faults |

A fake's key with a mapping that has no `path` takes the second form, such as `runpod: { pod-start: never }`.

### Waits and checks

| Action | Fields | Does |
| --- | --- | --- |
| `apply` | `fail` or `skip`, or `{ mode, issue }` | So the agent's work is not applied, for one task or all: `fail` fails the `apply` job, `skip` cancels the run as `apply` reaches its Codeman step |
| `wait` | `until` and `timeout`, or `for` | Polls until `until` holds, or fails after `timeout`. `for` only pauses, such as a second between two users' actions, since GitHub's times count in seconds |
| `expect` | [Checks](#checks) | Polls for 15 seconds until every check holds, to absorb a fake's lag |

## Checks

`expect`, `wait`'s and `advance`'s `until` take the same checks. All must hold.

| Check | Value | Holds when |
| --- | --- | --- |
| `issue` | An issue ref | Names the issue the next five check. Required by them |
| `labels` | Labels | Each is on the issue |
| `no-labels` | Labels | None is on the issue |
| `comments` | `[{ kind, contains, by, count }]` | For each, a comment matches: `kind` is `status`, `decisions`, `run` or `any` (by Codeman's markers, [comments](../../tasks/comments.md#status-and-run-comments)); `contains` is text or a list of texts it holds; `by` its author |
| `commits` | `{ branch, count, files, no-files, message }` | The branch, the task's by default, against the default branch: its commits, the paths it changes or not, a message's text |
| `pull-request` | `none`, or `{ ready, state, files }` | The task's pull request: absent; or ready or a draft, `open` or `closed`, changing these paths |
| `store` | `[{ doc, absent, fields }]` or `[{ collection, where, count }]` | A document exists or not, with these fields; or a collection's documents that match |
| `ledger` | `{ cost-at-most, cost-at-least, runs, split-on, split-pod }` | The issue's task's [ledger](../../glossary.md#ledger) runs, or every run: their summed `cost` in USD, and their count. `split-on` names a Serverless endpoint whose runs [split its worker's time](../../inference/serverless.md#splitting-shared-worker-time): they overlapped, each closed run costs its share, and the shares add up to the worker's billed time. `split-pod` names a pod ref whose runs [split its time](../../inference/pods.md#splitting) ([below](#a-pods-split)) |
| `fakes` | `{ <fake>: { <list>: { where, count } } }` | A fake's list has matching items |
| `pods` | `[{ ref, pod, status, where, count }]` | The fake Runpod's pods. `ref` names the last that matches, for later checks; `pod` checks one named before |
| `engine` | `{ pod, gateway, ollama, vllm, tee }` | A pod's gateway `/admin/status`, with the admin token derived from the account's key and the pod's `CODEMAN_NONCE`; Ollama's `/api/ps`, through the tee; vLLM's first model of `/v1/models`, with its `metrics` ([below](#vllms-metrics)); what the tee saw ([below](#the-tees-view)). `pod` is a ref; without it, the only live pod. A terminated pod gives its last state, read just before its container was removed |
| `violations` | `none` | No fake recorded a violation |

Every scenario also ends with an implicit `violations: none`.

### Patterns

`fields`, `where`, `gateway`, `ollama` and `vllm` take patterns:

| Pattern | Written | Matches |
| --- | --- | --- |
| A scalar | `RUNNING`, `2`, `true`, `null` | An equal value; a number and its text are equal |
| A range | `{ at-least: 1, at-most: 3 }` | A number within it; a list whose length is within it, such as a pod's `seats` |
| A text's parts | `{ contains: text }`, or a list of texts | A text that holds each, such as a pod's end `reason` |
| A mapping | `{ status: done }` | An object with at least these fields, each matching |
| A list | `[a, b]` | A list of exactly these items, in order |
| Its opposite | `{ not: <pattern> }` | Anything the pattern does not match, such as a token's `scopes` other than a job's |

`count` takes a whole number or a range. Without it, one match is enough.

> [!NOTE]
> A mapping whose only key is `contains` or `not` is that pattern, not a field of that name.

`not` with a `count` of 0 checks every item: no token of `select` has scopes other than these.

```yaml
- expect:
    fakes:
      github:
        tokens: { where: { job: codeman.yml/select, kind: installation, scopes: { not: [actions=read, contents=read, issues=write, metadata=read, pull_requests=read] } }, count: 0 }
```

### The fakes' lists

| Fake | Lists |
| --- | --- |
| `github` | `events`, `dispatches`, `runs`, `violations`, `requests`, `tokens` |
| `openrouter` | `keys`, `generations`, `requests` |
| `runpod` | `jobs`, `requests` |
| `salad` | `groups`, `requests` |
| `google`, `npm`, `huggingface` | `requests` |
| `llm` | `turns`, `violations`, `requests` |

What each list holds is in [the e2e fakes](fakes.md#control-routes).

### The tee's view

`engine.tee` holds what the pod's [tee](fakes.md#the-tee) saw at the engine:

| Field | Value |
| --- | --- |
| `requests` | The chat requests it took, the agents' and the others, such as the gateway's probe |
| `agent` | The agents' requests, for which the engine got the short prompt |
| `overlap` | The most agents' requests the tee had at the engine at once: those the engine ran, and those it queued. OpenCode sends its title request beside its first turn, so it can reach twice the agents |
| `issues` | The most issues whose agents' requests the tee had at the engine at once: how many tasks' agents met there. Only the turns the scripted model tells the issue of count, not an agent's first turn nor its title |
| `held` | The agents' requests the tee held before the engine for `world.runpod.tee.meet` |
| `runners` | The engine's runner processes, such as Ollama's `llama-server`, each with its `args`, `context` (`-c`) and `parallel` (`-np`) |
| `slots` | The runners' slots, from llama-server's `/slots`, each with its `id` and `n_ctx`, its context |
| `busiest` | The most slots that processed at once, sampled while agents' requests were at the engine: how many requests the engine ran together. For vLLM, the most requests its `/metrics` gave as running (`vllm:num_requests_running`) |
| `waiting` | For vLLM, the most requests its `/metrics` gave as waiting (`vllm:num_requests_waiting`) in the same samples; 0 for Ollama, whose queue the tee cannot see |

```yaml
- expect:
    engine:
      pod: p1
      tee:
        runners: [{ parallel: 4, context: 131072 }]
        busiest: { at-least: 2, at-most: 4 }
```

A vLLM pod has no runner: its `runners` and `slots` are empty, and `busiest` and `waiting` come from its gauges, as in [`parallel/vllm-two-seats.yaml`](../../../e2e/scenarios/parallel/vllm-two-seats.yaml).

### A pod's split

`ledger.split-pod` holds when the closed ledger runs on the pod, of every organization of the scenario, [split its time](../../inference/pods.md#splitting):

- there are at least two;
- each costs less than the pod's time from its creation to the run's close, which a run alone on it would count;
- their costs add up to no more than the pod's time until the last close, and to no less than its time from the last run's opening to the last close, when every run was on it.

The pod's ref must be defined by an earlier action: put the check in an `expect` after the one whose `pods` check names it.

### vLLM's metrics

`engine.vllm.metrics` holds vLLM's `/metrics`, one key per sample of a `vllm:` metric ([metrics](../../web/vllm/vllm-v1-metrics-loggers-py-at-v0-31-0.md)):

- The key is the metric's name, with its labels other than `model_name` and `engine` in braces. Quote it in YAML.
- An info gauge, such as `vllm:cache_config_info`, gives its labels instead of its value, 1.

```yaml
- expect:
    engine:
      vllm:
        max_model_len: 8192
        metrics:
          "vllm:num_requests_running": 2
          'vllm:num_requests_waiting_by_reason{reason="capacity"}': 1
          "vllm:cache_config_info": { kv_cache_size_tokens: 87296 }
```

## Under act

A file with `runner: [simulator, act]` makes two scenarios: the first keeps the file's ID, such as `security/set-env-in-agent-output`, and the act one gets `.act` after it, with the tag `act`. The file's path or ID selects both; the `.act` ID, or the tag `act`, the act one alone.

```yaml
name: The agent's workflow commands reach no later step
tags: [security, openrouter]
runner: [simulator, act]
```

act runs success paths only ([decision 10](../../plans/2026-10-20-end-to-end-test-suite.md#answered-after-the-spikes)). The runtime refuses, before it starts anything, a scenario under act with a `fault` on a job or an `apply` action, anywhere in it.

> [!WARNING]
> Under act, a run where `open-key` is skipped, such as the run that records a decision's answer, fails: act gives a skipped job's outputs as their unevaluated text ([act's limits](suite.md#acts-limits)). So no scenario with decisions to answer, such as `happy-path/openrouter-to-done`, runs under act.
