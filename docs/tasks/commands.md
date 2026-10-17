# Commands

Maintainers steer a task with comments on its issue or on its pull request, and with review texts. Each line that starts with `/codeman`, outside a fenced code block, is a command; one comment may hold several. The command's name is case-insensitive. Decision numbers have one or two digits, and options are one letter. The free text of `answer`, `replan`, `fix` and `continue` may have at most 2,000 characters; a longer one makes the command invalid.

Only new comments count: `issue_comment` starts a run only when a comment is created, so editing one starts no run, and a comment already handled is never read again. In a review, only its text is read, and only `fix`, `continue` and `replan` count there; its line comments are never read as commands.

A command counts only in some states:

- Answers (`decide`, `approve`, `answer`) count while the task is `codeman:awaiting-decision` or `codeman:ready`.
- `fix` and `continue` count once the task is `codeman:ready`, and in every later state, `codeman:done` included. A `fix` or `continue` posted while the task is `codeman:awaiting-decision` is dropped: the run that records the answers marks the comment handled without acting on it. Post it again once the task is ready. A review that requests changes is not dropped: it waits until the task is ready.
- `replan` and `accept-workflows` count in any state once the task has a plan. A task that was never planned ignores them; one that is `new` or `codeman:planning` plans anyway.
- `set` and `model` count in any state.

| Command | Effect |
| --- | --- |
| `/codeman decide 1 a` | Answers decision 1 with option `a`. Several at once: `/codeman decide 1 a 2 b`. `1=a` also works. |
| `/codeman approve` | Accepts the recommendation for every unanswered decision. |
| `/codeman answer 2 <text>` | Answers decision 2 in the maintainer's own words instead of an option. The text continues on the following lines, up to the next command. |
| `/codeman replan <text>` | Sends the task back to planning. The agent revises the plan with the text (which may continue on the following lines), the maintainer comments and the answers given so far; answered decisions are written into the plan as settled, and only open or new decisions are listed. |
| `/codeman fix <text>` | Asks for changes to the implementation. Also a review that requests changes. See [feedback](stages.md#feedback). |
| `/codeman accept-workflows` | Moves the workflows the agent staged under `.codeman/workflows/` into `.github/workflows/`, after a maintainer has read them. With nothing staged, the run only says so. See [on-demand workflows](../runs/changes.md#on-demand-workflows). |
| `/codeman continue <text>` | Resumes a blocked or unfinished task with a new run count. The text is optional guidance for the agent. On a `codeman:done` task, it runs the code stage again, without routing; `fix` routes. |
| `/codeman set <name> <value>` | Changes `model`, `task-budget`, `max-runs`, `language` or `gpu` for this task from now on. The last valid one wins. |
| `/codeman model <id>` | Short for `/codeman set model <id>`. |

The issue's description may also hold `set` and `model` lines, to choose settings when opening the issue. Comments come after it, so a `set` in a comment wins. The agent reads the description without its command lines. Any other command in the description is a problem. Problems in the description, including invalid settings, are reported in every run while the description has them. The description does not start a run.

`approve` takes nothing after it on its line, and `decide` only decision numbers and options: other text there makes the command invalid. Text on the lines after them is not part of the command: the agent sees it later as a maintainer comment, but it is not recorded as an answer. Use `answer` or `replan` when the text matters.

Only comments from maintainers count, both for commands and for the text the agent sees, and only issues they opened are tasks. A maintainer is a user with `admin`, `maintain` or `write` access to the repository, read from `GET /repos/{owner}/{repo}/collaborators/{user}/permission`. The `author_association` field is not used: GitHub computes it for the reader, and an App token sees private organization members as `CONTRIBUTOR`. Answers are recorded in the status comment and in an `## Answers` section of the plan. When no decision is pending, the task becomes `codeman:ready`. A `replan` in a batch of new commands wins: the run plans again instead of only recording answers.
