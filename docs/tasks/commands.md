# Commands

Maintainers steer a task with comments on its issue or on its pull request, and with review texts. Each line that starts with `/codeman`, outside a fenced code block, is a command; one comment may hold several. Answers (`decide`, `approve`, `answer`) count while the task is `codeman:awaiting-decision` or `codeman:ready`; `fix` and `continue` once it is ready or later; `replan` and `set` in any state.

| Command | Effect |
| --- | --- |
| `/codeman decide 1 a` | Answers decision 1 with option `a`. Several at once: `/codeman decide 1 a 2 b`. `1=a` also works. |
| `/codeman approve` | Accepts the recommendation for every unanswered decision. |
| `/codeman answer 2 <text>` | Answers decision 2 in the maintainer's own words instead of an option. The text continues on the following lines, up to the next command. |
| `/codeman replan <text>` | Sends the task back to planning. The agent revises the plan with the text (which may continue on the following lines), the maintainer comments and the answers given so far; answered decisions are written into the plan as settled, and only open or new decisions are listed. |
| `/codeman fix <text>` | Asks for changes to the implementation. Also a review that requests changes. See [feedback](stages.md#feedback). |
| `/codeman accept-workflows` | Moves the workflows the agent staged under `.codeman/workflows/` into `.github/workflows/`, after a maintainer has read them. See [on-demand workflows](../runs/changes.md#on-demand-workflows). |
| `/codeman continue <text>` | Resumes a blocked or unfinished task with a new run count. The text is optional guidance for the agent. |
| `/codeman set <name> <value>` | Changes `model`, `task-budget`, `max-runs`, `language` or `gpu` for this task from now on. The last valid one wins. |
| `/codeman model <id>` | Short for `/codeman set model <id>`. |

The issue's description may also hold `set` and `model` lines, to choose settings when opening the issue. Comments come after it, so a `set` in a comment wins. The agent reads the description without its command lines. Any other command in the description is a problem. Problems in the description, including invalid settings, are reported in every run while the description has them. The description does not start a run.

Text after `decide` or `approve` is not part of the command: the agent sees it later as a maintainer comment, but it is not recorded as an answer. Use `answer` or `replan` when the text matters.

Only comments from maintainers count, both for commands and for the text the agent sees, and only issues they opened are tasks. A maintainer is a user with `admin`, `maintain` or `write` access to the repository, read from `GET /repos/{owner}/{repo}/collaborators/{user}/permission`. The `author_association` field is not used: GitHub computes it for the reader, and an App token sees private organization members as `CONTRIBUTOR`. Answers are recorded in the status comment and in an `## Answers` section of the plan. When no decision is pending, the task becomes `codeman:ready`. A `replan` in a batch of new commands wins: the run plans again instead of only recording answers.
