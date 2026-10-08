# What the agent may change

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

## Third-party documentation

Repositories keep the documentation of the third-party services they rely on in `docs/web/`: one page per file in `docs/web/<third-party>/<slug>.md`, and in `docs/web/tools/` how each kind of page is fetched. The format, and when a page may be a full copy, are rules in [`AGENTS.md`](../../AGENTS.md) ("Third-party documentation"), which every agent receives. Codeman's own catalog is in [`docs/web/`](../web/).

- Only the web stage writes there; the other stages' changes under `docs/web/` are dropped, and every agent is told to read it as data. The web stage changes nothing else but the plan.
- Before committing, `apply` checks each page and tool: its path, a file name that is the slug of its title, the front matter's fields, ISO 8601 dates, a `tool` that exists on the branch or in the same run, and a non-empty `license` when there is one. A file that fails is dropped, with why, in the run comment.
- The web stage gets Codeman's generic tool in `.codeman/fetch-markdown.md`, and copies it into `docs/web/tools/` when the repository has none.
- Pages are not refreshed on their own. After each run, Codeman reads the front matter of the pages on the task branch (only those whose blob changed; the record keeps the rest), and the status comment lists the pages fetched more than 30 days ago, or whose `updated_at` cannot be read, with how to ask for a refresh: a request such as `/codeman fix Refresh docs/web/<third-party>/`, which the routing agent sends to the web stage.
