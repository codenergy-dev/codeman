---
title: opencode: packages/opencode/src/tool/shell/id.ts at 545f51d
url: https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/tool/shell/id.ts
created_at: 2026-10-20T18:52:25-03:00
updated_at: 2026-10-20T18:52:25-03:00
tool: docs/web/tools/github-repositories.md
license: MIT
---

# opencode: packages/opencode/src/tool/shell/id.ts at 545f51d

```ts
const kinds = ["bash", "pwsh", "powershell", "cmd"] as const
export type Kind = (typeof kinds)[number]

const shellKinds = new Set<string>(kinds)

function isKind(value: string): value is Kind {
  return shellKinds.has(value)
}

export function toKind(value: string): Kind {
  return isKind(value) ? value : "bash"
}

// Keep the exposed tool ID and permission key as "bash" for compatibility with
// existing plugins, users, and saved permissions. Rename with opencode 2.0.
export const ToolID = "bash"
export type ToolID = typeof ToolID

export * as ShellID from "./id"
```
