---
title: "brew: docs/Homebrew-Security-and-Supply-Chain.md at 41f40de"
url: https://github.com/Homebrew/brew/blob/41f40decfa0789cff312806606757300bb8bd1c3/docs/Homebrew-Security-and-Supply-Chain.md
created_at: 2026-10-19T14:32:43-03:00
updated_at: 2026-10-19T14:32:43-03:00
tool: docs/web/tools/homebrew.md
---

# brew: docs/Homebrew-Security-and-Supply-Chain.md at 41f40de

The file is over 30 KB, so this page holds, in Codeman's words, only what Codeman relies on: how a bottle installed from `homebrew/core` is checked. The file was last reviewed on 2026-09-19 (front matter).

- **Checksums** ("Checksummed downloads pinned in reviewed metadata"): each download's SHA-256 is in the formula, changed only by a reviewed pull request. Homebrew refuses a download that does not match.
- **Signed metadata** ("Signed JSON API metadata"): by default Homebrew installs from its JSON API, whose files, `formula.jws.json` among them, are JWS-signed and verified before use. `HOMEBREW_NO_INSTALL_FROM_API` opts out.
- **Bottles** ("Bottles built by Homebrew"): Homebrew's CI builds each bottle from source, on an ephemeral runner, from the reviewed formula; the formula holds the bottle's SHA-256.
- **Provenance** ("Bottle provenance attestations"): CI emits build-provenance attestations with `actions/attest`, logged in Sigstore. Homebrew verifies them only when `HOMEBREW_VERIFY_ATTESTATIONS` is set, with the `gh` tool.
