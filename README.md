# Codeman

Codeman is a GitHub Action that lets an AI agent work on your issues and pull requests, but asks you to make the important decisions first.

> Status: early development. Codeman plans and records decisions; it does not write code yet.

## Why

Most coding agents start writing code as soon as they read an issue. When the issue is ambiguous, you get a pull request that must be reviewed, rejected and redone.

Codeman turns ambiguity into questions instead. The flow it is being built for:

1. You label an issue with `codeman`.
2. Codeman writes a plan and posts its open decisions on the issue, each with options and a recommendation.
3. You answer on the issue:

   ```
   /codeman decide 1 a 2 b
   /codeman answer 3 Keep the current URLs; only add the missing pages.
   ```

   You can also accept every recommendation with `/codeman approve`, ask for a revised plan with `/codeman replan <what to change>`, or pick another model for the task with `/codeman model <openrouter-model-id>`.
4. Codeman implements the plan and opens a pull request. You review it and merge it; Codeman never merges.

Only maintainers (people with write access to the repository) can steer Codeman. Comments from anyone else are ignored.

## Getting started

You need a GitHub App for Codeman, an [OpenRouter](https://openrouter.ai) account, their credentials in your repository or organization, and a workflow. [docs/installation.md](docs/installation.md) walks through each one.

Codeman is model-agnostic: it reaches models through OpenRouter, and each task gets its own key with a spending limit, inside a monthly budget per repository.

The workflow runs once a day, when you start it manually, and when a maintainer comments a `/codeman` command:

```yaml
on:
  schedule:
    - cron: "0 9 * * *"
  workflow_dispatch:
  issue_comment:
    types: [created]
```

## Learn more

- [Architecture](docs/architecture.md): tasks, states and how runs work.
- [Dependencies](docs/dependencies.md): what Codeman depends on and why.
- [Development](docs/development.md): building and testing Codeman itself.

## License

[MIT](LICENSE)
