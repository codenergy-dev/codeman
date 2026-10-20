---
title: opencode: packages/opencode/script/generate.ts at 545f51d
url: https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/script/generate.ts
created_at: 2026-10-20T18:52:25-03:00
updated_at: 2026-10-20T18:52:25-03:00
tool: docs/web/tools/github-repositories.md
license: MIT
---

# opencode: packages/opencode/script/generate.ts at 545f51d

```ts
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())
console.log("Loaded models.dev snapshot")
```
