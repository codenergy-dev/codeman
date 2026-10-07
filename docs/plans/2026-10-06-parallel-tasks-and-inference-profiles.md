---
status: in progress
created_at: 2026-10-06T20:43:40-03:00
updated_at: 2026-10-06T23:04:07-03:00
commit: 3f6983b
---

# Parallel tasks, inference profiles and shared settings

## Goal

A repository can run several tasks at once on the same self-hosted GPU, so a pod or a Serverless worker stays busy and its hourly cost serves more work; it can choose an inference per case (stage, number of tasks at once) from a list of profiles; and its settings can come from outside the repository, such as an organization's variable shared by several repositories.

## Context

- **One task at a time.** A repository has one active run (`concurrency: codeman` in [`templates/codeman.yml`](../../templates/codeman.yml)), and each run works on one task, picked by `select` ([architecture](../architecture.md#runs)).
- **A pod per task.** A pod serves one task, kept between its runs (`pod-reuse: task`); its gateway serves one run at a time, with one token and one budget ([the gateway](../architecture.md#the-gateway)). A Serverless endpoint has at most one worker, which can take several requests at once (the vLLM worker's `MAX_CONCURRENCY`).
- **What sharing would save.** A GPU bills by the second whether the agent generates or runs its tools, which takes much of a run. Two tasks on one GPU fill each other's pauses; on OpenRouter, which bills tokens, parallel tasks only finish sooner ([choosing](../architecture.md#choosing)).
- **One inference per repository.** `inference`, `gpu-mode`, `engine`, `model` and the rest are single values; only `model` and `gpu-type` can change per task (`/codeman set`). The [self-hosted inference plan](2026-10-02-self-hosted-inference.md) left mixing providers within a task out of scope; profiles bring it in: the task's spend must add up across providers, and the month's too.
- **Settings.** Each value comes from a task's command, a manual run's input, `.codeman/settings.yml` on the default branch, or Codeman's default ([settings](../architecture.md#settings)). The file accepts only flat `name: value` lines ([`src/settings.ts`](../../src/settings.ts)), so a list of profiles needs a richer format, without a YAML dependency unless one is audited and approved.
- **Organization variables.** GitHub Actions variables can be set for an organization and shared with chosen repositories, and a workflow reads them as `vars.<NAME>`. They are plain text, not secrets: they suit settings, which hold none. Their limits and who can read them are to be checked in GitHub's documentation (step 1).

## Decisions

1. **How tasks run at once.** Options:
   - (a) One workflow run takes up to `parallel-tasks` tasks (a new setting, default 1) and runs the key, agent and apply jobs for each as a matrix. `select` picks them all, so no two runs pick the same task. The run ends when its slowest task does, and the next run starts then.
   - (b) A run per task: a dispatching run picks the tasks and starts a run for each, with a concurrency group per task. Tasks move independently, but the dispatcher must know which tasks have a run in progress, and runs on one GPU must find each other.

   Recommendation: (a). It keeps one reader of the tasks' state and one place that picks, and the runs of a matrix know their shared GPU. A fast task waiting for a slow one is the price; (b) can follow if it matters.

   **Answer:** (a).
2. **Sharing a GPU.** Options:
   - (a) The runs of a workflow run that use the same self-hosted profile share one pod, or the endpoint's one worker. The gateway serves several runs at once, each with its own token, limit and records.
   - (b) Parallel runs, but each task keeps its own pod.

   Recommendation: (a): sharing is the goal. (b) only saves time.

   **Answer:** (a).
3. **Splitting a shared GPU's cost.** Options:
   - (a) Each second of the pod (or of the worker's billed time) is split evenly among the runs active on it in that second; a kept pod's time between runs goes to the tasks that keep it.
   - (b) In proportion to each run's tokens.
   - (c) Each run counts the whole time, as if alone.

   Recommendation: (a). The shares add up to what Runpod bills, and a run pays for the time it held the GPU. (b) charges a run that generates little but holds a long context too little; (c) counts the same second several times.

   **Answer:** (a).
4. **The profiles' format.** Options:
   - (a) A list in `.codeman/settings.yml`, under `inference-profiles`, each profile a block of the settings it changes and the conditions it applies under. The parser grows to a strict subset of YAML: block mappings, block lists and lists of scalars in brackets, anything else an error.
   - (b) Flat keys with a profile's name in them, such as `profile.small.model: ...`, keeping today's parser.
   - (c) A separate JSON file, `.codeman/inference.json`.

   Recommendation: (a), written in house: one file, readable, and as strict as today's. For example:

   ```yaml
   model: anthropic/claude-sonnet-4.5     # the default profile
   parallel-tasks: 2
   inference-profiles:
     - name: small-pod
       when:
         stages: [route, code, test]
         parallel-tasks: 2                 # when the run has at least 2 tasks
       inference: self-hosted
       gpu-mode: pod
       gpu-type: NVIDIA RTX A6000
       model: qwen3-coder:30b
   ```

   **Answer:** (a).

   With shared settings (decision 7), `inference-profiles` is one value like any other: the first layer that sets it gives the whole list, so a repository's file that has one replaces the organization's, and one without it keeps the organization's.
5. **Which profile a run uses.** Options:
   - (a) The first profile whose conditions all hold, in the file's order; the top-level settings when none does.
   - (b) The most specific profile: the one with the most conditions that hold.

   Recommendation: (a): what applies can be read from the file, top to bottom. A task's `/codeman set` still wins over any profile.

   **Answer:** (a).
6. **The budgets across providers.** Options:
   - (a) The task's spend is the sum in its record, whatever the provider (the record already keeps it); the month is the sum of each provider's month (OpenRouter: the repository's keys; Runpod: the account), so `open-key` needs every provider's credentials that the profiles name.
   - (b) Each provider's month is checked against the monthly budget on its own.

   Recommendation: (a). A budget is one limit; with (b), two providers would allow twice as much.

   **Answer:** (a).
7. **Settings from outside the repository.** Options:
   - (a) A workflow input, `settings`, that the template fills from an organization variable (`vars.CODEMAN_SETTINGS`), in the same format as the file. The repository's file overrides it, value by value: the organization gives defaults.
   - (b) The same input, overriding the repository's file: the organization enforces.

   Recommendation: (a). The organization shares a configuration without taking it from the repositories; a repository that needs to differ says so in its own file. A task's commands and a manual run's inputs still come first. The run's log names the layer each value came from.

   **Answer:** (a).
8. **Delivery.** Options:
   - (a) In three parts, each released and tested on its own: shared settings (decision 7), then profiles (4 to 6), then parallel tasks (1 to 3).
   - (b) All at once.

   Recommendation: (a). Each part is useful alone, and the first two carry no GPU cost to test.

   **Answer:** (a).

The responsible person answered every decision on 2026-10-06 with its recommendation.

## Steps

1. Read and record GitHub's pages on variables (limits, who can read and set them), on matrices (`strategy.matrix`, `fail-fast`, `max-parallel`) and on concurrency, in `docs/web/github/`. Done when the pages are there and this plan is updated with what differs.

   **Done on 2026-10-06.** Recorded in full (CC BY 4.0): [Variables](../web/github/variables.md), [Store information in variables](../web/github/store-information-in-variables.md), [Variables reference](../web/github/variables-reference.md), [Running variations of jobs in a workflow](../web/github/running-variations-of-jobs-in-a-workflow.md), [Concurrency](../web/github/concurrency.md) and [Control the concurrency of workflows and jobs](../web/github/control-the-concurrency-of-workflows-and-jobs.md). What they add to the context:
   - Variables: only organization owners create an organization's variables, each with a repository access policy; private repositories on GitHub Free cannot read them; a variable holds at most 48 KB; an unset variable reads as an empty string; variables are shown unmasked in the logs. A repository variable with the same name takes precedence over the organization's, whole: it cannot override single values, so a repository does that in its file, as decision 7 intends.
   - For part 3: in a matrix with `fail-fast: true`, a failing job cancels the jobs in progress and queued, so the agent jobs need `fail-fast: false` for one failing task to leave the others; `max-parallel` caps the jobs at once. A concurrency group now also takes `queue: max` (up to 100 pending runs), besides the default single pending run that replaces the previous one; `concurrency: codeman` keeps the default.
2. Shared settings (decision 7): the `settings` input, its layer, the template's `vars.CODEMAN_SETTINGS`, and the log of each value's source. Done when `settings` and `select` tests cover the four layers.

   **Done on 2026-10-06.** As planned. The layer order is: task commands, a manual run's inputs, `.codeman/settings.yml`, the `settings` input, Codeman's defaults. An empty input is no layer, so older workflow files work unchanged. Errors in the input name it as ``the `settings` input (organization variable CODEMAN_SETTINGS)``, and stop the run like a malformed file. `select` logs a line per layer with the values that come from it (`Settings from .codeman/settings.yml: model=..., max-runs=9.`); values are short scalars. The language of a refusal panel, read before a task is picked, also falls back to the organization's. Docs: architecture (Settings, Jobs), installation (Shared settings, credentials table), security (Secrets), the README, the template and `action.yml`.
3. The settings format (decision 4): the parser's subset, with errors that name the line, and the profiles' fields and conditions. Done when `settings` tests cover valid and invalid profiles, and today's flat files read the same.

   **Done on 2026-10-06.** The parser is [`src/yaml.ts`](../../src/yaml.ts), in house: block mappings, block lists (also at their key's indentation), lists of plain or quoted scalars in brackets, `#` comments; tabs, `{...}`, anchors, tags, multi-line values and nested lists are errors that name the line. Flat files read as before; one change in what is accepted: a plain value may now hold spaces between words (`gpu-type: NVIDIA RTX A6000`), as YAML reads it, so the plan's example works unquoted. [`src/settings.ts`](../../src/settings.ts) checks the profiles: a `name` (letters, digits, `.`, `_`, `-`; unique), `when` with `stages` (non-empty, of `plan`, `route` and the stages) and `parallel-tasks` (a positive whole number), and only `PROFILE_SETTINGS` (the inference settings and `model`); any other setting is an error that lists the allowed ones. `inference-profiles: []` is an empty list, which lets a repository remove the organization's. Choices made:
   - The top-level `parallel-tasks` setting is left to part 3: profiles only parse the `when.parallel-tasks` condition, which holds when the run has at least that many tasks. Until part 3, a run has one task, so a profile with `parallel-tasks: 2` or more never applies; part 3 passes the run's number of tasks where `select` passes 1 (`RunConditions.tasks`).
   - Every profile is checked over the top-level settings in every run, whichever stage runs, so a mistake shows on the first run; errors name the profile.
4. Profiles (decisions 5 and 6): each run's profile, passed to the jobs as `select`'s `inference` output is today; the task's and month's spend across providers; a profile's provider whose secret is missing reported as a problem. Done when tests cover a profile per stage, a fallback, a task's override and a task that used two providers.

   **Done on 2026-10-06.** What differs from decision 6: the record keeps the task's total (`spent`), but a run on OpenRouter replaces it with the sum of the task's OpenRouter keys, which would drop what self-hosted runs spent. So the record also keeps what self-hosted runs added (`inference.spent`, optional; a record without it that has pods counts its whole `spent` as self-hosted, as before profiles), and the task's total is the OpenRouter keys' sum plus that part (only the record's total when no profile names OpenRouter). What was built:
   - `resolveRun` resolves a run's settings: the layers, then the first profile whose conditions hold for the run's stage (`plan`, `route`, or the stage of `implement`), then the task's own `model` and `gpu-type`. Runs without an agent (`record`, `accept`) use the top-level settings. A task's value that does not fit the profile's inference is reported as before (`settings-rejected`), and the run goes on without it.
   - Choice: a profile also replaces a manual run's inputs (only `model` among them is a profile's setting), since the plan names only the task's commands as winning over profiles; inputs are top-level values for one run, and a manual `model` that won over every profile would break the profiles on self-hosted inference, since `next-run` carries it over.
   - `select`'s `inference` output carries the profile, every provider the top level and the profiles name (`providers`), and the record's total and self-hosted part (`recorded`, which replaces `taskSpent`). The task context's `settings` are the run's, so the agent, `apply`'s spend row (model and provider) and the panel follow the profile with no change of their own.
   - `open-key` reads the budgets through `InferenceBudget` ([`src/inference/budget.ts`](../../src/inference/budget.ts)): the month of each named provider (OpenRouter's keys, the Runpod account), logged per provider and added up against `monthly-budget`. The template already passes both secrets to `open-key` (empty when unset), so it needed no change beyond its comment.
   - A named provider whose secret is empty: `open-key` opens nothing, with status `missing-credentials` and a reason that names the secret; `apply` blocks the task, with the reason in its errors, as a key job that failed does today (a configuration a maintainer must fix, not a budget to wait for).
5. Parallel tasks (decision 1): `select` picks up to `parallel-tasks` tasks, and the jobs run as a matrix, each task's `apply` writing only its own task. Done when tests cover two tasks moving in one run, one failing, and `next-run`.
6. A shared GPU (decisions 2 and 3): the gateway's runs at once, its cost split, a pod kept while any of its tasks goes on, and the Serverless gateway shared by the agent jobs of a run. Done when gateway and inference tests cover two runs at once, a split, and a run that ends before the other.
7. Docs: [`docs/architecture.md`](../architecture.md) (Runs, Jobs, Settings, Self-hosted inference), [`docs/installation.md`](../installation.md) (an organization's settings) and [`docs/security.md`](../security.md) (what the variable may hold). Done when they describe each part.

   Part 1 (shared settings) is described as of 2026-10-06.

   Part 2 (inference profiles) is described as of 2026-10-06: architecture (Settings with its Inference profiles subsection, Jobs, Budget, Self-hosted inference's Choosing and Spend), installation (Inference profiles, the credentials table), the README, `action.yml` and both templates. `docs/security.md` needed no change: the key jobs hold the same secrets as before.
8. On the test account, with the responsible person's approval of the cost: two tasks on one pod. Done when the results are recorded here.
9. Rebuild `dist/` and run `npm run check` after each part. Done when it passes.

   Part 1: passed on 2026-10-06.

   Part 2: passed on 2026-10-06.

## End-to-end test

### Part 1: shared settings

No GPU and no cost beyond a planning run on OpenRouter. On a test organization with a test repository that runs Codeman (its workflow updated to this version, with the `settings: ${{ vars.CODEMAN_SETTINGS }}` line):

1. Remove `model` and `task-budget` from the test repository's `.codeman/settings.yml`, keeping a value such as `max-runs: 3`.
2. As an organization owner, create the organization variable `CODEMAN_SETTINGS` with `model: <an OpenRouter model ID>`, `task-budget: 1` and `max-runs: 5`, and grant the test repository access to it.
3. Open an issue as a maintainer, label it `codeman`, and start a manual run (**Run workflow**) with empty inputs. Check that the run plans the task with the organization's model, and that the `select` step's log has ``Settings from .codeman/settings.yml: max-runs=3.`` and ``Settings from the `settings` input (organization variable CODEMAN_SETTINGS): model=..., task-budget=1.`` (`select` logs the settings only when it picks a task.)
4. Add `task-budget: 2` to the repository's file on the default branch, close the first issue, open a second one and run again. Check that `task-budget=2` moved to the file's line, and that the panel's budget shows 2.
5. Close it, open a third issue whose description has the line `/codeman set task-budget 3`, and start a manual run with `max-runs` set to 4. Check the lines of the task's commands (`task-budget=3`) and of the workflow's inputs (`max-runs=4`), and that the organization's line keeps only `model`.
6. Change the variable to a malformed line, such as `secret: x`, and run. Check that `select` fails with ``the `settings` input (organization variable CODEMAN_SETTINGS), line 1: unknown setting `secret`.`` and that no other job ran.
7. Restore the variable, or delete it and put `model` back in the file; check that a run without the variable behaves as before.

Results: to be recorded here.

### Part 2: inference profiles

Costs a planning run on OpenRouter and a code run on a Runpod pod (a few minutes of an RTX A6000, under US$ 1), within the test account's budgets. On the test repository, with its workflow updated to this version and both `CODEMAN_OPENROUTER_MANAGEMENT_KEY` and `CODEMAN_RUNPOD_API_KEY` set:

1. In `.codeman/settings.yml`, keep an OpenRouter `model` at the top level, and add:

   ```yaml
   inference-profiles:
     - name: planner
       when:
         stages: [plan, route]
       model: <another OpenRouter model ID>
     - name: small-pod
       when:
         stages: [code]
       inference: self-hosted
       gpu-type: NVIDIA RTX A6000
       model: qwen3-coder:30b
   ```

2. Open an issue as a maintainer with a small, clear change (no decisions to answer), label it `codeman`, and start a manual run. Check that the `select` step logs ``Settings from .codeman/settings.yml: model=..., inference-profiles=[planner, small-pod].`` and ``Inference profile `planner` applies to this run.``, that `open-key` logs ``The run uses the inference profile `planner`.`` and ``Usage this month (openrouter US$ ..., runpod US$ ...): US$ ... of US$ ...``, with the sum of both, and that the plan's row in the panel's spend table shows the planner's model and `OpenRouter`.
3. Let the runs chain to routing (`planner` again) and to the code stage. Check that the code run's `select` logs ``Inference profile `small-pod` applies to this run.``, that `open-key` starts a pod and its task spend is what OpenRouter's keys spent so far, and that the code row shows `qwen3-coder:30b` and `Runpod (pod)`.
4. When a later run on OpenRouter ends (review, which no profile names, uses the top-level model), check that the panel's task total is OpenRouter's rows plus the pod's, not OpenRouter's alone, and that the record's `inference.spent` (decode the panel's record) is the pod's part.
5. Close the issue. Open another whose description has `/codeman set model qwen3-coder:480b`, and start a run: the planning run reports that the task's settings were not applied (`planner` is on OpenRouter) and plans with the planner's model. Remove the line before the code stage, or close the issue, to avoid a larger GPU.
6. Break the file: add `task-budget: 5` inside `small-pod`, and start a run. Check that `select` fails with ``.codeman/settings.yml, line N: a profile cannot set `task-budget`; ...`` and that no other job ran. Then remove `gpu-type` from `small-pod` instead, and check the error ``Inference profile `small-pod`: Self-hosted inference on pods needs `gpu-type` ...``, even for a planning run.
7. Restore the file, and remove the `CODEMAN_RUNPOD_API_KEY` secret (or rename it). Open an issue and run: check that `open-key` logs an error naming `CODEMAN_RUNPOD_API_KEY` and opens nothing, even though planning uses OpenRouter, and that the task is `codeman:blocked` with that error in its run comment. Restore the secret.

Results: to be recorded here.

## Out of scope

- Running tasks in parallel across repositories on one GPU: each repository's runs share only what its own workflow run starts.
- Choosing a profile by anything other than the stage and the number of tasks at once, such as the task's size or labels.
- Settings from anywhere but the repository and the workflow's inputs, such as a URL.
