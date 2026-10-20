---
title: "opencode: packages/opencode/src/session/prompt.ts at 545f51d"
url: https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/session/prompt.ts
created_at: 2026-10-20T18:52:42-03:00
updated_at: 2026-10-20T18:52:42-03:00
tool: docs/web/tools/github-repositories.md
---

# opencode: packages/opencode/src/session/prompt.ts at 545f51d

The file is about 65 KB, so this page holds only what Codeman's e2e suite relies on.

## The title request (`SessionPrompt.ensureTitle`)

- It runs once per session: not for a subagent's session (`parentID`), not when the session already has a title other than the default, and only while the history holds exactly one user message that is not synthetic.
- The loop starts it on its first step (`step === 1`), forked, so it runs alongside the first request of the agent's own loop.
- The model is the `title` agent's, else the provider's small model (`provider.getSmallModel`), else the session's model.
- The request has no system prompt from the session (`system: []`), no tools (`tools: {}`), `small: true` and 2 retries. Its messages are a user message `Generate a title for this conversation:\n`, then the conversation up to the first user message.
- OpenCode keeps the first non-empty line of the text, after removing `<think>` blocks, cut to 100 characters. A failure is logged and ignored.
