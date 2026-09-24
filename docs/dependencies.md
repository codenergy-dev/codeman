# Dependencies

Every dependency is audited before it is added (see `AGENTS.md`). This page records what is used, why, and the result of the last audit. Update it whenever a dependency is added, removed or upgraded.

Last audit: 2026-09-23. `npm audit` reported no known vulnerabilities.

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
