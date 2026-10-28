---
title: opencode: packages/opencode/src/provider/provider.ts at 545f51d
url: https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/provider/provider.ts
created_at: 2026-10-28T17:31:02-03:00
updated_at: 2026-10-28T17:31:02-03:00
tool: docs/web/tools/github-repositories.md
---

# opencode: packages/opencode/src/provider/provider.ts at 545f51d

What Codeman relies on, in its own words: the file is larger than the repository should hold (81 KB). Each fact names the function or section it comes from.

## A catalog model's capabilities

- `fromModelsDevModel` turns a models.dev catalog entry into OpenCode's model. Its `capabilities.attachment` is the entry's `attachment`, `false` when absent. Each of `capabilities.input.{text,audio,image,video,pdf}` is whether the entry's `modalities.input` lists it, `false` when it has no `modalities`.

## A model from the configuration

- The section commented "extend database from config" merges each provider of the configuration's `provider` into the catalog. A model of the configuration takes the catalog's model of the same ID as `existingModel`, when there is one.
- Its API package is the model's `provider.npm`, else the provider's `npm`, else the catalog's, else `@ai-sdk/openai-compatible`.
- Each capability is the configuration's value first, then `existingModel`'s, then a default:
  - `attachment`: default `false`;
  - `input.text`: default `true`; `input.image`, `input.audio`, `input.video`, `input.pdf`: default `false`, each set by whether `modalities.input` lists it;
  - `output.text`: default `true`; the other outputs default `false`.
- So a model the catalog does not list, configured without `modalities`, takes text only. A catalog model configured as `{}` keeps the catalog's capabilities.
