---
status: completed
created_at: 2026-10-08T16:29:39-03:00
updated_at: 2026-10-08T16:52:00-03:00
commit: 44485dc
---

# A model per provider

## Goal

A model set for one provider never reaches another: a layer or a profile that changes provider must set its own `model`, and a run whose settings break this stops at its first run, in `select`, before any key is opened or pod created.

## Context

- **Today.** A layer (the organization's settings, the repository's file) or a profile that names another provider than the one below it drops that provider's settings (`gpu`, `endpoint`, `engine`, `pod-reuse`), but `model` carries over and must fit the new provider (choice 9 of the [provider settings plan](2026-10-08-provider-settings.md); [the model](../settings/provider-settings-across-layers.md#the-model)). `serving` and `resolveRun` in `src/settings.ts` apply it.
- **The hole.** Codeman checks only a model ID's form (`modelProblem` in `src/inference/providers.ts`), and an OpenRouter ID such as `deepseek/deepseek-v4.1-flash` also has the form of an Ollama name and of a Hugging Face ID. So a `runpod-pod` or `runpod-serverless` profile without its own `model` under an OpenRouter top level passes the check. On Serverless, `open-key`'s endpoint check refuses the run; on pods, the failure shows only after Codeman created the pod, which costs money, when it fails to pull the model.
- **A task's model** (`/codeman set model`) wins today over every layer and profile, and has the same hole: an OpenRouter ID set on a task reaches the task's runs on a pod profile.
- **Where the checks run.** `resolveRun` checks the top level and every profile, without the task's commands, whichever stage runs, so a mistake stops the first run. `select` calls it before any key job; when the task's `model` or `gpu` is what fails, it reports a `settings-rejected` problem and resolves again without them.

## Decisions

1. **What a change of provider requires of the model.** Options:
   - (a) Keep today's rule: `model` carries over, and must fit the new provider by its form.
   - (b) A layer or profile that names another provider than the one below it must set its own `model`; otherwise the run stops with an error that names the layer or profile and says to set `model` for the new provider. One that names no provider, or the same one, keeps inheriting `model`.
   - (c) Tell the providers' model IDs apart by more than their form, such as by asking each provider whether it serves the model.

   Recommendation: (b): (a) is the hole, and (c) calls external services from `select` and still cannot tell for a pod, whose models Ollama pulls on start.

   **Answer (the responsible person, 2026-10-08):** (b).

### Choices made while writing the plan

2. **Which layers count, and what is below each.** The layers apply from the bottom: Codeman's defaults (`provider: openrouter`, no model), the organization's settings, the repository's file, a manual run's inputs; then the run's profile over the top level. "The provider below" a layer is the one the layers under it resolve to, Codeman's default `openrouter` when none names one: a repository file with `provider: runpod-pod` over an organization that sets only `model: deepseek/deepseek-v4.1-flash` changes provider. A manual run's inputs and a task's commands cannot name a provider, so they never change it.
3. **Only a model that would carry over is refused.** The rule's purpose is that a model set for one provider does not reach another. When no layer below sets a model, nothing carries over, so a change of provider needs no `model` of its own: an organization with `provider: runpod-pod` and no model, whose repositories each set their `model`, keeps working (Codeman's defaults have no model, so the organization's settings never trip the rule). The model then comes from a layer above the change, which is for the new provider.
4. **A manual run's `model` input does not satisfy the requirement.** A repository file that changes the organization's provider without its own `model` stops the run even when a manual run gives `model`: scheduled runs have no inputs, and the top level must be valid on its own. The input keeps replacing the top level's model; since a profile that changes provider now sets its own, the input reaches only the runs on the top level's provider.
5. **A task's `model` does not satisfy it either, and is for the top level's provider.** The top level and each profile are checked without the task's commands, as today, so a profile that changes provider without `model` stops the run even when the task sets one. A task's `model` applies to the runs on the top level's provider (the top level, and the profiles that keep its provider), where it wins over the profile's model as today; a profile that changes provider keeps its own model, so a task's OpenRouter ID never reaches a pod. The task's model must fit the top level's provider, whichever profile the run takes; where it does not, it is reported as a `settings-rejected` problem and left out, as today. The cost: a task can no longer change the model of a profile on another provider than the top level's; the profile's `model` in the file does.
6. **Where the error shows.** In `resolveRun`, before the top level or any profile is checked against its provider, so it stops the first run in `select`, whatever its stage, before any key is opened or pod created. The message is English, like every settings error; no message of `src/i18n/` changes.

## Steps

1. Write this plan. Done when it is committed with status `pending`, then set `in progress`.
   - **Done on 2026-10-08**: committed as `5812d4d` with status `pending`, then set `in progress`.
2. Code (`src/settings.ts`): `serving` names each layer and refuses a change of provider without `model` when a model would carry over (choices 2 to 4); `resolveRun` applies a task's model only to runs on the top level's provider, and checks it against that provider (choice 5). Tests in `src/settings.test.ts`: a profile that changes provider without `model` stops the run, with `model` it runs; a profile with no provider or the same one inherits `model`; a repository file that changes the organization's provider (or the default `openrouter`, under an organization that sets only a model) without `model` stops the run; with no model below, it does not; neither a manual run's `model` nor a task's satisfies the requirement; a task's model applies to the top level's provider only. The four examples of [provider settings across layers](../settings/provider-settings-across-layers.md) follow the new rule. `src/steps/flow.test.ts`'s task model test follows choice 5. Done when the tests pass.
   - **Done on 2026-10-08**: `serving` takes named layers (`layerSource` names the top-level ones as the log does; profiles as "Profile `x`") and returns an error when a layer or profile names another provider than the one below it, a model is set below, and it sets none: "Profile `planner` names `openrouter`, another provider than the `runpod-pod` below it, so it must set its own `model`, one for `openrouter`." `resolveRun` checks a task's model against the top level's provider ("The task's `model` is for `openrouter`, the top-level settings' provider. ...", which `select` reports as `settings-rejected`) and applies it only to runs on that provider. Tests in `settings.test.ts`: a new test for the rule (profile without and with `model`, no or the same provider, the file over the organization's provider and over the default `openrouter`, a manual run's and a task's model not making up for it, no model below); the task model test rewritten for choice 5; examples 2 and 4 now assert the new error. `flow.test.ts`: a task's OpenRouter model does not reach a pod profile, which keeps the task's GPU; a profile without `model` stops `select` before any output.
3. Docs: [provider settings across layers](../settings/provider-settings-across-layers.md) (the rule, `#the-model`, examples 2 and 4, the summary table), [profiles](../settings/profiles.md) (layers and checks), [installation's profiles](../installation/profiles.md), [upgrading](../installation/upgrading.md) (what settings written before must change, and its line in `docs/README.md`), and the profiles comment of `templates/settings.yml`. Done when no file outside `docs/plans/` states the old rule and the docs link checker passes.
   - **Done on 2026-10-08**: [provider settings across layers](../settings/provider-settings-across-layers.md): the rule's step 2, a rewritten [the model](../settings/provider-settings-across-layers.md#the-model), examples 2 and 4 with the new error, and the summary table's model column; [profiles](../settings/profiles.md): layers and checks; [installation's profiles](../installation/profiles.md); [upgrading](../installation/upgrading.md#a-model-per-provider) and its line in `docs/README.md`; `templates/settings.yml`'s profiles comment. The docs link checker passes.
4. Rebuild `dist/` and run `npm run check`. Done when it passes and the working tree is clean.
   - **Done on 2026-10-08**: 480 tests, 478 pass and 2 skipped (the sandbox's, Linux runners only). `dist/index.js` changed; `dist/gateway.js` did not, so no new pod image is needed.

## End-to-end test

On the test repository, with Codeman installed from the plan's last commit. It costs nothing: each error stops the run in `select`, before any key is opened or pod created.

1. **A profile that changes provider without `model`.** `.codeman/settings.yml` with `model: deepseek/deepseek-v4.1-flash` at the top level (OpenRouter) and a profile `small-pod` for `stages: [code]` with `provider: runpod-pod` and `gpu: "NVIDIA RTX A6000"`, without `model`. Start a run on any task (the planning stage is enough): `select` fails with "Profile `small-pod` names `runpod-pod`, another provider than the `openrouter` below it, so it must set its own `model`, one for `runpod-pod`." No key job runs, and Runpod's console shows no new pod.
2. **With its own `model`.** Add `model: qwen3-coder:30b` to the profile. The next run on a planning task passes `select` and plans on OpenRouter as before (a planning run's usual cost, a few cents; skip it to keep the test at zero).
3. **A repository that leaves the organization's provider.** If the organization's `CODEMAN_SETTINGS` sets a `model`, set the file to `provider: runpod-serverless` and `endpoint: abc123xyz`, without `model`: the run fails in `select` with ".codeman/settings.yml names `runpod-serverless`, another provider than the `<organization's provider>` below it, so it must set its own `model`, one for `runpod-serverless`." Restore the file.

## Out of scope

- Telling providers' model IDs apart by more than their form (decision 1, option c).
- Letting a task choose a model per provider, or change its provider (`/codeman set provider`).
- A `provider` input for manual runs.

## Notes

- **2026-10-08**: the error message and the docs were reworded from "below" to inheritance; the message now names where the inherited provider comes from: "Profile `planner` names `openrouter`, but inherits `runpod-pod` from the top level, so it must set its own `model`, one for `openrouter`." (for a layer, from the organization's settings or Codeman's default).
