# Dependencies

Every dependency is audited before it is added (see `AGENTS.md`). This page records what is used, why, and the result of the last audit. Update it whenever a dependency is added, removed or upgraded.

Last audit: 2026-09-23; self-hosted inference: 2026-10-03; backend: 2026-10-07. `npm audit` reported no known vulnerabilities.

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
| `actions/checkout` | v7.0.1 | CI, pod image, target repository workflow |
| `actions/setup-node` | v7.0.0 | CI |
| `actions/create-github-app-token` | v3.2.0 | Target repository workflow |
| `actions/upload-artifact` | v7.0.1 | Target repository workflow |
| `actions/download-artifact` | v8.0.1 | Target repository workflow |

## External services

Codeman calls these APIs with `fetch` or through the packages above. Their documentation is kept in [`docs/web/`](../web/), with how each page was fetched.

| Service | Used for | Pages |
| --- | --- | --- |
| GitHub REST and GraphQL APIs | Issues, labels, comments, pull requests and reviews, commits through the Git Data API, contents, collaborators' permissions, Actions runs, jobs, logs and artifacts, App installation tokens, and marking a pull request ready | [`docs/web/github/`](../web/github/) |
| OpenRouter API | Task keys (list, create, get, disable) and analytics (tokens, requests, throughput, largest prompt) | [`docs/web/openrouter/`](../web/openrouter/) |
| npm registry | Downloading the harness's pinned package and checking its integrity | [`docs/web/npm/`](../web/npm/) |
| OpenCode | The harness's configuration, permissions, providers and `run` command | [`docs/web/opencode/`](../web/opencode/) |
| Runpod REST API v2 | Self-hosted inference: pods (create, get, list, terminate), Serverless endpoints (get; and the job queue: run, stream, cancel), GPU prices, and billing (account, pods) | [`docs/web/runpod/`](../web/runpod/) |
| Ollama | The engine in Codeman's pod image: pulling a model, its context length, and its OpenAI-compatible API | [`docs/web/ollama/`](../web/ollama/) |
| Cloud Firestore REST API v1 | The backend: documents read (`batchGet`, `runQuery`), written (`commit`) and in transactions (`beginTransaction`, `rollback`); its emulator, in tests; security rules, quotas and billing | [`docs/web/google-cloud/`](../web/google-cloud/), [`docs/web/firebase/`](../web/firebase/) |
| Google's Security Token Service and IAM Credentials | The backend's access: the job's OIDC token exchanged for a federated token (`token`), then for the service account's (`generateAccessToken`), through Workload Identity Federation | [`docs/web/google-cloud/`](../web/google-cloud/) |
| GitHub Actions' OIDC provider | Each backend job's OIDC token, through `getIDToken` of `@actions/core` | [`docs/web/github/`](../web/github/) |

## Agent harness: OpenCode

- **Version:** OpenCode v1 1.18.32 (`opencode-ai`), pinned in [`src/harness/opencode.ts`](../../src/harness/opencode.ts) with the npm `dist.integrity` of each platform package (`opencode-linux-x64`, `opencode-linux-arm64`). MIT; repository [anomalyco/opencode](https://github.com/anomalyco/opencode); very active, with near-daily releases.
- **v2** (`@opencode/cli`, 2.0.x) was not adopted: it is a preview, has no tagged GitHub releases, and the published binaries cannot be traced to a source commit. Re-evaluate it once it becomes the main release.
- **Distribution:** the `opencode-ai` npm package runs a `postinstall` script that selects a per-platform package containing one compiled binary (about 185 MB). Codeman skips that package and its script: it downloads the platform package from the npm registry and checks its integrity before extracting it. There is no npm provenance attestation, only registry signatures.
- **Known vulnerabilities:**
  - CVE-2026-22812 (high): unauthenticated local HTTP server allowed command execution. Fixed in 1.0.216.
  - CVE-2026-22813 (critical): XSS in the web UI. Fixed in 1.1.10.
  - CVE-2026-88624 (critical): path traversal in the local server's `DELETE /experimental/worktree`, reported for 1.18.26 and earlier. No fixed version existed on 2026-09-24. Accepted for 1.18.32: only the agent, which already runs shell commands in a sandbox with no write token, can reach that server. Upgrade once a fix ships.
- **Permissions:** it runs any shell command as the user that starts it. Its permission system is not a sandbox, and most permissions default to `allow`. It loads configuration and plugins from `opencode.json` and `.opencode/` in the repository.

How Codeman uses it:

1. It runs as the unprivileged `codeman-agent` user (see [agent sandbox](../runs/agent.md#agent-sandbox)).
2. Configuration goes through `OPENCODE_CONFIG_CONTENT`, which overrides the repository's: `autoupdate: false`, `share: "disabled"`, only the `openrouter` provider, and `deny` for `webfetch`, `websearch`, `external_directory`, `question` and `doom_loop`. No permission is left as `ask`, because nobody is there to answer.
3. The apply job accepts only the files a stage allows (the plan, while planning), so the agent cannot change `opencode.json` or `.opencode/`.
4. It is called as a child process (`opencode run --format json`); `@opencode-ai/sdk` is not used.

## Self-hosted inference

Audited on 2026-10-03 for the [self-hosted inference plan](../plans/2026-10-02-self-hosted-inference.md). No npm package is added: the Runpod API is called with `fetch`, and the gateway uses only Node's built-in modules.

### Runpod

- **What:** a GPU cloud billed per second, with pods (a container on a GPU, billed while it exists) and Serverless endpoints (workers started on demand, billed while they run). Codeman uses the REST API v2 (`https://api.runpod.io/v2`); v1, which the plan first named, is deprecated and retired on 2026-11-15 ([migrate from API v1](../web/runpod/migrate-from-api-v1.md)).
- **Why:** it serves the GPU for the `runpod-pod` and `runpod-serverless` providers. A small in-house replacement is not possible: it is the hardware.
- **Data:** the agent's prompts, and so the repository's code, go to a container on Runpod. Codeman creates pods on Secure Cloud only, which runs in certified data centers of vetted partners ([data security](../web/runpod/data-security-and-legal-compliance.md)). A Serverless endpoint does not report its cloud ([get a Serverless endpoint](../web/runpod/get-a-serverless-endpoint.md)); the maintainer who creates it chooses.
- **Credentials:** API keys are **All**, **Restricted** or **Read Only**; a restricted key can be limited to one Serverless endpoint, but no key expires or has a spending limit ([manage credentials](../web/runpod/manage-credentials.md)). Codeman uses two: an account key in the jobs that manage pods and read billing, which run no LLM, and, for Serverless, a key restricted to the endpoint, held by the agent job's gateway, outside the sandbox.
- **Spending:** the account spends prepaid credits; at US$ 0 Runpod stops every pod, and terminates those without a network volume ([billing overview](../web/runpod/billing-overview.md)). An account without auto-pay therefore caps what Codeman can spend there.
- **Terms:** the console's terms apply; Runpod's terms forbid hosts to inspect a pod's data.

### Ollama

- **What and why:** the inference engine in Codeman's pod image. It pulls a model by name and serves an OpenAI-compatible API ([OpenAI compatibility](../web/ollama/openai-compatibility.md)). MIT, [ollama/ollama](https://github.com/ollama/ollama), very active (releases every few days).
- **Version:** 0.35.1, from its official image `ollama/ollama`, pinned by digest (`sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c`, the multi-platform index) in [`docker/pod/Dockerfile`](../../docker/pod/Dockerfile).
- **Known vulnerabilities** (OSV, 2026-10-03): path traversal (CVE-2024-37032, fixed in 0.1.34; CVE-2026-7020, reported up to 0.20.2), file deletion and archive extraction outside its directory (fixed in 0.1.34 and 0.1.47), out-of-bounds reads in model loading (CVE-2026-7482, fixed in 0.17.1), several denials of service, a token leak to a malicious registry during `pull` (CVE-2025-51471, reported up to 0.9.6), and an API without authentication (CVE-2025-63389). Accepted for 0.35.1: its API listens only on the pod's loopback, behind Codeman's gateway, which forwards only the OpenAI-compatible routes, and Codeman pulls models only from Ollama's own registry.
- **Permissions:** it runs as root in the pod's container, which holds nothing but the model and the gateway.

### Runpod's vLLM worker

- **What and why:** Runpod's official Serverless worker, [runpod-workers/worker-vllm](https://github.com/runpod-workers/worker-vllm), running vLLM. Codeman sends it OpenAI-compatible requests as jobs, `{"openai_route": ..., "openai_input": ...}`, the shape Runpod's own OpenAI-compatible route sends ([`src/handler.py`](https://github.com/runpod-workers/worker-vllm/blob/v2.28.0/src/handler.py) at v2.28.0); a streamed request's output is vLLM's own events. MIT, maintained by Runpod, released weekly (v2.28.0 on 2026-09-28).
- **How:** a maintainer chooses it, pinned to a release image (`runpod/worker-v1-vllm:<version>`), when creating the endpoint in Runpod's console. Codeman never runs it and does not install it; it checks the endpoint's settings when a run opens.

### Codeman's pod image

- Built by [`.github/workflows/pod-image.yml`](../../.github/workflows/pod-image.yml) from [`docker/pod/Dockerfile`](../../docker/pod/Dockerfile) when either changes, or `dist/gateway.js`: Ollama's image, the `node` binary of `node:24.21.0-bookworm-slim` (pinned by digest, `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`), and the gateway, `dist/gateway.js`, bundled from [`src/gateway/`](../../src/gateway/) with Node's modules only. CI checks that `dist/` matches the source, so the image needs no npm install.
- Published to GitHub's container registry as `ghcr.io/<owner>/codeman-pod`, and referenced by digest in [`src/inference/ollama.ts`](../../src/inference/ollama.ts) by a reviewed commit, never by tag.
- The workflow uses only `actions/checkout` (pinned) and the runner's `docker`, with `packages: write` and `contents: read`.

## Backend

Audited on 2026-10-07 for the [backend plan](../plans/2026-10-07-firestore-backend.md). No npm package is added (decision 2): Firestore's REST API, STS and IAM Credentials are called with `fetch`, and GitHub's OIDC token comes from `@actions/core`, already a dependency. `firebase-admin` and `@google-cloud/firestore` were not adopted: each brings a large tree (gRPC, Google's auth library) for the few calls Codeman makes.

### Cloud Firestore, in a Firebase project

- **What:** Google's managed document database, with transactions and a free daily quota, reached over HTTPS ([usage and limits](../web/firebase/usage-and-limits.md)). Codeman uses the project's `(default)` database, Standard edition, in Native mode.
- **Why:** what jobs share across runs and repositories, atomically: the ledger now, budget reservations, pod leases and endpoints' intervals next. GitHub cannot hold it, and the responsible person wants no Codeman service to host.
- **Data:** Codeman's records of runs (repository and task numbers, stages, models, limits, costs, tokens, pods) and events. No secret, no code, no issue text.
- **Credentials:** none stored. Jobs act as a service account through Workload Identity Federation ([deployment pipelines](../web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md)); the service account has only Cloud Datastore User (`roles/datastore.user`, [IAM roles](../web/firebase/identity-and-access-management-iam.md)), and its tokens last an hour, scoped to Firestore. The security rules deny every client ([rules](../web/firebase/get-started-with-cloud-firestore-security-rules.md)).
- **Spending:** none within the free quota ([cost](../backend/backend.md)), which applies to one database per project ([billing](../web/firebase/understand-cloud-firestore-billing.md)); a project without a billing account cannot go beyond it.
- **Terms:** Google Cloud's and Firebase's terms; Google's documentation is CC BY 4.0, so the pages in `docs/web/` are copies.

### Firestore's emulator

Only for Codeman's tests, on a developer's machine: the contract tests run against it when it is there ([development](guide.md)). It is Google's `cloud-firestore-emulator` jar, which the Firebase CLI downloads into `~/.cache/firebase/emulators/`, and runs on Java 21. Codeman neither installs nor downloads it, and CI does not run it.
