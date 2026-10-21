---
title: "runner: src/Runner.Worker/ActionCommandManager.cs at 197ca02"
url: https://github.com/actions/runner/blob/197ca027b90de199464dee3bb9ff198a1db60967/src/Runner.Worker/ActionCommandManager.cs
created_at: 2026-10-21T00:15:48-03:00
updated_at: 2026-10-21T00:15:48-03:00
tool: docs/web/tools/github-repositories.md
---

# runner: src/Runner.Worker/ActionCommandManager.cs at 197ca02

The file is about 35 KB, over what the tool copies in full, so this page holds, in Codeman's words, what the e2e workflow simulator relies on: how GitHub's runner handles the workflow commands a step prints. The file is MIT-licensed. Parsing is in [ActionCommand.cs](runner-src-runner-common-actioncommand-cs-at-197ca02.md), and the step's result in [StepsRunner.cs](runner-src-runner-worker-stepsrunner-cs-at-197ca02.md). The messages and variable names it uses are in `src/Runner.Common/Constants.cs` at the same commit.

## A command that fails fails its step

- `TryProcessCommand`: a line is a command only when it parses as `::<name> <properties>::<data>` and `<name>` is a registered command. Registered names are compared ignoring case.
- When a command's handler throws, the runner logs "Unable to process command '<line>' successfully." and the exception's message as errors, and sets the step's `CommandResult` to `Failed`. An add-mask line is logged by its name only (`OmitEcho`).
- `StepsRunner` merges `CommandResult` into the step's result before `continue-on-error` applies, so the step fails.

## `set-env` and `add-path` are disabled

- `SetEnvCommandExtension` and `AddPathCommandExtension` throw "The `<command>` command is disabled. Please upgrade to using Environment Files or opt into unsecure command execution by setting the `ACTIONS_ALLOW_UNSECURE_COMMANDS` environment variable to `true`." (`Constants.Runner.UnsupportedCommandMessageDisabled`). So the step fails, and neither the variable nor the path reaches a later step.
- Either command is processed only when `ACTIONS_ALLOW_UNSECURE_COMMANDS` is `true` in the runner's environment or the step's `env` context.
- When allowed, `set-env` refuses `NODE_OPTIONS` (`_setEnvBlockList`), as `GITHUB_ENV` does.

## `stop-commands`

- `::stop-commands::<token>` stops processing commands until a line whose command is `<token>`, compared ignoring case. The resuming line is printed and resumes processing.
- `ValidateStopToken`: a token that is empty, `pause-logging`, or the name of a registered command is refused, unless `ACTIONS_ALLOW_UNSECURE_STOPCOMMAND_TOKENS` is `true` (`Constants.Variables.Actions.AllowUnsupportedStopCommandTokens`). The refusal throws outside the handler's `try`, in `ValidateStopToken`.
- A token longer than 6 characters is masked in the log.

## `set-output`, `save-state` and `add-mask`

- `SetOutputCommandExtension` and `SaveStateCommandExtension` still set the step's output or state. They warn that the command is deprecated only when the server's `DistributedTask.DeprecateStepOutputCommands` flag is on. Without a `name` property, they throw "Required field 'name' is missing in ##[<command>] command.", which fails the step.
- `AddMaskCommandExtension` masks the data, and each of its lines on its own. Empty or blank data only gives the warning "Can't add secret mask for empty string in ##[add-mask] command.".
