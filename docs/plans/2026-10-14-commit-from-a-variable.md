---
status: pending
created_at: 2026-10-14T15:53:06-03:00
updated_at: 2026-10-14T15:53:06-03:00
commit: 362a8da
---

# Codeman's commit from a variable

## Goal

Repositories run the Codeman commit named by the `CODEMAN_COMMIT_SHA` variable (repository or organization), so moving to another version of Codeman is a variable change, not a new copy of the workflow files; and workflow files that no longer fit the code they run fail with a message that says to copy them again.

## Context

- **Today.** A repository copies `templates/codeman.yml` and `templates/codeman-task.yml` and replaces every `COMMIT_SHA` with a full commit of this repository: one `uses: codenergy-dev/codeman@COMMIT_SHA` in `codeman.yml` (`select`), five in `codeman-task.yml` (`open-key`, `agent`, `close-key`, `apply`, `release-pod`); see [setup](../installation/setup.md#5-add-the-workflow-and-settings). With a [pool of organizations](../runs/batches.md#pools), every repository of every member must be edited for each new version.
- **Third-party documentation**, recorded for this plan: `actions/checkout`'s README at the pinned commit ([checkout](../web/github/checkout-v7.md), a full copy), and the facts below added to the pages of contexts and workflow syntax.
- **No expressions in `uses`.** GitHub's table of context availability lists `with`, `env`, `run` and `if` of a step, but not `uses`, so `uses: codenergy-dev/codeman@${{ vars.X }}` is not possible ([contexts](../web/github/contexts-reference.md#context-availability)). A step may instead run an action from a path of the workspace, `./path`, once something put it there ([workflow syntax](../web/github/workflow-syntax-for-github-actions.md#jobsjob_idstepsuses)). `actions/checkout` takes `repository`, `ref` (a branch, tag or SHA), `path` (relative, under `$GITHUB_WORKSPACE`) and `persist-credentials`, and supports a second checkout nested inside the first ([checkout](../web/github/checkout-v7.md#usage)). Every GitHub App, which the job's token is, has at least read access to all public repositories ([installing a third-party App](../web/github/installing-a-github-app-from-a-third-party.md)), so checking out Codeman needs no permission a job does not already have.
- **The agent's sandbox.** The `agent` job checks out the target repository at the workspace's root. Codeman's step copies the whole workspace into the agent's home (`copyToAgent`, `src/sandbox.ts`), runs the agent there as `codeman-agent`, and collects changes with `git status` of the original `.git` against that copy, leaving out `.codeman/` (`collectChanges`, `src/collect.ts`). The workspace itself is under the runner's home, which is closed to other users before the agent starts (`createAgentUser`), so the agent never reads or writes the original checkout; what it changes in its copy reaches GitHub only through `apply`, whose change policy drops every path under `.codeman/` whatever `.codemanignore` says (`hardRule`, `src/policy.ts`). The action has no post step (`action.yml`), so no Codeman code runs after the agent in that job.
- **Variables.** A repository variable overrides an organization variable of the same name ([variables reference](../web/github/variables-reference.md#configuration-variable-precedence)). Variables are plain text, not secrets.
- **Workload Identity.** The backend's condition admits OIDC tokens whose `workflow_ref` is `codeman.yml` on the default branch ([setup](../installation/setup.md#4-set-up-the-backend)). `workflow_ref` names the workflow file, not the actions its steps use, so running Codeman from a local path changes nothing there.
- **Constraints.** No new dependency; actions pinned to a full SHA, reusing the `actions/checkout` SHA the templates already pin (v7.0.1). No job gains a permission; `agent` never gets `id-token` or the App's key. The repository is public.

## Decisions

### Answered by the responsible person on 2026-10-14

1. **Where the commit comes from.**
   - *A SHA written in each workflow file* (today): the files are the record of what runs, and a change goes through a pull request; but each version means editing every repository.
   - *A variable* (chosen): each job that runs Codeman checks it out with `actions/checkout` at `${{ vars.CODEMAN_COMMIT_SHA }}`, `repository: codenergy-dev/codeman`, `persist-credentials: false`, into a path of the workspace, and runs it with `uses: ./<path>`. The variable is required: without it, the job fails. One organization variable moves every repository; a repository variable overrides it.
   - *Not possible*: an expression in `uses`; the `$/` prefix, which resolves only to the workflow's own repository.
   - The trade-off, recorded in [security](../security/risks.md): whoever can change the variable (organization owners, or a repository's admins for a repository variable) changes the code that runs with Codeman's secrets, with no commit and no review; GitHub keeps only the audit log of that change.
2. **Validation.** Before the checkout, a step fails unless the value is a full commit SHA: 40 lowercase hexadecimal characters. A branch or tag would let the code change by itself. The value reaches the shell through `env`, never through `${{ }}` inside `run`, and the message names the variable without printing its value.
3. **Template version.** The workflow files and the code must match: the code reads inputs and the outputs of other jobs that only some copies of the templates pass. Options:
   - *An input, `template-version`, on every Codeman step* (chosen): declared in `action.yml`, so it is part of the action's documented interface; each job checks the file it comes from, whichever of the two files is old; a missing input (files copied before this plan) reads as no version.
   - *A workflow-level `env` in each file*: two lines instead of six, but undeclared, visible to every step of every job, and easy to drop when a job is moved.
   - *No version*: an old copy fails later, in whatever way the missing input makes it fail.

   The version is an integer, `TEMPLATE_VERSION` in `src/action.ts`, starting at 1. It goes up by one whenever the templates change in a way the code depends on: an input, an output, a job, a permission, a secret or a step the code needs and older copies lack, or a change older code cannot run with. Comments and changes the code does not depend on keep it. Every Codeman step checks it first, before its own inputs, and on a mismatch fails with a message that says to copy both templates from the commit in `CODEMAN_COMMIT_SHA`, with a link to `templates/` at that commit (the commit is read from the checkout's `.git/HEAD`). A test checks that every Codeman step of both templates passes `template-version: <TEMPLATE_VERSION>`, so a version bump without the templates, or the templates without the bump of a value they carry, fails. Whether a change to the templates needs a bump stays a reviewer's call, written in the [development guide](../development/guide.md).
4. **Where the checkout goes.** `actions/checkout` places a repository only under `$GITHUB_WORKSPACE`, and `./path` resolves against it, so moving the checkout to `$RUNNER_TEMP` would need a step that moves it back under the workspace anyway. In the `agent` job the workspace is the target's checkout, so Codeman's checkout sits inside it. Chosen: `.codeman/action`.
   - The agent never sees the original: the workspace is in the runner's home, closed to it. Codeman's step also leaves the action's folder out of the agent's copy (wherever the template puts it, computed from the action's own path), so the agent does not read Codeman's sources as if they were the repository's, and nothing it writes there is collected.
   - Two existing layers already keep `.codeman/` off the task branch: `collectChanges` leaves it out, and `apply` drops any path under it. A folder at the top level (such as `.codeman-action`) would need new rules in both.
   - The checkout comes after the target's checkout, which would otherwise delete it (it cleans the workspace), and nothing of Codeman runs after the agent in that job (no post step).
5. **Workload Identity.** Unaffected (see Context): no change to the provider's condition.

## Steps

1. **The action.** `src/action.ts`: `TEMPLATE_VERSION`, the action's root and commit, the version check and its message, and the action's folder inside a workspace. `run` (`src/main.ts`) checks the version before any step. `action.yml` declares `template-version`. The `agent` step leaves the action's folder out of the agent's copy and of the collected changes. *Done when* tests cover a match, a missing version, an older and a newer one, and the folder's path inside and outside the workspace, and the sandbox test (Linux, CI) checks that an excluded path is not copied.
2. **The templates.** In each of the six jobs that run Codeman: a step that checks `CODEMAN_COMMIT_SHA`, then `actions/checkout` of `codenergy-dev/codeman` at it into `.codeman/action`, then `uses: ./.codeman/action` with `template-version`; in `agent`, both after the target's checkout. No `COMMIT_SHA` remains. *Done when* `src/templates.test.ts` checks, for every Codeman step, a validated checkout at `vars.CODEMAN_COMMIT_SHA` in the same job before it, at the path it uses, with `persist-credentials: false` and the pinned SHA; that no `codenergy-dev/codeman@` or `COMMIT_SHA` remains; that the value reaches the check through `env`; that the permissions are unchanged; and that every step passes `TEMPLATE_VERSION`.
3. **Docs.** [Setup](../installation/setup.md) (set `CODEMAN_COMMIT_SHA`; nothing to replace in the templates; when to copy them again), [upgrading](../installation/upgrading.md), [security](../security/risks.md) and [secrets](../security/secrets.md) (the trade-off), [the agent](../runs/agent.md) (the action's folder and the sandbox), [development](../development/guide.md) (bumping the template version), [dependencies](../development/dependencies.md), and the [index](../README.md). *Done when* every page that said to replace `COMMIT_SHA` or pin a SHA in the files says what to do now, and `src/docs.test.ts` passes.
4. **Build and check.** `npm run build` and `npm run check` pass; `dist/gateway.js` does not change. *Done when* both pass and the working tree is clean.

## End-to-end test

On a test repository with Codeman installed, the backend's variables set, and an issue labeled `codeman`:

1. **Set the variable.** Set `CODEMAN_COMMIT_SHA` (organization or repository) to the commit that completes this plan, copy both templates from it, and run the workflow by hand. Expect: every job that runs Codeman shows the check, then `actions/checkout` of `codenergy-dev/codeman` at that commit (with each job's own permissions: `select`, `open-key`, `close-key` and `release-pod` have `id-token: write` only, `apply` none, `agent` contents and actions read), then Codeman's step; the run behaves as before.
2. **A wrong value fails.** Set the variable to `main`, then delete it. Expect: each run fails at the check of its first job (`select`), with the message that names `CODEMAN_COMMIT_SHA`, and nothing is checked out. Set it back.
3. **A template-version mismatch fails.** In the test repository's `codeman-task.yml`, change the `apply` job's `template-version` to `0`, and run on a task that only records answers. Expect: `apply` fails with the message that says to copy both templates from the commit in `CODEMAN_COMMIT_SHA`, with the link to `templates/` at that commit, before it writes anything; `select` ran as usual. Restore the file.
4. **The agent cannot see or alter the action.** Open a task whose description asks the agent to list `.codeman/action` and `$GITHUB_WORKSPACE/.codeman/action`, and to write a file in each. Expect: the first does not exist in its copy (a file it writes there is not collected, and `apply` would drop it anyway), the second cannot be read (permission denied); the task branch gains no file under `.codeman/`.
5. **The backend still admits the jobs.** Expect `select`, `open-key`, `close-key` and `release-pod` to record the run in Firestore as before: the Workload Identity condition is unchanged.

## Out of scope

- Checking that the commit is on Codeman's `main` branch. GitHub serves commits of a fork of `codenergy-dev/codeman` under its name too, as it does for `uses: owner/repo@<sha>`; the docs say to take the SHA from `main`.
- Telling, in code, which template changes need a version bump: a reviewer decides, guided by [development](../development/guide.md).
- A default commit when the variable is unset.
- Changing the `dispatch`, `forward-review` and `next-run` jobs, which run no Codeman step.
