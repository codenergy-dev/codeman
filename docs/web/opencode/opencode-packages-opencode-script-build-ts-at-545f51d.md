---
title: "opencode: packages/opencode/script/build.ts at 545f51d"
url: https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/script/build.ts
created_at: 2026-10-20T18:52:42-03:00
updated_at: 2026-10-20T18:52:42-03:00
tool: docs/web/tools/github-repositories.md
---

# opencode: packages/opencode/script/build.ts at 545f51d

Only what Codeman's e2e suite relies on.

## The models snapshot

- The build imports `./generate.ts` and passes its `modelsData` as the define `OPENCODE_MODELS_DEV` (the `define` of the compile step). So a released binary holds a snapshot of the models catalog, taken when it was built.
- `generate.ts` reads that snapshot from `MODELS_DEV_API_JSON`, a file, or else fetches `${OPENCODE_MODELS_URL || "https://models.dev"}/api.json` at build time ([generate.ts](opencode-packages-opencode-script-generate-ts-at-545f51d.md)).
- At run time, `ModelsDev` loads the cache file first, then this snapshot, and fetches only when both are missing; its background refresh fetches unless `OPENCODE_DISABLE_MODELS_FETCH` is set ([models-dev.ts](opencode-packages-core-src-models-dev-ts-at-545f51d.md)).
