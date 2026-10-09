---
status: in progress
created_at: 2026-10-08T22:54:33-03:00
updated_at: 2026-10-08T22:56:38-03:00
commit: aa3022d
---

# Profiles pick the tasks

## Goal

Profiles decide how many tasks a run works on at once, through conditions written at the profile's first level (`stages`, `tasks`, `min-tasks`, `max-tasks`), and no top-level setting is required. A task that its settings can serve only with more tasks than are ready waits, and says so; a task that no settings serve at all is blocked, and says why.

## Context

- **Today.** `parallel-tasks` is a top-level setting (default 1, up to 10) that caps how many tasks one run picks (`chooseTasks` in `src/tasks.ts`, called from `src/steps/select.ts`). A profile's conditions sit under `when`: `stages`, and `parallel-tasks: N`, which holds when at least N of the run's tasks run an agent. `model` is required at the top level ("No model is configured", `resolveRun` in `src/settings.ts`), even when profiles serve every stage.
- **The problem.** The responsible person's test repository plans on OpenRouter and runs the other stages on Runpod pods: one profile for exactly 4 tasks on a full GPU, one for up to 3 on a MIG partition. With today's settings it needs a top-level model that no run should use, a top-level `parallel-tasks` that must agree with the profiles' counts, and a count condition that can only say "at least". The count belongs to the profiles: a full GPU pays off only with enough tasks on it.
- **Constraints.** The settings file stays the same strict YAML subset (`src/yaml.ts`). Older task records and ledger documents must stay readable; no data format changes beyond what these settings need. The workflow's matrix already comes from `select`'s `tasks` output, so its size follows whatever `select` picks. No new dependency.

## Decisions

Answered by the responsible person on 2026-10-08.

1. **Is the top level required?** Options: (a) keep `model` required at the top level; (b) make every top-level setting optional: the top level is the default, which applies when no profile does, and the base the profiles inherit.

   **Answer:** (b). No top-level setting is required, `model` included. A profile still needs its own `model` when it inherits none, and the existing rule stays: a profile that names another provider than the one it inherits sets its own `model`. Runs without an agent (recording answers, accepting workflows) need no model.

2. **Where conditions go.** Options: (a) keep them under `when`; (b) write them at the profile's first level, beside `name`.

   **Answer:** (b). A profile has `name`, the conditions `stages`, `tasks`, `min-tasks` and `max-tasks`, and its provider settings. `tasks` (an exact count) goes alone; `min-tasks` and `max-tasks` go together or apart (a range). No `stages` is every stage; no count condition is any count. Conditions at the top level are an error: only profiles have conditions. `when:`, and the old `parallel-tasks` condition in a profile, become errors that say what to write instead, as the repository does for other renamed settings. The top-level `parallel-tasks` setting is removed: writing it is an error that says to use `tasks`, `min-tasks` or `max-tasks` in profiles.

3. **How many tasks a run picks.** Options: (a) keep a `parallel-tasks` setting that caps the run, beside the profiles' conditions; (b) take the count from the profiles.

   **Answer:** (b). The run's cap is the largest count named by any `tasks` or `max-tasks`; a `min-tasks` without `max-tasks` allows up to Codeman's cap of 10; with no count condition anywhere, one task at a time, as today: parallelism only when a profile asks for it. The run takes the largest n for which the first n ready tasks, in today's priority order (recording answers and accepting workflows still come first, and do not count as agent tasks), each have a profile, or the top level, that applies to their stage with n tasks. A task served only at a larger count than there are ready tasks **waits**; its status comment says why, such as "Waiting for 4 tasks ready for profile `parallel-tasks`; 3 are." (English and Portuguese).

4. **Error or wait.** Options: (a) a task that its settings cannot serve waits, whatever the reason; (b) it waits only when some count would serve it, and is blocked when none would.

   **Answer:** (b). When neither any profile nor the top level serves a task's stage at any count, that configuration can never run it: the task becomes `codeman:blocked`, with a message that names the stage and says no settings apply to it; the maintainer fixes the settings and comments `/codeman continue`. When some profile serves the stage at another count, the task waits (decision 3).

### Choices made while writing the plan

Settled conservatively, as the responsible person asked.

5. **What "the top level serves" means.** The top level serves an agent run only when it has a `model`, from any layer: the organization's settings, the repository's file, a manual run's input, or the task's `/codeman set model` (choice 13). Without one it serves no stage, at any count, since it cannot name the model; it still gives the budgets, the limits and the provider settings the profiles inherit, and the settings of runs without an agent.
6. **Checking a top level without a model.** It is checked for what its provider accepts (a setting the provider does not take, a value it does not offer), but not for the provider's required settings nor the model, since it serves no run; each profile is checked whole, with what it inherits, as today. A profile that has no `model` and inherits none stops every run with "Profile `<name>` has no `model`, and the top-level settings have none to inherit: set one in the profile."
7. **The run's count is every agent task of the run.** n counts the run's tasks that run an agent, whatever their stage and profile, as the old `parallel-tasks` condition did. Tasks of one run in different stages each take the first profile that applies to their own stage with n tasks, or the top level. So in a run of 4 with one planning task and three code tasks, the code tasks take a `tasks: 4` profile. A count per profile (how many of the run's tasks use it) would be another rule, and is left out.
8. **"The first n ready tasks".** Read as: the first n, in priority order, of the ready tasks that some profile or the top level serves with n tasks. A task that nothing serves with n is passed over for that n rather than stopping the count there, so a task that waits does not hold back the tasks behind it, such as a planning task behind a code task that waits for 4. Among the counts from the cap down to 1, the run takes the largest for which there are that many such tasks.
9. **Runs without an agent.** Recording answers and accepting workflows come first and take places of the run's cap, as today, and do not count in n. So with no count condition (cap 1), a run with answers to record does only that, as today, and next-run chains another run.
10. **Who waits, and what it says.** A task waits when every count that serves it needs more tasks than there are ready tasks that the same count serves (itself included). Its panel names the smallest such count, the profile that serves it there, and how many such tasks are ready. Its labels do not change. Tasks that some count would serve now, but that this run did not take (its places were full, or it chose another count), are left for a later run with no message: the run moves tasks, so next-run starts another. A waiting task's panel is written only when its message changes, so runs that find it still waiting leave it alone; its footer shows the model the waiting profile would use.
11. **Blocking in `select`.** A task whose stage nothing serves at any count is labeled `codeman:blocked` by `select`, with its panel saying why; `select` writes no run comment. The commands and reviews it saw are marked handled in the task's record, as `apply` does whatever a run's outcome, so the same `/codeman continue` does not resume it again; the task's state, stage and plan are kept. How to go on, as for other blocked runs: `/codeman continue` for a task with a plan (the message says to fix the settings first); for a task that has no record yet (it was never planned), removing the `codeman:blocked` label, since `continue` needs a record, as for other tasks blocked before their plan.
12. **Re-checking waiting tasks.** Every run's `select` re-checks them: comments, reviews, the schedule, manual runs and next-run. A waiting task moves nothing, so it never makes next-run start another run; a run whose tasks all wait or are blocked outputs `action: none`, so no `task` or `next-run` job runs.
13. **A task's `/codeman set model` with no top-level model.** It stays what it is: a model for the top level's provider. So it gives the top level a model for that task, and the top level then serves the task's runs that no profile serves, as a task's model filled a missing model before. It must fit the top level's provider; where it does not, it is reported as a problem and left out, as today. It changes no profile's counts.
14. **Budgets.** `select` picks without reading budgets. The picked tasks' `open-key` jobs reserve their limits at once, in no set order, as today; a task refused for the month goes back to its previous state, and the others keep the profile chosen with n, so a pod may serve fewer tasks than its profile's count in that run.
15. **The organization's settings.** The same rules apply to `CODEMAN_SETTINGS`: no setting required there, the old names and conditions at its top level are errors. The run's cap comes from the list of profiles the repository uses: the file's, else the organization's (the list is one value, as today).
16. **`select`'s log.** A line for the run: "Picked 3 task(s), of up to 4: #1 (record), #2 (plan), #3 (implement); 2 run an agent." A line per waiting task: "#5 <title>: waits for 4 tasks ready for profile `parallel-tasks`; 3 are." A line per blocked task: "#6 <title>: no settings apply to the code stage at any count; blocked." The layer and profile lines of each picked task stay.
17. **Data formats.** Task records and ledger documents do not change. `Settings` loses `parallel-tasks`, which no stored data holds (the per-run `task.json` is written and read by the same version). A run without an agent and without any model has `model: ""` in its context; the panel's and run comment's footers leave the model out then; the ledger stores a model only for agent runs, as today.
18. **Workflow files.** The matrix is already built from `select`'s `tasks` output, so no workflow input or job changes; only the comments of `templates/codeman.yml` and the `tasks` output's description in `action.yml` that name `parallel-tasks` change. Workflow files copied before this plan keep working.

## Steps

1. Write this plan. Done when it is committed with status `pending`, then set `in progress`.
   - **Done on 2026-10-08**: committed as `5435748` with status `pending`, then set `in progress`.
2. Settings (`src/settings.ts`): profile conditions at the first level, with their validation and the errors of decision 2; the top level optional (choices 5, 6 and 13); the run's cap (`tasksPerRun`) and which counts serve a stage; `parallel-tasks` removed from `Settings`. Done when `src/settings.test.ts` covers each rule and error, including the responsible person's example as a fixture, and `npm run typecheck` passes.
3. Picking (`src/tasks.ts`, `src/steps/select.ts`, `src/status.ts`, `src/i18n/`): the picker of decision 3 and choices 7 to 10, the waiting panel, the blocked panel (choice 11), the log lines (choice 16), footers without a model, English and Portuguese messages. Done when unit tests of the picker and flow tests through `select` cover: one task at a time without count conditions; a run of exactly 4; a run of up to 3 when 3 are ready; a task that waits, with its panel, written once; a task blocked with its panel and handled commands; answers recorded first; a waiting task leaves `action: none`; a top level without a model.
4. Templates and action: `templates/settings.yml` (conditions at the first level, no `parallel-tasks`, `model` optional), `templates/codeman.yml`'s and `action.yml`'s wording. Done when the template test reads the template and its uncommented profiles, and no template or `action.yml` names `parallel-tasks` as a setting.
5. Docs: [settings](../settings/reference.md), [profiles](../settings/profiles.md), [provider settings across layers](../settings/provider-settings-across-layers.md) (examples without `when`, still asserted by the tests), [stages](../tasks/stages.md), [task lifecycle](../tasks/lifecycle.md) (the blocked and waiting tasks), [installation's profiles](../installation/profiles.md), [setup](../installation/setup.md), [upgrading](../installation/upgrading.md) (old → new), [runs and jobs](../runs/runs-and-jobs.md), [budget](../budget/budget.md), [Serverless](../inference/serverless.md) and `docs/README.md`. Done when `git grep -n "parallel-tasks\|when:"` over `docs/` (except `docs/plans/` and `docs/web/`), `README.md`, `templates/` and `action.yml` shows only the upgrading page's old names, and the docs link checker passes.
6. Rebuild `dist/` and run `npm run check`. Done when it passes, the working tree is clean, and whether `dist/gateway.js` changed is recorded.

## End-to-end test

By the responsible person, on the test repository, with Codeman installed from the plan's last commit. Costs are estimates; check Runpod's current prices.

1. **Old settings stop the run, at no cost.** Keep today's `.codeman/settings.yml` (with `when:` and `parallel-tasks`) and comment `/codeman continue` on any task. `select` fails before marking any task, with "`when` is gone: …" naming its line. Remove `when:` and keep the top-level `parallel-tasks`: it fails with "`parallel-tasks` is no longer a setting: …". Cost: none.
2. **The new settings.** Write the example of [profiles](../settings/profiles.md#example) (planning on OpenRouter, a profile `parallel-tasks` with `tasks: 4` on the full GPU, a profile `mig` with `max-tasks: 3` on the MIG partition, no top-level `model`). Cost: none.
3. **Up to 3 on the MIG partition.** With 2 or 3 tasks past planning (in `codeman:ready` or a routed stage), and no other ready task, start a run. `select`'s log says "Picked 3 task(s), of up to 4"; each picked task's log names profile `mig`; one MIG pod serves them all (shared pods). Cost: one routing or stage run per task on the MIG partition, about 10 to 20 minutes of the pod, under US$ 0.50.
4. **Exactly 4 on the full GPU.** With 4 or more such tasks ready, start a run. It picks 4, each with profile `parallel-tasks`, on one full-GPU pod. Cost: about 15 to 30 minutes of the full GPU, around US$ 1 to 2 with the 96 GB card used before.
5. **Tasks that wait.** Remove the `mig` profile, and have exactly 3 tasks ready past planning, and none to plan. Each one's panel says "Waiting for 4 tasks ready for profile `parallel-tasks`; 3 are.", their labels do not change, the run outputs `action: none`, and no next run starts. Comment `/codeman continue` on one of them: the next run leaves the panels as they are. Put `mig` back. Cost: none, since nothing runs.
6. **A stage nothing serves.** Remove `review` from both pod profiles' `stages`. A task reaching review becomes `codeman:blocked`, and its panel says no settings apply to the review stage. Put `review` back and comment `/codeman continue`: the task reviews on its pod. Cost: one review run, as in step 3 or 4.
7. **Planning is unchanged.** A new task plans on OpenRouter with the planner's model, with the other tasks, whatever their count. Cost: a planning run, a few cents.

## Out of scope

- Ollama's settings on pods (context length, parallel requests per pod): a separate plan.
- Serverless concurrency: how many requests an endpoint's workers take at once.
- A count per profile (how many of the run's tasks use each profile), rather than the run's count (choice 7).
- Reading budgets in `select` to pick tasks that fit them.
