# Codeman's documentation

Codeman is a GitHub Action that lets an AI agent work on your issues and pull requests, but asks you to make the important decisions first ([what Codeman is](../README.md)).

New to Codeman? Read the [README](../README.md), then follow [Installation](installation/setup.md).

## Get started

| Page | Read it to … |
| --- | --- |
| [Installation](installation/setup.md) | Set up Codeman on a repository, then try a task |
| [Self-hosted inference on Runpod](installation/runpod.md) | Serve models on GPUs you rent from Runpod |
| [Shared settings](installation/shared-settings.md) | Give every repository of an organization the same settings |
| [A pool of organizations](installation/pool.md) | Let several organizations share one Runpod account and pods |
| [Mixing providers](installation/mixing-providers.md) | Use different providers and models for different stages |
| [Glossary](glossary.md) | Look up the one meaning of each term |

## Work with tasks

| Page | Read it to … |
| --- | --- |
| [Task lifecycle](tasks/lifecycle.md) | Follow a task's state labels, and unblock a blocked task |
| [Stages](tasks/stages.md) | Know what each stage does, and how routing chooses them |
| [Commands](tasks/commands.md) | Steer a task with `/codeman` commands |
| [Comments](tasks/comments.md) | Read the status, decisions and run comments |

## Configure

| Page | Read it to … |
| --- | --- |
| [Settings](settings/reference.md) | Find every setting, its layers, and the file's format |
| [Providers](settings/providers.md) | Choose a provider, with its settings, secrets and cost |
| [Profiles](settings/profiles.md) | Give some agent runs another provider, model or settings |
| [Provider settings across layers](settings/provider-settings-across-layers.md) | Know what a change of provider keeps |
| [Pod engines](settings/pod-engines.md) | Choose Ollama or vLLM, and tune what both share |
| [Ollama settings](settings/ollama.md) | Tune a pod's Ollama server, and its GPU fit |
| [vLLM settings](settings/vllm.md) | Tune a pod's vLLM server, its tool calls and fit |

## Costs

| Page | Read it to … |
| --- | --- |
| [Budget](budget/budget.md) | Set the task's, the month's and the organization's budgets |
| [Spend](budget/spend.md) | Read the spend table, and how GPU time counts |

## Operate

| Page | Read it to … |
| --- | --- |
| [Backend maintenance](installation/backend-maintenance.md) | Read, change, stop or restore the backend's Google Cloud setup |
| [Upgrading](installation/upgrading.md) | Move to a newer commit of Codeman safely |

## Security

| Page | Read it to … |
| --- | --- |
| [Security](security/overview.md) | Judge whether Codeman is safe for your repository |
| [Secrets](security/secrets.md) | See where each credential goes, and why it is safe |
| [Risks](security/risks.md) | Know the real risks, and how to protect against each |
| [Forks](security/forks.md) | Know what a fork gets, and what to set |

## How it works

| Page | Read it to … |
| --- | --- |
| [Runs and jobs](runs/runs-and-jobs.md) | Know what starts a run, and what each job does |
| [Batches across repositories](runs/batches.md) | See how several repositories' tasks share one pod |
| [The agent](runs/agent.md) | Know the agent's sandbox, rules and output |
| [What the agent may change](runs/changes.md) | Know which changes Codeman commits, and how workflows land |
| [OpenRouter](inference/openrouter.md) | See how each agent run gets its own capped key |
| [Self-hosted inference](inference/self-hosted.md) | Compare pods and Serverless, and meet the gateway |
| [Pods](inference/pods.md) | See how pods are shared, held and ended |
| [Serverless](inference/serverless.md) | Check an endpoint, and see how runs split its cost |
| [Backend](backend/backend.md) | Know what Firestore holds, and how jobs reach it |
| [Data layout](backend/data-layout.md) | Find each collection, its writers, readers and fields |

## Contribute

| Page | Read it to … |
| --- | --- |
| [Development](development/guide.md) | Build, test and release Codeman, and publish its pod images |
| [Writing the docs](development/documentation.md) | Shape a page, and keep its links and anchors |
| [Platforms](development/platforms.md) | Add a platform or runtime behind Codeman's interfaces |
| [Dependencies](development/dependencies.md) | See what Codeman depends on, why, and the audits |

Two directories stay in the repository and are not published on the site:

- `docs/plans/` holds one plan per piece of work, with its decisions: the project's history. The [Firestore backend plan](plans/2026-10-07-firestore-backend.md) is one example.
- `docs/web/` holds the pages of the third-party services Codeman relies on. Each one names the tool that fetched it, such as [Fetch Markdown](web/tools/fetch-markdown.md).
