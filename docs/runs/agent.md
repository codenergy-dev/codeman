# The agent

## Agent sandbox

The agent reads text that may be hostile (see [security](../security/risks.md)) and runs shell commands. It runs as `codeman-agent`, a user without `sudo`, on a copy of the checkout in that user's home.

- It cannot read the runner's processes, so it cannot reach the job's tokens or the secrets of other steps.
- The runner's home, which holds the job's temporary files, is closed to other users before the agent starts. The agent is not in the `docker` group.
- Its environment is rebuilt from an allowlist: its own `HOME` and XDG directories, the job's `PATH` without entries in the runner's home, and the harness's variables. Nothing else from the runner passes, including what `sudo`'s PAM session adds from `/etc/environment`.
- Its tools and network are not restricted: it can use what the runner image has and what earlier steps of the job set up. The sandbox protects credentials, not the runner.
- Its credential (the run's OpenRouter key, or its token for a self-hosted gateway) reaches it only through its environment. It is the only credential the agent holds: a Serverless endpoint's key stays in Codeman's step, outside the sandbox.
- When the harness exits or reaches its time limit, every process of that user is killed.
- Codeman finds changes with `git status`, using the original checkout's `.git` against the agent's copy; the agent's `.git` is never used. Changed files are copied without following symlinks.

## Agent rules

Every agent run gets Codeman's working rules: the `##` sections of Codeman's own [`AGENTS.md`](../../AGENTS.md) (language, documentation, plans, commits, third-party code, decisions), after a short section on applying them without a person to ask. The agent job writes them to `.codeman/rules.md` in the agent's copy, and the harness loads that file as instructions next to the repository's `AGENTS.md` (OpenCode: the `instructions` setting). The repository's files are not changed.

- The repository's `AGENTS.md` (or `CLAUDE.md`) wins for its own conventions, such as where documentation lives or which language it uses. The rules in the task file always hold: plan path and format, output file, protected paths, no secrets.
- A section the repository's file already contains is left out: when 60% or more of its three-word sequences appear there, ignoring case and punctuation. So a repository that copied Codeman's `AGENTS.md`, even with edits, does not get it twice. The job's log lists the sections left out.

## Agent output

The agent reports in `.codeman/output.json`: a summary and decisions when planning, and a status, a summary, a reason, a commit message and decisions in a stage. What it writes there ends up in comments on GitHub, which hold at most 65,536 characters, so each text has a limit; see [settings](../settings/reference.md).

- The prompt states the limits. Codeman accepts each text up to twice its limit, without telling the agent: LLMs count characters poorly, and a text a little too long is not worth losing a run. The commit message's limit is 1,000 characters.
- Counts have no margin: at most `max-decisions` decisions, with 2 to `max-options` options each.
- All decisions of one output together (titles, questions and labels) may have at most 50,000 characters; the agent is told 25,000.
- When the harness exits, the agent job checks the output as `apply` will. If it is missing or invalid, or a text would be cut, and at least two minutes are left, it continues the agent's session once with the problems, stated with the limits the agent was told. A fix that fails or runs out of time leaves the first outcome.
- `apply` validates the output again. A text still longer than twice its limit is cut, and the run comment lists it under Problems. Any other problem blocks the task.
