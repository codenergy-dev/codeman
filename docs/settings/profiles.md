# Profiles

`profiles` is a list of profiles, each with a `name`, optional conditions beside it, and the settings it changes: only `provider`, `model` and the provider's settings. Budgets and limits stay at the top level. The choice was made in the [inference profiles plan](../plans/2026-10-06-parallel-tasks-and-inference-profiles.md) (decisions 4 to 6), the names in the [provider settings plan](../plans/2026-10-08-provider-settings.md), and the conditions and counts in the [plan for profiles that pick the tasks](../plans/2026-10-08-profiles-pick-the-tasks.md).

```yaml
model: deepseek/deepseek-v4.1-flash      # when no profile applies
profiles:
  - name: small-pod
    stages: [code, test]
    max-tasks: 2
    provider: runpod-pod
    gpu: NVIDIA RTX A6000
    model: qwen3-coder:30b
```

## Conditions

A profile's conditions sit at its first level, beside its `name`. A run is one task's stage, in a run of the workflow that works on several tasks at once; a profile applies to it when all its conditions hold:

| Condition | Holds when | Without it |
| --- | --- | --- |
| `stages` | The run's [stage](../tasks/stages.md) is one of the list: `plan` (planning), `route` (routing), `web`, `design`, `code`, `test` or `review` | Every stage |
| `tasks` | The run's count is exactly this, from 1 to 10 | Any count |
| `min-tasks` | The run's count is at least this, from 1 to 10 | No lower bound |
| `max-tasks` | The run's count is at most this, from 1 to 10 | No upper bound |

- **The run's count** is how many of the workflow run's tasks run an agent, whatever their stage and profile: recording answers and accepting workflows do not count. So in a run of 4 with a planning task and three code tasks, the code tasks take a profile with `tasks: 4`.
- **`tasks` goes alone**; `min-tasks` and `max-tasks` go together (a range) or apart. `tasks` with either, or `min-tasks` above `max-tasks`, stops the run with an error.
- **Only profiles have conditions.** The top level applies when no profile does, so a condition at the top level stops the run with an error that says to write it in a profile. `when` and the `parallel-tasks` condition are gone; their errors say what to write ([upgrading](../installation/upgrading.md#profiles-pick-the-tasks)).

## How many tasks a run takes

The profiles' counts also decide how many tasks a run works on at once, each in its own jobs ([runs](../runs/runs-and-jobs.md#runs)):

1. **The cap** is the largest `tasks` or `max-tasks` of the profiles; a `min-tasks` without `max-tasks` allows up to Codeman's cap of 10. With no count condition in any profile, a run takes one task at a time.
2. **Tasks without an agent first.** Recording answers and accepting workflows come first, and take places of the cap, as they always did; they are not part of the count.
3. **The count.** Of the other ready tasks, in priority order, a profile or the top level serves each at some counts. The run takes the largest count n, up to the places left, for which at least n tasks are served with n, and takes the first n of them. A task not served with n is passed over for that n, so one that waits does not hold back those behind it.
4. **A task waits** when every count that serves it needs more ready tasks than there are: its labels stay, and its panel says so, such as "Waiting for 4 tasks ready for profile `parallel-tasks`; 3 are." Every run checks it again; it moves nothing, so it starts no other run. A task some count would serve now, but that the run did not take, is left for the next run without a message.
5. **A task is blocked** when nothing serves its stage at any count: no profile does, and the top level has no `model`. `select` labels it `codeman:blocked`, and its panel names the stage. Fix the settings, then comment `/codeman continue` (or, for a task never planned, remove the label).

`select`'s log says what it picked, of how many, which tasks wait and which are blocked.

## Which applies

- `select` takes the first profile, in the list's order, whose conditions all hold for the run, and its values replace the top-level ones; with none, the top-level settings apply when they have a `model`. What a profile that names another provider than the top level's keeps of its provider settings is in [provider settings across layers](provider-settings-across-layers.md).
- Runs without an agent (recording answers, accepting workflows) use the top-level settings, and need no model.
- The run's log names the profile, and the spend table's model and provider columns show what each run used.

## Layers

The list is one value: a layer that sets `profiles` overrides its base's list whole, so a repository's file with `profiles` replaces the organization's list, its counts too, and `profiles: []` removes it. A profile's base is the top level, a manual run's inputs included, and its values override it: a manual run's `model` applies only to runs whose profile sets none.

A task's `/codeman set model` is for the top level's provider: it overrides the profiles on that provider, a profile on another provider keeps its own model, and where it does not fit the top level's provider, it is reported as a problem, and the run goes on without it ([the model](provider-settings-across-layers.md#the-model)). With no top-level model, it gives the top level one for that task, which then serves the task's runs that no profile serves. A task's `/codeman set gpu` applies to the runs whose provider accepts it, and is reported as a problem when none of the settings' providers does.

## Checks

- No setting is required, at the top level or in a profile, but each profile must end up with a model: one that has no `model` and inherits none stops every run with "Profile `<name>` has no `model`, and the top-level settings have none to inherit: set one in the profile." A profile that names another provider than the top level's must set its own `model`, which neither a manual run's input nor a task's command makes up for.
- The top-level settings, and each profile with what it inherits from them, must fit their providers on their own, whichever stage runs: a mistake stops the first run, with an error that names the profile. A top level without a model serves no run, so only what its provider accepts is checked, not what it requires.

## Budgets

The task and the months count every run in the ledger, whatever served it; with an organization's budget, `open-key` reads the billing of the Runpod account when a profile names a Runpod provider. A run's tasks reserve their limits at once; one refused for the month goes back to its previous state, and the others keep the profile they were picked with. See [budget](../budget/budget.md).

## Example

Planning on OpenRouter, and the other stages on Runpod pods: exactly 4 tasks on a full GPU, or up to 3 on a MIG partition of one. The top level sets no model: every stage has a profile. `src/settings.test.ts`, `src/tasks.test.ts` and `src/steps/flow.test.ts` read this example and assert what follows.

```yaml
task-budget: 2
monthly-budget: 20
profiles:
  - name: planner
    stages: [plan]
    model: deepseek/deepseek-v4.1-flash
  - name: parallel-tasks
    stages: [route, web, design, code, test, review]
    tasks: 4
    provider: runpod-pod
    gpu: "NVIDIA RTX PRO 6000 Blackwell Server Edition"
    model: qwen3-coder:30b
  - name: mig
    stages: [route, web, design, code, test, review]
    max-tasks: 3
    provider: runpod-pod
    gpu: "NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb"
    model: qwen3-coder:30b
```

- A run takes up to 4 tasks. Planning runs on OpenRouter whatever the count.
- With 4 or more tasks ready past planning, a run takes 4, on one full-GPU pod (`parallel-tasks`). With 1 to 3, it takes them all, on one MIG pod (`mig`). A planning task counts too: 1 planning task and 3 code tasks make a run of 4, whose code tasks take `parallel-tasks`.
- Without `mig`, 3 tasks ready past planning wait, each panel saying "Waiting for 4 tasks ready for profile `parallel-tasks`; 3 are."
- Without `review` in the pod profiles' stages, a task reaching review is blocked: no settings apply to the review stage.
