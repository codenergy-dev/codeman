---
status: in progress
created_at: 2026-10-23T12:28:00-03:00
updated_at: 2026-10-23T14:28:00-03:00
commit: 03a30f1
---

# Accept only the listed workflows

## Goal

`/codeman accept-workflows` moves a staged workflow only if its content is the one Codeman listed for the maintainer to read. A change pushed after the listing is refused, whatever its commit's date.

## Context

- **The bug.** The e2e suite found it ([5.5 results](2026-10-20-end-to-end-test-suite.md#55-results)). `acceptWorkflows` (`src/steps/apply.ts`) finds what the maintainer saw with `commitAt(branch, accept.createdAt)`, GitHub's `GET /commits?until=`, which filters by commit date ([commits](../web/github/rest-api-endpoints-for-commits.md)). Whoever makes a commit chooses its date, and dates count in whole seconds. So a push after the comment, dated before it, is moved. [Accepting](../runs/changes.md#accepting) says it must be refused with "The staged workflows changed after they were accepted." `security/workflow-accept-backdated` reproduces it, tagged `known-bug`.
- **Where the staged workflows are listed.** Every run that applies a stage or an accept lists them in the status comment, under "Workflows to review" (`finish` in `src/steps/apply.ts`). Review's pass also names them in its run comment, as read from the commit review ran on (`reviewPassed`).
- **Where the task record lives.** In the status comment's hidden block on the issue ([the task record](../tasks/comments.md#the-task-record)), not in Firestore. `select` rewrites the panel with the record as it is, so a field `apply` adds is kept. Older records lack the field.
- **Trust.** Only someone who can push to the task branch can do this, and that person can already push workflows ([who can read them](../security/overview.md#who-can-read-codemans-secrets)). So it breaks a documented check, not a trust boundary.

## Decisions

### Answered by the responsible person on 2026-10-23

1. When the review lists the staged workflows for acceptance, Codeman records each staged file's blob SHA in the task's record.
2. `accept-workflows` moves only the files whose current blob SHA matches the recorded one. If any differs, it refuses with the documented message.
3. The decision is independent of dates: an earlier commit with the same content stays acceptable.

### Choices made in this work

1. **Each listing records.** Every run that lists the staged workflows in the status comment records their blobs, from the same read: review's pass, but also a code stage's run, a blocked stage, and a refused accept. Otherwise a blocked task's accept ([accepting](../runs/changes.md#accepting)) and the documented "read them again and comment again" after a refusal could never move anything.
2. **Review's listing is what review read.** Review's pass lists, and records, the staged files of the commit review ran on, not the branch when `apply` ends. A push during review is then refused at the accept.
3. **What counts as changed.** A file whose blob differs, a staged file that was not listed, and a listed file that is gone. Each refuses the whole accept, naming the files.
4. **The record's field.** `staged`: each staged file's path under `.codeman/workflows/`, with its blob SHA. Runs that list nothing keep it as it is; a replan keeps it too, since the files stay on the branch.
5. **An older record**, without `staged`: the accept refuses, saying Codeman has no record of the versions it listed, and asks the maintainer to read them again and comment again. The refusal's run lists and records them, so the next accept can move them. This is the safe choice: no fallback to dates.
6. **`commitAt` goes.** Nothing else uses it: it leaves the `Platform` interface, the GitHub adapter and `FakePlatform`.

## Steps

1. **Failing tests.** In `src/steps/flow.test.ts`, on `FakePlatform`, a task whose review passed with a staged workflow:
   - an accept of the listed files moves them;
   - a change pushed after the accept, dated before it, is refused with the message, and moves nothing;
   - an accept after a push of an earlier commit with the listed content moves it;
   - an older record without `staged` refuses, and the next accept moves the files.

   Done when the second and fourth fail on `HEAD`.
   - **Done on 2026-10-23.** On `HEAD`, all four fail: the first only on the record's `staged`, which does not exist; the second and fourth move the files ("Workflows accepted"); the third refuses, since `commitAt` finds the version before the comment.
2. **The fix.** `finish` records `staged`; `reviewPassed` hands it review's read; `acceptWorkflows` compares blobs; `commitAt` removed; the messages in both catalogs. Done when the tests pass and `npm run build` rebuilds `dist/`.
   - **Done on 2026-10-23.** `finish` takes an optional `staged` read, which `reviewPassed` hands it; the detail message no longer names the comment's author, since a change before the comment is refused too; the old record's message is `stagedUnrecorded`. Only `dist/index.js` changed.
3. **Docs.** [Accepting](../runs/changes.md#accepting) says what is compared; [the task record](../tasks/comments.md#the-task-record) names the field; [data layout](../backend/data-layout.md) points to where the task record lives; [upgrading](../installation/upgrading.md#tasks-from-older-versions) gets the older record's row. Done when `npm run check` passes.
   - **Done on 2026-10-23.** [Accepting](../runs/changes.md#accepting) gets a table of what the accept compares, and [staging](../runs/changes.md#staging) says each listing records. `npm run check` passes: 911 tests, 5 skipped.
4. **The e2e scenario.** `security/workflow-accept-backdated` loses its `known-bug` tag and expects the refusal. Done when `node --test "e2e/runtime/scenario/*.test.ts"` validates it, and later when it and `security/workflow-staged` pass three times in a row (Docker is busy now).
   - **Validated on 2026-10-23**; the runs wait for Docker. The scenario's steps are unchanged: its refusal and second accept now hold.
5. **The e2e plan.** Its 5.5 results say the bug is fixed, linking here. Then this plan is `completed`.

## Out of scope

- **A branch that moves during the accept's commit.** It still fails without a run comment, as the [moved-branch plan](2026-10-23-commit-on-a-moved-task-branch.md#out-of-scope) leaves it.
- **Tying the accept to one comment's view.** Codeman cannot know what the maintainer read; it guarantees that what moves is what it listed before the comment.
