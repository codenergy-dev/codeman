---
status: in progress
created_at: 2026-10-08T13:54:00-03:00
updated_at: 2026-10-08T14:17:37-03:00
commit: 8b911ba
---

# Provider settings

## Goal

A repository chooses where its model is served with one setting, `provider`, and each provider accepts only its own settings, so the settings say plainly what is possible for each provider and a new provider adds an entry instead of new combinations.

## Context

- **Today.** Inference is set by `inference` (`openrouter`, `self-hosted`), `gpu-provider` (`runpod`), `gpu-mode` (`pod`, `serverless`), `gpu-type`, `engine`, `serverless-endpoint` and `pod-reuse`, and varied by `inference-profiles` ([settings](../architecture.md#settings), [inference profiles](../architecture.md#inference-profiles)). Any combination can be written; Codeman checks afterwards that it fits, so the file reads as if every combination were possible.
- **What exists.** Three ways to serve a model: OpenRouter, a Runpod pod (Ollama), a Runpod Serverless endpoint (the vLLM worker). The responsible person plans vLLM on pods too (2026-10-08), so a provider may offer several engines.
- **What may come.** Other GPU clouds (such as Salad) and other LLM gateways. A generic OpenAI-compatible API needs its own plan: Codeman's budgets need a cost, which such an API does not report.
- **Runpod Serverless.** Codeman does not call the endpoint's OpenAI-compatible URL: it uses the job queue (`/run`, `/stream`, `/health`) and the REST API by the endpoint's ID ([Serverless](../architecture.md#serverless)).
- **Breaking changes are fine**: Codeman has one user (2026-10-07). The ledger and task records keep the run's mode as `openrouter`, `pod` or `serverless` (`src/ledger.ts`, `src/spend.ts`); older records must stay readable.

## Decisions

The responsible person approved each recommendation on 2026-10-08, except where an answer says otherwise.

1. **The provider setting.** Options:
   - (a) `provider: openrouter | runpod-pod | runpod-serverless` replaces `inference`, `gpu-provider` and `gpu-mode`.
   - (b) Keep the three settings.

   Recommendation: (a).

   **Answer:** (a).
2. **Settings per provider.** Options:
   - (a) A registry in the code: each provider declares the settings it accepts and requires, their allowed values and defaults, its secrets, and what its model ID is. A setting the run's provider does not accept stops the run with an error that names the provider; validation, errors, the secrets `open-key` requires and the docs' table come from it.
   - (b) Keep checking combinations after the fact.

   Recommendation: (a).

   **Answer:** (a).
3. **The engine.** Options:
   - (a) Remove `engine`: each provider has one.
   - (b) Keep `engine`, accepted by the providers that run one, with each provider's allowed values: `runpod-pod` takes `ollama` (the default), and `vllm` once pods offer it; `runpod-serverless` takes `vllm` (the default); `openrouter` does not accept it.

   Recommendation was (a).

   **Answer:** (b): vLLM on pods is planned (2026-10-08).
4. **The GPU.** `gpu-type` becomes `gpu`, accepted by `runpod-pod` only (a Serverless endpoint's GPU types are set on the endpoint); `/codeman set gpu-type` becomes `/codeman set gpu`. `pod-reuse` stays, accepted by `runpod-pod` only.

   **Answer:** as stated.
5. **The Serverless endpoint.** Options:
   - (a) `endpoint`, accepted by `runpod-serverless`, taking the endpoint's ID or a URL of it copied from Runpod's console (`https://api.runpod.ai/v2/<id>/...`), from whose path Codeman takes the ID. A URL on any host other than `api.runpod.ai` is an error, since the endpoint's key goes there.
   - (b) `base-url`, as for an OpenAI-compatible API.

   Recommendation: (a). Codeman never calls that URL; `base-url` is kept for a future OpenAI-compatible provider.

   **Answer:** (a).
6. **The list of profiles.** Options:
   - (a) `profiles`: each one is a rule (`when`) that picks a provider, a model and that provider's settings.
   - (b) `providers` or `provider-profiles`.

   Recommendation: (a). A profile is not a provider; a list named `providers` reads as the providers available.

   **Answer:** (a).
7. **Old names.** Options:
   - (a) An old name stops the run with an error that gives the new one (such as "`gpu-type` is now `gpu`"), in the file, the organization's settings, commands and a manual run's inputs.
   - (b) Accept both as aliases.

   Recommendation: (a): one name for each thing.

   **Answer:** (a).
8. **Names elsewhere.** The `select` outputs, the ledger's new runs and the spend table use the provider's name (`openrouter`, `runpod-pod`, `runpod-serverless`; the table keeps "OpenRouter", "Runpod (pod)", "Runpod (Serverless)"). Records and ledger documents written before read as they are.

   **Answer:** as stated.

### Choices made while implementing

The plan left these open; each follows its decisions (one name per thing, strict errors that say what to write instead). Recorded on 2026-10-08.

9. **A provider's settings go with it.** A layer (the organization's settings, the repository's file) or a profile that names another provider than the one below it leaves out that one's settings (`gpu`, `endpoint`, `engine`, `pod-reuse`): a profile with `provider: runpod-serverless` over a top level on `runpod-pod` does not inherit `gpu`, and a repository's `provider: openrouter` drops the organization's `gpu`. A layer or profile that names the same provider, or none, keeps them. Otherwise a profile on another provider, or a repository that leaves an organization's pods, could never be valid, since a lower layer's value cannot be unset. `model` is not a provider setting: it carries over, and must fit the new provider.
10. **A task's `gpu`** (`/codeman set gpu`) applies to the runs whose provider accepts it, and is left out of the others, so a task planned on OpenRouter and coded on a pod takes it for its pod runs. When no provider of the settings or profiles accepts it, the run reports it as a problem and goes on without it, as with a model that does not fit.
11. **Accounts.** What the budgets and secrets work by is the account a provider bills: `openrouter`, or `runpod` for both Runpod providers (`ACCOUNTS` in the registry). The `inference` output's list of the settings' providers becomes `accounts`. A run's document in the ledger keeps `provider`, now the provider's name, and no longer gets `mode`; the budgets read its account from it, and an older run's `provider` (`openrouter`, `runpod`) already names its account. No new field.
12. **Pods' documents keep `provider: runpod`**, the cloud that runs and bills the pod: the plan does not change the pod registry, and they name no Codeman provider.
13. **Spend rows** keep their provider in `provider`; rows written before keep `inference` (`openrouter`, `pod`, `serverless`), which reads as the matching provider.
14. **Names that are not settings stay**: the action's `inference` input and output (the run's choice, as JSON), `gpu-key`, `serverless-key` and the secrets. A manual run's inputs (`model`, `task-budget`, `monthly-budget`, `max-runs`) had no old name to refuse.
15. **Wording.** Errors and logs say "Profile `x`" instead of "Inference profile `x`". A task's older `/codeman set gpu-type` comment, read again in later runs, no longer applies, like any invalid command; only a new one is reported, with the new name.

## Steps

1. The provider registry (`src/inference/`): `openrouter`, `runpod-pod` and `runpod-serverless`, each with its accepted and required settings, allowed values, defaults, secrets and model ID. Done when unit tests cover each provider's settings, a setting it does not accept, a missing required one, and an engine it does not offer.
   - **Done on 2026-10-08**: [`src/inference/providers.ts`](../../src/inference/providers.ts): `PROVIDERS`, each with its account, the settings it accepts (`required`, allowed `values`, `default`), its model IDs (OpenRouter's or its engine's) and the secrets beside its account's; `ACCOUNTS` (input, secret, hourly billing); `providerProblem`, `withProviderDefaults`, `settingValues` (every value some provider allows, which parsing uses before the provider is known), `accountOf`, and `endpointId` (decision 5). `MODE_ENGINE` is gone from `engines.ts`. Tests in `providers.test.ts`.
2. Settings (`src/settings.ts`, `src/yaml.ts` if needed): `provider`, `gpu`, `endpoint` (ID or URL), `engine` and `pod-reuse` per the registry, and `profiles`; the old names' errors. The same rules for the organization's settings, a manual run's inputs and commands (`/codeman set gpu`). Done when `settings` and `commands` tests cover each provider, a profile on another provider than the top level's, an endpoint given as a URL, a URL on another host, and each old name.
   - **Done on 2026-10-08**: [`src/settings.ts`](../../src/settings.ts): `provider`, `engine`, `gpu`, `endpoint`, `pod-reuse` and `profiles` (`Profile`); `renamedSetting` gives each old name's error, value-aware (`gpu-mode: pod` says `provider: runpod-pod`), in the file, the organization's settings and profiles; `resolveRun` checks the top level and each profile with `providerProblem`, applies choices 9 and 10, fills the provider's defaults, and returns the `accounts`. Commands: `/codeman set gpu` takes the rest of its line; `set gpu-type` is a `renamed-setting` problem, in English and Portuguese. `src/yaml.ts` did not change. Tests in `settings.test.ts`, `commands.test.ts` and `i18n.test.ts`.
3. The rest of the code on the registry: `select` and its outputs, the key jobs, the secrets `open-key` requires (from the providers the settings and profiles name), the ledger's new runs and the spend table, keeping older records readable. Done when the existing tests pass on the new names and a test reads an older record and ledger run.
   - **Done on 2026-10-08**: the `inference` output's choice names its `provider`, `gpu` and `accounts` (`src/inference/index.ts`); the agent's access, `apply`'s spend rows, `open-key`'s secrets and billing (by account) and `release-pod` read it; `select` writes the provider to the ledger (choice 11); the spend table names `provider` and reads older rows' `inference` (`rowProvider` in `src/spend.ts`). Tests: `ledger.test.ts` reads older and new runs' accounts; `flow.test.ts` shows rows without a provider, with an older `inference` and with a provider, and a task's `gpu` on a pod profile; `spend.test.ts` reads older rows. `dist/gateway.js` changes: it bundles the Runpod adapter, whose error for an unknown GPU type now names `gpu`. The gateway never calls it, so pods behave as before; pushing `main` publishes a new pod image, and `POD_IMAGE` needs no new pin.
4. Workflow and templates: `action.yml` and the workflows' inputs, `templates/settings.yml` (one commented block per provider), `src/templates.test.ts`. Done when the templates use only the new names.
5. Docs: [architecture](../architecture.md) (Settings: a section per provider with its settings, secrets, model ID and how its cost is measured; Inference profiles as Profiles), [installation](../installation.md), README. A test checks that each provider's documented settings match the registry. Done when the docs name only the new settings.
6. Rebuild `dist/` and run `npm run check`. Done when it passes.

## End-to-end test

On the test repository, with Codeman installed from the plan's last commit and its two workflow files copied again:

1. **OpenRouter.** `.codeman/settings.yml` with `provider: openrouter` and a model. Run a task to its first stage: it runs as before, and the spend table's provider reads "OpenRouter".
2. **A setting the provider does not accept.** Add `gpu: "NVIDIA RTX A6000"` at the top level, with `provider: openrouter`. The next run stops in `select` with an error that says `openrouter` does not accept `gpu`. Remove it.
3. **An old name.** Write `gpu-type` instead, or `inference-profiles`: the error gives the new name. Restore the file.
4. **Runpod Serverless by URL.** A profile with `provider: runpod-serverless` and `endpoint` set to the endpoint's URL from Runpod's console, for the `code` stage. Run a task to that stage: `select`'s log names the profile, `open-key` checks the endpoint by its ID, and the row reads "Runpod (Serverless)". Costs about as a Serverless run does today (US$ 0.30 to 0.50).
5. **Runpod pod.** A profile with `provider: runpod-pod`, `gpu` and the pod's model. Run a task to that stage; the row reads "Runpod (pod)". About US$ 0.50 of pod time.
6. **Command.** On a task, `/codeman set gpu "NVIDIA RTX A5000"` applies to its next pod run; `/codeman set gpu-type ...` is reported as a problem that gives the new name.
7. **Older rows.** A task with rows from before this change shows them with their provider as before.

## Out of scope

- An OpenAI-compatible provider (`base-url`), which needs a way to measure its cost.
- vLLM on pods; `engine` is kept for it.
- Changing a task's provider with `/codeman set provider`.
- Other GPU clouds.
