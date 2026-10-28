---
status: completed
created_at: 2026-10-28T19:00:00-03:00
updated_at: 2026-10-28T20:22:16-03:00
commit: 04b1e4d
---

# Configurable agent time, and a wrap-up after a timeout

## Goal

1. The time an agent run has, and the time its wrap-up has, are settings in minutes, at the top level and in profiles.
2. When the agent runs out of time, a wrap-up run leaves the working tree consistent before Codeman collects it, so `apply` commits work that makes sense.

## Context

How it works today:

- The agent's time is the `agent-minutes` input of the `agent` step: `50` in `templates/codeman-task.yml`, inside the `agent` job's static `timeout-minutes: 60` ([time limit](../runs/agent.md#time-limit)). A repository can only change it by editing its copy of the template.
- At the limit, `runAsAgent` (`src/sandbox.ts`) sends SIGTERM, then SIGKILL, to the agent's processes. The fix pass is skipped on a timeout (`src/steps/agent.ts`).
- Codeman collects the working tree as the killed agent left it. `apply` commits it and reports `out-of-time` (`src/steps/apply.ts`), so half-written edits, scratch files and test leftovers reach the task branch, and the plan's progress notes say nothing of where the run stopped.

### The two-hour reservation

`open-key` writes two records that hold until `close-key` ends them, minutes after the agent:

| Record | What it holds | Where |
| --- | --- | --- |
| [Budget reservation](../budget/budget.md#reservations) | The run's limit counts against the month's budgets while the run is open | `expiresAt` in the ledger (`src/ledger.ts`) |
| [Run lease](../inference/pods.md#leases), on a pod | A seat of the pod's capacity | `until` in the pod registry (`src/inference/registry.ts`) |

- Both use `RESERVATION_MS` (2 hours, `src/budget.ts`). It is an expiry for runs that never close, as after a cancelled job; a run that closes ends both at `close-key`.
- It keeps no pod running: a pod with no requests for a run ends itself after 30 idle minutes, and a kept pod after 15 ([self-termination](../inference/pods.md#self-termination)). After expiry, an unclosed run still counts its whole limit ([expiry](../budget/budget.md#expiry)).
- A run that outlives its reservation is the problem: its seat no longer counts, so another task may take it, and a job that sees no unexpired lease on the pod terminates the pod under the running agent.
- The value must cover the longest run: `open-key` (35 minutes at most), the `agent` job, `close-key` (10), and the waits between jobs. `src/ledger.ts` also uses it to bound which Serverless runs overlap.

### Other constraints

- **Job timeout.** GitHub expressions have no arithmetic, so the `agent` job's `timeout-minutes` must come whole from an input: `select` computes it per task, beside the other matrix values. `jobs.<job_id>.timeout-minutes` accepts `inputs` and `needs`; [contexts reference](../web/github/contexts-reference.md) does not record that row yet.
- **GitHub's job limit.** A job on GitHub-hosted runners stops after 360 minutes at most.
- **Template version.** Changing the template's jobs means `TEMPLATE_VERSION` 2 and an [upgrading](../installation/upgrading.md) entry: every installation copies the templates again.
- **Profiles change only inference today** ([profiles](../settings/profiles.md#what-a-profile-sets)). Time is closely tied to the model, its GPU and provider, so it fits there, but it widens that rule.
- **Keys.** An OpenRouter key expires 24 hours after its creation (`key-expiry-hours`), well after any run this plan allows.

## Decisions

Answered on 2026-10-28: every recommendation is accepted. Decisions 1 and 3 were revised after a first review, and decision 8 added; the revised recommendations were accepted too.

### 1. The setting's name and bounds (revised)

With decision 8, the reservation no longer limits the agent's time; GitHub's 360-minute job limit does.

| Option | Trade-off |
| --- | --- |
| A. `agent-minutes`, 5 to 300, default 50 | Same name as today's input. Leaves room under 360 for the wrap-up and the job's overhead |
| B. `agent-minutes`, 5 to 70, default 50, and the reservation stays 2 hours | No change to reservations, but the longest run is 70 minutes |

**Recommendation:** A.

**Answer:** A.

### 2. The template's `agent-minutes` input

**Answer:** remove it. The `agent` step reads the setting from the task file; the job's timeout comes from a new `agent-job-minutes` input from `select`.

### 3. The wrap-up's time (revised)

The review asked for 10 minutes, as 5 may be short for some tasks, diffs, models, GPUs and providers, and for a setting.

| Option | Trade-off |
| --- | --- |
| A. `wrap-up-minutes`, a setting at the top level and in profiles: 0 turns the wrap-up off, otherwise 2 to 30, default 10. It runs after `agent-minutes` | The agent keeps all its time; a slow model gets more wrap-up time |
| B. A fixed 10 minutes | Simpler, but no way to adapt to a slow model or to turn it off |

**Recommendation:** A. 2 is the least time the fix pass already needs (`FIX_MS`).

**Answer:** A.

### 4. A fresh session or the timed-out one

**Answer:** a fresh session, with a wrap-up prompt. It reads the task file, the plan and `git diff` itself.

### 5. Which runs get a wrap-up

**Answer:** runs whose changes are committed: planning, web, design, code, test. A review or routing run that times out keeps today's outcome.

**Revised during the work:** web, design, code and test only. A planning run that times out fails its `agent` job, and `apply` then commits nothing and blocks the task (`planUnfinished` in `src/steps/apply.ts`), so a wrap-up would change nothing there. Accepting a plan a wrap-up finished would change planning's lifecycle, which this plan does not set out to do.

### 6. What the wrap-up reports, and how `apply` shows it

**Answer:** it must report `partial` or `blocked`. `apply` keeps the `out-of-time` outcome and message, with the wrap-up's summary as the report. Another status is treated as `partial`.

During the work: `blocked` blocks the task as any stage's `blocked` does, with the wrap-up's reason. `apply` reads the output this way only when the wrap-up finished (`wrappedUp` in the manifest); without one, a timed-out run keeps today's outcome.

### 7. Recording the `timeout-minutes` row of the contexts reference

**Answer:** add that row to [contexts reference](../web/github/contexts-reference.md) from the page's source, with a new `updated_at`.

### 8. The reservation's length (new)

The review asked whether the reservation should be a setting too, and for Codeman to check that the times make sense together.

| Option | Trade-off |
| --- | --- |
| A. Derived per run: `open-key` sets the reservation and run lease to its run's longest life, `35 + agent-minutes + wrap-up-minutes + 10 (agent job overhead) + 10 (close-key) + 15 (waits between jobs)` minutes | Always fits the run, with nothing to configure or check. A run that never closes holds its pod seat for that long, not 2 hours |
| B. A setting, `reservation-minutes`, checked to be at least that sum | A value the user must understand and keep in step; any value below the sum is an error, any above only holds a dead run's seat longer |
| C. Keep 2 hours fixed (with decision 1 B) | No change, but limits the agent to 70 minutes |

**Recommendation:** A. The reservation is a safety expiry, not a cost or a choice: what it must be follows from the other times. The Serverless overlap bound in `src/ledger.ts` takes the longest reservation the settings' bounds allow.

**Answer:** A.

How the times fit, checked when the settings are read:

| Time | Value |
| --- | --- |
| The agent | `agent-minutes` |
| The wrap-up | `wrap-up-minutes`, after the agent, only after a timeout |
| The `agent` job's timeout | `agent-minutes + wrap-up-minutes + 10`, at most 340 by the settings' bounds, within GitHub's 360 |
| The reservation and run lease | The `agent` job's timeout + 60 |

## Steps

1. **The settings.** Add `agent-minutes` (default 50, 5 to 300) and `wrap-up-minutes` (default 10, 0 or 2 to 30) to `Settings`, `DEFAULTS` and the bounds in `src/settings.ts`, and let profiles set them (`PROFILE_TIMES`, beside `PROFILE_SETTINGS`, which stays the settings that go with a provider). The bounds alone keep `agent-minutes + wrap-up-minutes + 10` at 340 at most, within GitHub's 360, so no check of the sum is needed: a test pins it instead. Done: `src/settings.test.ts` covers the defaults, bounds, the longest sum, and a profile's values overriding the top level's.
2. **`select`'s output.** Each task's matrix entry carries `agent-job-minutes`: every task, so the job's `timeout-minutes` always evaluates. Done: a test of `select`'s outputs.
3. **The template.** `codeman.yml` passes `agent-job-minutes` to `codeman-task.yml`; its `agent` job takes `timeout-minutes: ${{ fromJSON(inputs.agent-job-minutes) }}` and no longer passes `agent-minutes`. Remove the input from `action.yml`. `TEMPLATE_VERSION` becomes 2. Done: `src/templates.test.ts` and `src/action.test.ts` pass.
4. **The reservation.** Replace `RESERVATION_MS` with `reservationMs`, of the `agent` job's minutes, which `open-key` takes as a new input, `agent-job-minutes`. The ledger's reservation and the pod registry's run lease use it; the Serverless overlap bound uses the largest the bounds allow; ledger records without `expiresAt` keep their 2 hours. Done: `src/steps/keys.test.ts` checks a reservation of 190 minutes for an `agent` job of 130.
5. **The agent step reads the settings.** `src/steps/agent.ts` takes `agent-minutes` and `wrap-up-minutes` from `task.settings`. Done: the stage prompt states the setting's minutes.
6. **The wrap-up prompt.** A `wrapUpPrompt` in `src/prompt.ts`: time ran out; do not start new work; read the task file, the plan and `git status`/`git diff`; revert or finish only what is half-written, remove scratch files and test leftovers that do not belong in the commit, update the plan's progress notes with what is done and what is left, and write the output with `partial` (or `blocked`). Done: `src/prompt.test.ts` covers it per stage.
7. **The wrap-up run.** In `src/steps/agent.ts`, after a timeout of a run of decision 5 that was not stopped by its budget, and with `wrap-up-minutes` above 0, run the harness once more in a new jail, fresh session, for `wrap-up-minutes`. A wrap-up that fails or times out leaves the tree as it left it; the manifest records `timedOut: true` and a new `wrappedUp` field. Done: the agent step has no unit tests (it needs `sudo` and a jail), so `src/prompt.test.ts` covers which runs get a wrap-up (`wrapUpMinutesOf`), and the e2e timeout scenario runs one.
8. **`apply`.** With `manifest.timedOut` and a valid output, report `out-of-time` with the wrap-up's summary; treat a status other than `partial` or `blocked` as `partial`. Done: `src/steps/apply.test.ts` cases.
9. **End-to-end.** Replace the scenario's repository-level `agent-minutes` (which edits the template copy) with the setting. Its least, 5 minutes, makes the timeout scenario wait 5 minutes instead of 1. The scripted model tells the wrap-up's conversation by its prompt, as it tells the fix pass. The timeout scenario's wrap-up removes a scratch file and updates the plan. Done: the suite passes.
10. **Docs.** Update [the agent](../runs/agent.md) (time limit, flowchart), [settings](../settings/reference.md), [profiles](../settings/profiles.md) (what a profile sets), [budget](../budget/budget.md) and [pods](../inference/pods.md) (the reservation's length), [comments](../tasks/comments.md) if the out-of-time message changes, [writing e2e scenarios](../development/e2e/scenarios.md), the glossary if a term is added, and an [upgrading](../installation/upgrading.md) entry for template version 2. Done: `src/docs.test.ts` passes.

## Out of scope

- `/codeman set agent-minutes` for one task. It could be added to `TASK_SETTINGS` later.
- A wrap-up after a run stopped by its budget: the key no longer pays for one.
- Self-hosted runners, whose jobs may run longer than 360 minutes: the bound holds for them too.
- Changing how the fix pass works.
