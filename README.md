# Codeman

Codeman is a GitHub Action that lets an AI agent work on your issues and pull requests, but asks you to make the important decisions first.

> Status: early development. Codeman plans, records decisions, implements, opens pull requests and applies review feedback.

## Why

Most coding agents start writing code as soon as they read an issue. When the issue is ambiguous, you get a pull request that must be reviewed, rejected and redone.

Codeman turns ambiguity into questions instead. The flow it is being built for:

1. You open an issue and label it `codeman`.
2. Codeman writes a plan and posts its open decisions on the issue, each with options and a recommendation.
3. You answer on the issue:

   ```
   /codeman decide 1 a 2 b
   /codeman answer 3 Keep the current URLs; only add the missing pages.
   ```

   You can also accept every recommendation with `/codeman approve`, ask for a revised plan with `/codeman replan <what to change>`, or pick another model for the task with `/codeman set model <openrouter-model-id>`.

   Codeman answers in the language of the issue. Code, commit messages and documentation stay in English, unless your `AGENTS.md` says otherwise.
4. Codeman carries out the plan in stages, one agent each: web (the documentation of the third-party services the task relies on, in `docs/web/`), design (flows and screen drafts), code, test and review. A routing agent chooses which stages each task needs, and says why it leaves any out; review always runs, and has the last word. Then Codeman opens a pull request. You review it: a review that requests changes, or `/codeman fix <what to change>`, sends it back to the routing agent. You merge it; Codeman never merges.

Only maintainers (people with write access to the repository) can steer Codeman, and it works only on issues they opened. Comments from anyone else are ignored. [docs/security.md](docs/security.md) explains what Codeman protects, the risks that remain, and how to protect your repository.

## Getting started

You need a GitHub App for Codeman, an [OpenRouter](https://openrouter.ai) account, their credentials in your repository or organization, a free [Firebase](https://firebase.google.com) project where Codeman records its runs, and a workflow. [docs/installation.md](docs/installation.md) walks through each one.

Codeman is model-agnostic: it reaches models through OpenRouter, and each task gets its own key with a spending limit, inside a monthly budget per repository and, if you set one, per organization. You choose the model and the budgets in `.codeman/settings.yml`, over defaults an organization can [share](docs/installation.md#shared-settings) with its repositories, and the paths the agent may not change in `.codemanignore`.

You can also serve an open model yourself, on GPUs rented from [Runpod](https://www.runpod.io), with the same budgets:

```yaml
inference: self-hosted
model: qwen3-coder:30b
gpu-type: "NVIDIA RTX A6000"
```

Codeman then starts a GPU for the task, serves the model with Ollama behind its own gateway, and stops the GPU when the task no longer needs it. A Serverless endpoint works too. See [self-hosted inference](docs/installation.md#self-hosted-inference-on-runpod). [Inference profiles](docs/installation.md#inference-profiles) mix both in one task, such as OpenRouter to plan and a GPU to write the code, under the same budgets.

The workflow runs once a day, when you start it manually, when a maintainer comments a `/codeman` command, and when a review on one of Codeman's pull requests asks for changes:

```yaml
on:
  schedule:
    - cron: "0 9 * * *"
  workflow_dispatch:
  issue_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
```

## Learn more

- [Architecture](docs/architecture.md): tasks, states and how runs work.
- [Security](docs/security.md): secrets, risks and how to protect your repository.
- [Dependencies](docs/dependencies.md): what Codeman depends on and why.
- [Development](docs/development.md): building and testing Codeman itself.

## License

[MIT](LICENSE)
