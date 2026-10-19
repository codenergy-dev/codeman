# Commands

[Maintainers](../glossary.md#maintainer) steer a [task](../glossary.md#task) with comments on its issue or on its pull request, and with review texts. This page gives the commands, when each one counts, and what it does.

## Syntax

- Each line that starts with `/codeman`, outside a fenced code block, is a command. One comment may hold several.
- The command's name is case-insensitive.
- Decision numbers have one or two digits, and options are one letter.
- The free text of `answer`, `replan`, `fix` and `continue` may have at most 2,000 characters. A longer one makes the command invalid.
- `approve` takes nothing after it on its line, and `decide` only decision numbers and options: other text there makes the command invalid.
- Text on the lines after `approve` or `decide` is not part of the command. The agent sees it later as a maintainer comment, but it is not recorded as an answer. Use `answer` or `replan` when the text matters.

## Which comments count

- Only new comments count. `issue_comment` starts a run only when a comment is created, so editing one starts no run. A comment already handled is never read again.
- In a review, only its text is read, and only `fix`, `continue` and `replan` count there. Its line comments are never read as commands.
- Only comments from maintainers count, both for commands and for the text the agent sees. Only issues they opened are tasks.

## Who may use them

A maintainer is a user with `admin`, `maintain` or `write` access to the repository. Codeman reads it from `GET /repos/{owner}/{repo}/collaborators/{user}/permission`. See [untrusted input](../security/risks.md#untrusted-input).

> [!NOTE]
> The `author_association` field is not used: GitHub computes it for the reader, and an App token sees private organization members as `CONTRIBUTOR`.

## Commands

| Command | Counts when the task is | Effect |
| --- | --- | --- |
| `/codeman decide 1 a` | `codeman:awaiting-decision` or `codeman:ready` | Answers decision 1 with option `a`. Several at once: `/codeman decide 1 a 2 b`. `1=a` also works. |
| `/codeman approve` | `codeman:awaiting-decision` or `codeman:ready` | Accepts the recommendation for every unanswered decision. |
| `/codeman answer 2 <text>` | `codeman:awaiting-decision` or `codeman:ready` | Answers decision 2 in the maintainer's own words instead of an option. The text continues on the following lines, up to the next command. |
| `/codeman replan <text>` | Any state, once the task has a plan | Sends the task back to planning. The agent revises the plan with the text (which may continue on the following lines), the maintainer comments and the answers given so far. Answered decisions are written into the plan as settled, and only open or new decisions are listed. |
| `/codeman fix <text>` | `codeman:ready` and every later state, `codeman:done` included | Asks for changes to the implementation. A review that requests changes does the same. See [feedback](stages.md#feedback). |
| `/codeman continue <text>` | `codeman:ready` and every later state, `codeman:done` included | Resumes a blocked or unfinished task with a new run count. The text is optional guidance for the agent. On a `codeman:done` task, it runs the code stage again, without routing; `fix` routes. |
| `/codeman accept-workflows` | Any state, once the task has a plan | Moves the workflows the agent staged under `.codeman/workflows/` into `.github/workflows/`, after a maintainer has read them. With nothing staged, the run only says so. See [on-demand workflows](../runs/changes.md#on-demand-workflows). |
| `/codeman set <name> <value>` | Any state | Changes `model`, `task-budget`, `max-runs`, `language` or `gpu` for this task from now on. The last valid one wins. |
| `/codeman model <id>` | Any state | Short for `/codeman set model <id>`. |

- A task that was never planned ignores `replan` and `accept-workflows`. One that is `new` or `codeman:planning` plans anyway.
- Answers are recorded in the [status comment](../glossary.md#status-comment) and in an `## Answers` section of the plan. When no decision is pending, the task becomes `codeman:ready`.

> [!IMPORTANT]
> A `fix` or `continue` posted while the task is `codeman:awaiting-decision` is not applied: the run that records the answers marks the comment handled, and its run comment says so. Post it again once the task is ready. A review that requests changes is kept: it waits until the task is ready.

## When several commands arrive

Among the commands a run finds new, `replan` wins: the run plans again instead of only recording answers. Then come `fix` and `continue`, which resume the work in the states they count in, then answers.

## Settings in the description

The issue's description may also hold `set` and `model` lines, to choose settings when opening the issue.

- Comments come after the description, so a `set` in a comment wins.
- The agent reads the description without its command lines.
- Any other command in the description is a problem.
- Problems in the description, including invalid settings, are reported in every run while the description has them.
- The description does not start a run.
