---
title: "node: README.md at 955266b"
url: https://github.com/nodejs/node/blob/955266bfdd854cd280dffd47548673914484e4c0/README.md
created_at: 2026-10-30T11:52:39-03:00
updated_at: 2026-10-30T11:52:39-03:00
tool: docs/web/tools/github-repositories.md
---

# node: README.md at 955266b

Node.js's README at the commit of the tag `v24.21.0`, in Codeman's words: the file is over 30 KB. Node.js is under the MIT license.

## Downloads

- Releases, Current and LTS, are in `https://nodejs.org/download/release/`, one directory per version ("Current and LTS releases", under "Download"); `https://nodejs.org/dist/<version>/`, such as `https://nodejs.org/dist/v24.21.0/`, serves the same files.
- A member of the Release Team signs each Current and LTS release ("Release types").

## Verifying binaries

- Each download directory has `SHASUMS256.txt.asc`: the SHA-256 of each of its files, signed with the releaser's PGP key. The release keys are in [nodejs/release-keys](https://github.com/nodejs/release-keys), as a keyring at `gpg/pubring.kbx` ("Verifying binaries").
- The README verifies with `gpgv --keyring=<keyring> --output SHASUMS256.txt < SHASUMS256.txt.asc`, then `shasum --check SHASUMS256.txt --ignore-missing` ("Verifying binaries"). `SHASUMS256.txt` without `.asc` is the same list, unsigned.
