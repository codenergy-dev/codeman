---
status: completed
created_at: 2026-10-28T17:30:00-03:00
updated_at: 2026-10-28T17:40:00-03:00
commit: 9033755
---

# Let self-hosted models read images

## Goal

An agent on a pod reads the images its model can read, such as the design stage's screenshots, instead of getting OpenCode's "this model does not support image input". Codeman tells OpenCode which self-hosted models read images by detecting it from the model and the engine's settings, with nothing to configure.

## Context

- **The symptom.** On a `runpod-pod` profile with `unsloth/Qwen3.8-27B-NVFP4` on vLLM, the agent's `read` of a PNG returns an image ([read.ts](../web/opencode/opencode-packages-opencode-src-tool-read-ts-at-545f51d.md)). OpenCode then replaces it with `ERROR: Cannot read image (this model does not support image input). Inform the user.` The code stage is told to follow `docs/screenshots/` (`stagePrompt` in `src/prompt.ts`), and review to judge the work: both lose the screenshots.
- **Why.** `openCodeConfig` (`src/harness/opencode.ts`) registers the self-hosted model as `{ name, limit }`. The `codeman` provider is not in OpenCode's catalog, so the model's image input defaults to `false` ([provider.ts](../web/opencode/opencode-packages-opencode-src-provider-provider-ts-at-545f51d.md#a-model-from-the-configuration)), and `unsupportedParts` drops every image ([transform.ts](../web/opencode/opencode-packages-opencode-src-provider-transform-ts-at-545f51d.md)). Images a tool returns reach an `@ai-sdk/openai-compatible` model as a user message, so they go through it too (`supportsMediaInToolResult` in [message-v2.ts](../web/opencode/opencode-packages-opencode-src-session-message-v2-ts-at-545f51d.md)). OpenRouter's models are unaffected: Codeman registers them as `{}`, and the catalog OpenCode 1.18.32 embeds gives `deepseek/deepseek-v4.1-flash` image input.
- **What the engines serve.** vLLM serves a multimodal model's vision tower unless `language-model-only` is set ([vLLM settings](../settings/vllm.md)). Ollama serves images to models whose `/api/show` lists the `vision` capability ([show model details](../web/ollama/show-model-details.md)). Both take OpenAI's `image_url` parts ([Ollama](../web/ollama/openai-compatibility.md)). Telling OpenCode a text-only model reads images would be worse than today: the engine would refuse the whole request.
- **What each job knows.**
  - `open-key` reaches the pod's gateway status and, for vLLM, already calls Hugging Face's API for the weights' size, on creation only.
  - The agent job gets `handle`, `base-url` and `context-length` from `open-key` through the workflow template (`templates/codeman-task.yml`).
  - The handle is JSON written and read by the same Codeman commit, and the Serverless handle already carries `contextLength` for the agent job.
- **The pod image.** The gateway runs from Codeman's pod images, pinned by digest in `src/inference/images.ts`. A change to `dist/gateway.js` reaches pods only once images built from it are published and pinned in a later commit ([pod images](../development/guide.md#pod-images)).

## Decisions

### Answered by the responsible person on 2026-10-28

1. **How Codeman knows a model reads images.** Options: (a) detect it from the model and the engine's settings; (b) a new profile setting, such as `vision: true`. **Answer: (a).** Nothing to configure, and no setting that can claim images for a text-only model.

### Choices made in this work

1. **vLLM.** A model reads images when its `config.json` on Hugging Face, at `main` as vLLM downloads it, has a `vision_config` object, does not set `language_model_only: true`, and the `vllm` settings do not set `language-model-only: true`. `open-key` reads it on every open, created pod or joined, since the creation's check does not run on a join. `trust-remote-code` is refused, so every model vLLM serves for Codeman has an architecture of vLLM's own, and these use `vision_config`.
2. **Ollama.** The gateway reads the `vision` capability from the `/api/show` it already calls, and reports `vision` in `/admin/status`. Gateways of the pinned images report nothing, so their models stay text only until new images are pinned.
3. **Transport.** `open-key` puts `vision: true` in the pod's handle, which the agent job already gets. No new output or input of the action, and no change to the workflow template. Handles without it mean text only.
4. **Failures.** A failure to read `config.json` or the status means text only, with a line in `open-key`'s log, like the context length: it never fails the run.
5. **The log.** `open-key` logs whether the agent is told the model reads images, so a maintainer can tell why it does or does not.
6. **OpenCode.** When the provider reads images, the model gets `attachment: true` and `modalities: { input: ["text", "image"], output: ["text"] }`, which OpenCode's configuration schema accepts.

## Steps

1. **Third-party docs.** Add to `docs/web/` what this relies on, following the rules: OpenCode's `provider/provider.ts`, `provider/transform.ts` and `session/message-v2.ts` at `545f51d` in its own words, and its v1 config `provider.ts` in full; the Hub's `config.json` of `unsloth/Qwen3.8-27B-NVFP4` at its current commit, in its own words. Done when `npm test` passes `src/webdocs.test.ts` and `src/docs.test.ts`.
2. **Failing tests.**
   - `src/harness/opencode.test.ts`: a provider that reads images gets the attachment and the modalities; one that does not gets neither.
   - `src/inference/huggingface.test.ts`: `vision` from `config.json`, with and without `vision_config`, with `language_model_only`, and on errors.
   - `src/inference/selfhosted.test.ts`: on vLLM, the handle says `vision` from the Hub, but not with `language-model-only: true`, on a created and a joined pod; on Ollama, from the status; a failed check gives none and logs it.
   - `src/gateway/pod.test.ts` or `src/gateway/gateway.test.ts`: the status reports `vision` from `/api/show`'s capabilities.

   Done when they fail on `HEAD` for the missing behavior.
   - **Done on 2026-10-28.** 11 tests fail on `HEAD`, 82 others pass. The gateway's test is in `src/gateway/pod.test.ts`, since `prepareOllama` reads `/api/show`; `src/inference/serverless.test.ts` checks the handle in `agentAccess`.
3. **Implementation.** `ModelHub.vision` in `src/inference/huggingface.ts`; `vision` in `PodHandle` and its decision in `PodInference.open`; `vision` in the gateway's status from `serveOllama`; `vision` through `agentAccess`, `modelAccess` and `HarnessOptions.provider` to `openCodeConfig`; the test fakes of `ModelHub`. Done when the tests pass and `npm run build` rebuilds `dist/`.
   - **Done on 2026-10-28.** The gateway reports it as the fit's `vision`, beside `family`, from the same `/api/show`: the status already carries the fit. `dist/index.js` and `dist/gateway.js` changed. The e2e fake Hugging Face serves no `config.json`, so the e2e suite's vLLM runs log that Codeman could not tell, and read text only, as its text-only model would anyway; the suite was not run.
4. **Docs.** `docs/settings/vllm.md` and `docs/settings/pod-engines.md`: `language-model-only` also keeps images from the agent; `docs/inference/pods.md`: what `open-key` tells the agent; `docs/development/dependencies.md`: the OpenCode configuration Codeman gives. Done when `npm run check` passes.
   - **Done on 2026-10-28.** A new section, [images](../settings/pod-engines.md#images), holds the rules; `pods.md`, `vllm.md`, `serverless.md`, `openrouter.md` and `dependencies.md` link to it. `npm run check` passes: 938 tests, 5 skipped.
5. **Check with OpenCode.** Run OpenCode 1.18.32 with the generated configuration against a local OpenAI-compatible server that records requests, and a `read` of a PNG: with `vision`, the request has an `image_url` part; without, the error text. Done when both are seen.
   - **Done on 2026-10-28,** with `opencode-darwin-x64@1.18.32` (its npm integrity checked), the configuration from `openCodeConfig`, and a 64×64 PNG. Both runs make 3 requests. In each, the tool result says "Image read successfully", and the image follows as a user message. With `vision`, that message has a `data:image/png;base64,…` `image_url` part; without it, the text `ERROR: Cannot read image (this model does not support image input). Inform the user.`
6. **Commits.** Commit on the `self-hosted-vision` branch, as authorized on 2026-10-28.
   - **Done on 2026-10-28.**

## Out of scope

- **Publishing and pinning new pod images.** Ollama's `vision` reaches pods only once images built from the new `dist/gateway.js` are pinned in `POD_IMAGES`, in a later commit. vLLM pods need no new image.
- **Runpod Serverless.** Nothing tells whether an endpoint's worker serves its model's vision tower, so Serverless models stay text only.
- **Images in the issue.** The agent gets the issue's text; images linked from it are not downloaded for it.
- **The gateway's 32 MB body limit.** OpenCode resizes images to at most 2000×2000 pixels and 5 MB of base64, and resends the history each turn: many large images in one session can exceed it.
