# Dependencies

Every dependency is audited before it is added (see `AGENTS.md`). This page records what is used, why, and the result of the last audit. Update it whenever a dependency is added, removed or upgraded.

Last audit: 2026-09-23; self-hosted inference: 2026-10-03. `npm audit` reported no known vulnerabilities.

## Runtime

Bundled into `dist/index.js`. They run with the GitHub App token.

| Package | Version | Purpose | Notes |
| --- | --- | --- | --- |
| `@actions/core` | 3.0.1 | Inputs, logging, failure reporting | Maintained by GitHub, MIT. |
| `@actions/github` | 9.1.1 | Authenticated Octokit client with pagination | Maintained by GitHub, MIT. |

Together they add 26 packages, all from the `@actions` and `@octokit` projects plus `undici`, `tunnel`, `before-after-hook`, `universal-user-agent`, `content-type` and `json-with-bigint`. None has install scripts.

## Development

| Package | Version | Purpose | Notes |
| --- | --- | --- | --- |
| `typescript` | 6.0.3 | Type checking | 7.x is not supported by the lint ecosystem yet. |
| `@types/node` | 24.13.6 | Node.js types | Node 24 is the Actions runtime (`node24`). |
| `esbuild` | 0.28.2 | Bundles `dist/index.js` | Its install script only verifies the binary; not needed. |
| `@biomejs/biome` | 2.5.14 | Lint and format | Single binary, no transitive dependencies. Chosen over ESLint + typescript-eslint (95 packages). |

Tests use the built-in `node:test` runner; Node 24 runs TypeScript directly.

`.npmrc` sets `ignore-scripts=true` (no install scripts run) and `save-exact=true` (exact versions). `package-lock.json` is committed.

## GitHub Actions

Pinned to full commit SHAs.

| Action | Version | Used in |
| --- | --- | --- |
| `actions/checkout` | v7.0.1 | CI, target repository workflow |
| `actions/setup-node` | v7.0.0 | CI |
| `actions/create-github-app-token` | v3.2.0 | Target repository workflow |
| `actions/upload-artifact` | v7.0.1 | Target repository workflow |
| `actions/download-artifact` | v8.0.1 | Target repository workflow |

## External services

Codeman calls these APIs with `fetch` or through the packages above. Their documentation is kept in [`docs/web/`](web/), with how each page was fetched.

| Service | Used for | Pages |
| --- | --- | --- |
| GitHub REST and GraphQL APIs | Issues, labels, comments, pull requests and reviews, commits through the Git Data API, contents, collaborators' permissions, Actions runs, jobs, logs and artifacts, App installation tokens, and marking a pull request ready | [`docs/web/github/`](web/github/) |
| OpenRouter API | Task keys (list, create, get, disable) and analytics (tokens, requests, throughput, largest prompt) | [`docs/web/openrouter/`](web/openrouter/) |
| npm registry | Downloading the harness's pinned package and checking its integrity | [`docs/web/npm/`](web/npm/) |
| OpenCode | The harness's configuration, permissions, providers and `run` command | [`docs/web/opencode/`](web/opencode/) |
| Runpod REST API v2 | Self-hosted inference: pods (create, get, list, terminate), Serverless endpoints (get), GPU prices, and billing (account, pods) | [`docs/web/runpod/`](web/runpod/) |
| Ollama | The engine in Codeman's pod image: pulling a model, its context length, and its OpenAI-compatible API | [`docs/web/ollama/`](web/ollama/) |

## Agent harness: OpenCode

- **Version:** OpenCode v1 1.18.32 (`opencode-ai`), pinned in [`src/harness/opencode.ts`](../src/harness/opencode.ts) with the npm `dist.integrity` of each platform package (`opencode-linux-x64`, `opencode-linux-arm64`). MIT; repository [anomalyco/opencode](https://github.com/anomalyco/opencode); very active, with near-daily releases.
- **v2** (`@opencode/cli`, 2.0.x) was not adopted: it is a preview, has no tagged GitHub releases, and the published binaries cannot be traced to a source commit. Re-evaluate it once it becomes the main release.
- **Distribution:** the `opencode-ai` npm package runs a `postinstall` script that selects a per-platform package containing one compiled binary (about 185 MB). Codeman skips that package and its script: it downloads the platform package from the npm registry and checks its integrity before extracting it. There is no npm provenance attestation, only registry signatures.
- **Known vulnerabilities:**
  - CVE-2026-22812 (high): unauthenticated local HTTP server allowed command execution. Fixed in 1.0.216.
  - CVE-2026-22813 (critical): XSS in the web UI. Fixed in 1.1.10.
  - CVE-2026-88624 (critical): path traversal in the local server's `DELETE /experimental/worktree`, reported for 1.18.26 and earlier. No fixed version existed on 2026-09-24. Accepted for 1.18.32: only the agent, which already runs shell commands in a sandbox with no write token, can reach that server. Upgrade once a fix ships.
- **Permissions:** it runs any shell command as the user that starts it. Its permission system is not a sandbox, and most permissions default to `allow`. It loads configuration and plugins from `opencode.json` and `.opencode/` in the repository.

How Codeman uses it:

1. It runs as the unprivileged `codeman-agent` user (see [architecture](architecture.md#agent-sandbox)).
2. Configuration goes through `OPENCODE_CONFIG_CONTENT`, which overrides the repository's: `autoupdate: false`, `share: "disabled"`, only the `openrouter` provider, and `deny` for `webfetch`, `websearch`, `external_directory`, `question` and `doom_loop`. No permission is left as `ask`, because nobody is there to answer.
3. The apply job accepts only the files a stage allows (the plan, while planning), so the agent cannot change `opencode.json` or `.opencode/`.
4. It is called as a child process (`opencode run --format json`); `@opencode-ai/sdk` is not used.

## Self-hosted inference

Audited on 2026-10-03 for the [self-hosted inference plan](plans/2026-10-02-self-hosted-inference.md). No npm package is added: the Runpod API is called with `fetch`, and the gateway uses only Node's built-in modules.

### Runpod

- **What:** a GPU cloud billed per second, with pods (a container on a GPU, billed while it exists) and Serverless endpoints (workers started on demand, billed while they run). Codeman uses the REST API v2 (`https://api.runpod.io/v2`); v1, which the plan first named, is deprecated and retired on 2026-11-15 ([migrate from API v1](web/runpod/migrate-from-api-v1.md)).
- **Why:** it serves the GPU for `inference: self-hosted`. A small in-house replacement is not possible: it is the hardware.
- **Data:** the agent's prompts, and so the repository's code, go to a container on Runpod. Codeman creates pods on Secure Cloud only, which runs in certified data centers of vetted partners ([data security](web/runpod/data-security-and-legal-compliance.md)). A Serverless endpoint does not report its cloud ([get a Serverless endpoint](web/runpod/get-a-serverless-endpoint.md)); the maintainer who creates it chooses.
- **Credentials:** API keys are **All**, **Restricted** or **Read Only**; a restricted key can be limited to one Serverless endpoint, but no key expires or has a spending limit ([manage credentials](web/runpod/manage-credentials.md)). Codeman uses two: an account key in the jobs that manage pods and read billing, which run no LLM, and, for Serverless, a key restricted to the endpoint, held by the agent job's gateway, outside the sandbox.
- **Spending:** the account spends prepaid credits; at US$ 0 Runpod stops every pod, and terminates those without a network volume ([billing overview](web/runpod/billing-overview.md)). An account without auto-pay therefore caps what Codeman can spend there.
- **Terms:** the console's terms apply; Runpod's terms forbid hosts to inspect a pod's data.

### Ollama

- **What and why:** the inference engine in Codeman's pod image. It pulls a model by name and serves an OpenAI-compatible API ([OpenAI compatibility](web/ollama/openai-compatibility.md)). MIT, [ollama/ollama](https://github.com/ollama/ollama), very active (releases every few days).
- **Version:** 0.35.1, from its official image `ollama/ollama`, pinned by digest (`sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c`, the multi-platform index), in Codeman's pod image.
- **Known vulnerabilities** (OSV, 2026-10-03): path traversal (CVE-2024-37032, fixed in 0.1.34; CVE-2026-7020, reported up to 0.20.2), file deletion and archive extraction outside its directory (fixed in 0.1.34 and 0.1.47), out-of-bounds reads in model loading (CVE-2026-7482, fixed in 0.17.1), several denials of service, a token leak to a malicious registry during `pull` (CVE-2025-51471, reported up to 0.9.6), and an API without authentication (CVE-2025-63389). Accepted for 0.35.1: its API listens only on the pod's loopback, behind Codeman's gateway, which forwards only the OpenAI-compatible routes, and Codeman pulls models only from Ollama's own registry.
- **Permissions:** it runs as root in the pod's container, which holds nothing but the model and the gateway.

### Runpod's vLLM worker

- **What and why:** Runpod's official Serverless worker, [runpod-workers/worker-vllm](https://github.com/runpod-workers/worker-vllm), running vLLM, with an OpenAI-compatible route ([OpenAI API compatibility](web/runpod/openai-api-compatibility.md)). MIT, maintained by Runpod, released weekly (v2.28.0 on 2026-09-28).
- **How:** a maintainer chooses it, pinned to a release image (`runpod/worker-v1-vllm:<version>`), when creating the endpoint in Runpod's console. Codeman never runs it and does not install it; it checks the endpoint's settings when a run opens.
