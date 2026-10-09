# Settings

Settings come in layers. Each layer **inherits** from its **base**, the settings that the layers before it resolve to, and may **override** any of its values: a value it sets replaces the base's, and a value it does not set is the base's. The layers, in order:

1. Codeman's default, the table's `Default` column.
2. The organization's settings: the `settings` input of the `select` step, which the template fills from the `CODEMAN_SETTINGS` variable, in the file's format. They are defaults that several repositories share. Empty, or not passed by an older workflow file, means none. Only they set `organization-monthly-budget`: a repository's file or profile that sets it stops the run with an error, and neither commands nor a manual run's inputs take it. See [installation](../installation/shared-settings.md).
3. `.codeman/settings.yml` on the default branch.
4. The workflow's inputs, in a manual run.
5. The [profile](profiles.md) that applies to the run, if any. It overrides only the provider, the model and the provider's settings. Profiles also have conditions, which decide when each applies and how many tasks a run takes.
6. A `/codeman set` command on the task, in a comment or in the issue's description (only `model`, `task-budget`, `max-runs`, `language` and `gpu`). Its `model` is for the top level's provider, and overrides a profile only on that provider; its `gpu` applies to the runs whose provider accepts it ([the model](provider-settings-across-layers.md#the-model)).

So a value comes from the last layer that sets it. The **top level** is the settings outside `profiles`: in a file, its keys outside `profiles`; for a run, what layers 1 to 4 resolve to, which is a profile's base. A layer that names another provider than the one it inherits keeps none of the inherited provider's settings ([provider settings across layers](provider-settings-across-layers.md)).

When `select` picks a task, its log has a line per layer, naming the values that come from it; the values no line names are Codeman's defaults.

| Name | Default | Meaning |
| --- | --- | --- |
| `model` | none | Model ID, in the form the provider takes ([providers](providers.md)). At the top level, the model of the runs no profile serves; without one, only profiles serve agent runs, and each sets its own. No setting is required |
| `task-budget` | `2` | Spending limit of each task, across all its runs, in USD |
| `monthly-budget` | `20` | Spending limit per calendar month for the repository, in USD |
| `organization-monthly-budget` | none | Spending limit per calendar month for all the organization's repositories together, in USD, with the GPU accounts' billing; only the organization's settings set it. See [budget](../budget/budget.md) |
| `max-runs` | `3` | Runs in a row of a routed stage without finishing, or review rounds asking for changes, before a task is blocked |
| `max-files` | `300` | Files one run may change |
| `max-file-bytes` | `1048576` | Size limit of each changed file |
| `max-decisions` | `10` | Decisions in one output of the agent, at most 10 |
| `max-options` | `4` | Options of each decision, from 2 to 6 |
| `max-title-chars` | `80` | Characters of a decision's title, at most 200 |
| `max-question-chars` | `600` | Characters of a decision's question, at most 1,500 |
| `max-label-chars` | `150` | Characters of an option's label, at most 300 |
| `max-summary-chars` | `2000` | Characters of the agent's summary and reason, at most 4,000 |
| `language` | `auto` | The language Codeman talks to maintainers in, as a BCP 47 tag such as `pt-BR`; `auto` uses the conversation's. See [conversation language](../tasks/comments.md#conversation-language) |
| `provider` | `openrouter` | Where agent runs get their model: `openrouter`, `runpod-pod` or `runpod-serverless`. Each provider accepts only its own settings; see [providers](providers.md) |
| `profiles` | none | A provider, a model and that provider's settings for some runs, with conditions: the stages and the run's count of tasks. The counts also decide how many tasks a run works on at once, one without them; see [profiles](profiles.md) |

The settings that only some providers accept (`engine`, `gpu`, `endpoint`, `pod-reuse`) are in [providers](providers.md). Some settings had other names before the [provider settings plan](../plans/2026-10-08-provider-settings.md); an old name stops the run with an error that gives the new one, and [upgrading](../installation/upgrading.md#old-setting-names) lists them. `parallel-tasks` and a profile's `when` are gone too, for the profiles' conditions; their errors say what to write ([upgrading](../installation/upgrading.md#profiles-pick-the-tasks)).

The `max-*-chars` and count limits are what the agent is told; see [agent output](../runs/agent.md#agent-output) for the margin.

The settings file is a strict subset of YAML, read without a dependency ([`src/yaml.ts`](../../src/yaml.ts)): `name: value` lines, block mappings and lists (indented with spaces) for the profiles, lists of values in brackets (`[code, test]`), plain or quoted values, comments and blank lines; see [`templates/settings.yml`](../../templates/settings.yml). Anything else, such as `{...}`, anchors, tags or multi-line values, stops the run with an error that names its line, so the file never means something other than what it looks like. The organization's settings follow the same rules, and their errors name the `settings` input instead of the file.
