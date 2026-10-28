---
title: opencode: packages/opencode/src/provider/transform.ts at 545f51d
url: https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/provider/transform.ts
created_at: 2026-10-28T17:31:02-03:00
updated_at: 2026-10-28T17:31:02-03:00
tool: docs/web/tools/github-repositories.md
---

# opencode: packages/opencode/src/provider/transform.ts at 545f51d

What Codeman relies on, in its own words: the file is larger than the repository should hold (70 KB). Each fact names the function it comes from.

## Media a model cannot read

- `message` passes every request's messages through `unsupportedParts` first.
- `unsupportedParts` looks only at user messages whose content is a list of parts. For each `image` or `file` part, `mimeToModality` maps its media type: `image/*` to `image`, `audio/*` to `audio`, `video/*` to `video`, `application/pdf` to `pdf`.
- When the model's `capabilities.input` has that modality, the part is kept. Otherwise it is replaced by the text `ERROR: Cannot read <name> (this model does not support <modality> input). Inform the user.`, where `<name>` is the file's name in quotes, or the modality.
- An image part whose base64 data is empty becomes `ERROR: Image file is empty or corrupted. Please provide a valid image.`
