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
| `actions/checkout` | v7.0.1 | CI |
| `actions/setup-node` | v7.0.0 | CI |
| `actions/create-github-app-token` | v3.2.0 | Target repository workflow |

## Agent harness: OpenCode

Not added yet. The version is pinned when the harness is integrated.

- **Choice:** OpenCode v1 (`opencode-ai`, latest audited: 1.18.32). MIT; repository [anomalyco/opencode](https://github.com/anomalyco/opencode); very active, with near-daily releases.
- **v2** (`@opencode/cli`, 2.0.x) was not adopted: it is a preview, has no tagged GitHub releases, and the published binaries cannot be traced to a source commit. Re-evaluate it once it becomes the main release.
- **Distribution:** an npm package whose `postinstall` selects a per-platform package containing one compiled binary (about 185 MB). No npm provenance attestation, only registry signatures.
- **Known vulnerabilities:**
  - CVE-2026-22812 (high): unauthenticated local HTTP server allowed command execution. Fixed in 1.0.216.
  - CVE-2026-22813 (critical): XSS in the web UI. Fixed in 1.1.10.
  - CVE-2026-88624 (critical): path traversal in `DELETE /experimental/worktree`, reported for 1.18.26 and earlier. No fixed version was published at the time of the audit. Confirm a fixed version before pinning.
- **Permissions:** runs any shell command as the runner user. Its permission system is not a sandbox, and most permissions default to `allow`. It loads configuration and plugins from `opencode.json` and `.opencode/` in the repository.

How Codeman must use it:

1. Download the platform package from the npm registry and verify its pinned `sha512` integrity. Never run the `postinstall` script.
2. Pass configuration through `OPENCODE_CONFIG_CONTENT`: `autoupdate: false`, `share: "disabled"`, only the `openrouter` provider, and `deny` for `webfetch`, `websearch`, `external_directory` and `question`.
3. Reject patches that change `opencode.json` or `.opencode/`.
4. Run it in a job whose `GITHUB_TOKEN` is read-only and whose only secret is the budget-capped OpenRouter key.
5. Call it as a child process (`opencode run --format json`); do not add `@opencode-ai/sdk`.
