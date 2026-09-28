---
status: completed
created_at: 2026-09-28T11:00:00-03:00
updated_at: 2026-09-28T18:00:00-03:00
commit: 54cc1bb
---

# Task stages

## Goal

Split a task into five stages, each run by its own agent, one at a time: plan, design, code, test and review. Each stage agent first decides whether its stage has work to do; if not, it says why and the task moves on to the next stage.

## Context

Today a task has two agent roles: one plans, and one implements everything else. That single implementation agent designs, codes, tests and judges its own work. Separate stages give each agent one job and a focused prompt, and give each stage's output a clear place in the repository and the pull request.

Stages, as asked by the responsible person:

| Stage | Produces |
| --- | --- |
| Plan | Description, plan, technical requirements and decisions, in `docs/plans/*.md`. |
| Design | Where applicable: flowcharts in `docs/flows/*.yuml`; screen drafts or prototypes in plain HTML, in `docs/design/*.html`; images of those prototypes, in `docs/screenshots/*.png`, for the plan, issue, pull request and docs to show. |
| Code | The implementation. |
| Test | Unit tests, and integration and end-to-end tests where applicable. |
| Review | A critical review of the work, ending in `codeman:done` or in a state for a block, a decision or a failure. It also merges the default branch locally to find conflicts and integration problems early, and proposes solutions. This is not approval to merge. |

Plans move to `docs/plans/`, in target repositories and in Codeman's own repository: `AGENTS.md` changes to the new path, and the existing plans in `plans/` move there.

The loop already has what stages need: one task per run, runs chained by `next-run`, `max-runs`, and `fix` and `continue`. The task budget (`docs/plans/2026-09-28-task-budget.md`) matters more once a task takes a run per stage.

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a). Decision 3 replaces the requested yUML with Mermaid.

1. **How stages run.** Options:
   - (a) One stage per workflow run. Runs are chained as today, and the agent job is named after its stage ("Agent: design"), so the graph shows it.
   - (b) One workflow run with a job per stage.

   Recommendation: (a). A failed or blocked stage stops cleanly, the next run picks up from the task's state, and each stage gets its own key and time limit. With (b), one run holds the whole task and can take hours.
2. **Labels.** Options:
   - (a) One label per stage, in place of `codeman:in-progress`: `codeman:designing`, `codeman:coding`, `codeman:testing`, `codeman:reviewing` (planning keeps `codeman:planning`);
   - (b) keep `codeman:in-progress`, and show the stage on the status comment.

   Recommendation: (a). The issue list shows where each task is, and labels are the task's state today.
3. **Flowchart format.** yUML is a text format, but GitHub does not render it, and viewing a diagram means sending it to the yuml.me service or adding a renderer dependency. For a private repository, that sends its design outside. Mermaid is also text and GitHub renders it in Markdown. Options:
   - (a) yUML in `docs/flows/*.yuml`, as asked;
   - (b) Mermaid in `docs/flows/*.md`.

   Recommendation: (b). The diagrams show up in the pull request and the docs with no service and no dependency.
4. **Screenshots.** Options:
   - (a) The design agent renders its HTML drafts with the headless Chrome that GitHub's Ubuntu runners already have;
   - (b) add Playwright.

   Recommendation: (a). No new dependency. The images count toward `max-file-bytes`.
5. **Code and test.** Options:
   - (a) Code writes the implementation and its unit tests; test adds integration and end-to-end tests where they apply, and runs every check;
   - (b) code writes only the implementation, and test writes all the tests.

   Recommendation: (a). Code the coding agent cannot test is hard for it to get right, and the test agent still reviews coverage with fresh eyes.
6. **When the pull request opens.** Options:
   - (a) As a draft after the first code commit. Review marks it ready and the task becomes `codeman:done`.
   - (b) Only when review passes.

   Recommendation: (a). The repository's CI then runs on the pull request during test and review, and review can read its results.
7. **What review may change, and where the merge goes.** Options:
   - (a) Review changes no code. It merges the default branch in its own sandbox to find conflicts and failing checks, and writes a report with findings and proposed fixes. Nothing it did is committed. The report can send the task back to code or test (counted by `max-runs`), ask the maintainers a decision, or end it as done.
   - (b) Review may fix small problems and commit the merge with its resolutions.

   Recommendation: (a). The reviewer stays independent of the work it judges, and a human decides how to integrate with the default branch. The agent job then needs the default branch in its checkout.
8. **Decisions after planning.** Options:
   - (a) Design may raise decisions for the maintainers, like planning (for example, choosing between two prototypes), and so may review; code and test cannot, they report `blocked`;
   - (b) only planning raises decisions.

   Recommendation: (a). A design choice is cheaper to make on a prototype than on code.

## Steps

1. [x] Move plans to `docs/plans/`: in Codeman's repository (existing plans, `AGENTS.md` and references in `docs/`), and as the default plan path in target repositories. Tasks in flight keep the plan path they already have.
2. [x] Stages in the task record, the state labels (decision 2) and the selection of the next stage.
3. [x] One prompt and one output format per stage. The first thing each agent writes is whether its stage has work, with the reason when it does not.
4. [x] Design: flowcharts (decision 3), HTML drafts and screenshots (decision 4).
5. [x] Test and review (decisions 5 and 7): the default branch in the agent's checkout, the review report on the pull request, and the outcomes: done, back to code or test, decision or blocked.
6. [x] Draft pull request after the first code commit, ready at the end of review (decision 6).
7. [x] Template, docs and README.
8. [ ] Done when: on the test repository, a task that needs a screen goes through all five stages, with design skipped with a reason on a task that needs no screen.

## Outcome

Implemented on 2026-09-28. Notes:

- Flowcharts use Mermaid (decision 3), not the yUML first asked for.
- `codeman:in-progress` stays as a legacy state: tasks left in it go on in the code stage.
- Draft pull requests fall back to regular ones where the repository's plan has no drafts.
- Review posts its report as a comment on the pull request; the pull request's description gets the code and test reports.
- Stage reports and notes are cut to a few thousand characters, because the task record lives in the status comment, which GitHub limits in size.
- A task now takes at least five runs (plan, design, code, test, review), so it spends more of its budget (`docs/plans/2026-09-28-task-budget.md`) than before.

The end-to-end check is left to the responsible person's test round; if it fails, this plan reopens.

## Out of scope

- A different model or budget per stage.
- Running stages in parallel.
- Merging the pull request; a human always merges.
