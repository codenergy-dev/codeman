---
status: pending
created_at: 2026-10-08T17:38:51-03:00
updated_at: 2026-10-08T17:38:51-03:00
commit: 3d6a0f9
---

# Every agent run is a stage

## Goal

The docs, the messages, the prompts and the code call every agent run a stage: seven of them, `plan`, `route`, `web`, `design`, `code`, `test` and `review`. "Routed stages" names the five the route chooses among, only where the distinction matters. Nothing Codeman does, stores or emits changes.

## Context

- **Today.** The docs and the code call only five agent runs stages (`web`, `design`, `code`, `test`, `review`; `STAGES` in `src/stages.ts`). Planning (`plan`) and routing (`route`) are described as something else, although each runs an agent in a run of its own, like a stage. A profile's `when.stages` condition already takes all seven (`PROFILE_STAGES` in `src/settings.ts`), the select job's `stage` output already names them, and the spend table's "Stage" column already shows planning and routing.
- **The confusion.** The responsible person found it confusing while reading the docs to learn the tool: a condition named `stages` takes values that the docs say are not stages. Commit `3d6a0f9` added a section "Agent runs" to [stages](../tasks/stages.md) listing the seven and which are stages; it documents the distinction instead of removing it.
- **Constraints.** No behavior change. Task records, ledger documents, the action's outputs and the labels must read and write exactly as today.

## Decisions

1. **The vocabulary.** Options:
   - (a) Keep the distinction, and only document it: the previous fix (`3d6a0f9`).
   - (b) Unify: a stage is every agent run, seven in all; "routed stages" are the five the route chooses among (review always last), named so only where the distinction matters, such as what the route chooses, what `max-runs` counts and the router's output.
   - (c) Rename the `when.stages` condition (for example to `runs`), and keep "stages" for the five.

   Recommendation: (b): it matches the condition, the `stage` output and the spend table, which already treat planning and routing as stages, and changes no setting; (c) changes a public setting for a word.

   **Answer (the responsible person, 2026-10-08):** (b). The `when.stages` condition keeps its name and values. The state labels (`codeman:planning`, `codeman:routing` and the routed stages' labels) stay as they are: they are task states, not stage names. In the code, `STAGES` becomes the seven (replacing `PROFILE_STAGES`) and the five become `ROUTED_STAGES`, so the code uses the docs' words; types and helpers are renamed where it clarifies, without changing data formats.

### Choices made while writing the plan

2. **The stages page presents all seven.** The section "Agent runs" becomes the stages table itself, at the top of [stages](../tasks/stages.md): each stage's name, whether it is routed, and what it does. Planning moves there from [task lifecycle](../tasks/lifecycle.md), next to routing, so one page describes every stage; the lifecycle page keeps the states and their labels, and links to it. The anchor `#agent-runs` goes away: the two pages that link to it ([profiles](../settings/profiles.md), [installation's profiles](../installation/profiles.md)) link to the table instead. Nothing else links to `lifecycle.md#planning` but the stages page.
3. **Names in the code.** `src/stages.ts`: `ROUTED_STAGES` and `RoutedStage` for the five, `STAGES` and `Stage` for the seven; `STAGE_STATE`, `stageOfState` and `isStage`, which are about the five only, become `ROUTED_STAGE_STATE`, `routedStageOfState` and `isRoutedStage`. `nextStage`, `nextInRoute` and `stagesFrom` keep their names: they are about a route's order, and their types say they take routed stages. The unions `Stage | "plan" | "route"` (`src/spend.ts`, `src/i18n/messages.ts`) become `Stage`. The values stay the same strings, so records, ledger documents and outputs do not change.
4. **Messages.** The English and Portuguese messages already call routed stages "stages" ("etapas") where the route chooses them, which stays true; only wording that sets planning or routing apart from the stages changes. Portuguese keeps "etapa" for a stage, and "etapas roteadas" where the five are meant. Settings errors stay in English.
5. **Prompts.** Only wording that sets planning or routing apart from the stages, or lists the stages wrongly, changes. What each agent is asked to do and its output contract (`output.json`'s fields and values) stay as they are.

## Steps

1. Write this plan. Done when it is committed with status `pending`, then set `in progress`.
2. Code: `src/stages.ts` with the names of choice 3; `src/settings.ts` uses `STAGES` and `Stage` for the condition; the other modules and the tests follow. The router's output errors (`src/output.ts`) name the routed stages. Done when `npm run typecheck` and `npm test` pass, with no test's expected stored or emitted value changed.
3. Messages and prompts: `src/i18n/en.ts`, `src/i18n/pt-BR.ts` and `src/prompt.ts` per choices 4 and 5, with their tests. Done when no message or prompt sets planning or routing apart from the stages, and the tests pass.
4. Docs: the stages page per choice 2; every page that sets planning or routing apart from the stages, or uses "stages" for the five where the distinction matters (`git grep -n -i stage` over `docs/` except `docs/plans/` and `docs/web/`, `README.md`, `AGENTS.md`, `templates/` and `action.yml`); `docs/README.md`'s lines. Done when that grep shows no such use and the docs link checker passes.
5. Rebuild `dist/` and run `npm run check`. Done when it passes, the working tree is clean, and whether `dist/gateway.js` changed is recorded.

## End-to-end check

By the responsible person; it costs nothing.

1. **Reading the docs.** Read [stages](../tasks/stages.md) from the top: the table lists the seven stages, their names and which are routed; planning, routing, running a routed stage and feedback follow. [Profiles](../settings/profiles.md) and [installation's profiles](../installation/profiles.md) say the `stages` condition takes any stage, with no "are not stages" aside.
2. **A profile for planning and routing.** On the test repository, `.codeman/settings.yml` with a profile `when: {stages: [plan, route]}` is accepted as before; `stages: [deploy]` fails with an error that lists the seven stages. Both show in the first run's `select` step; the first does not need to go further.
3. **Nothing else changes.** On a task in progress, the labels, the status and run comments' titles and the spend table's "Stage" column read as before.

## Out of scope

- The state labels, which are task states.
- The name and values of the `when.stages` condition.
- Data formats: task records, ledger documents, the action's outputs and inputs, and `output.json`.
- Completed plans, which are history and keep their wording.
