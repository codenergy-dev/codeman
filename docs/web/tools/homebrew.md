---
title: Homebrew
url: https://brew.sh
created_at: 2026-10-19T14:31:27-03:00
updated_at: 2026-10-19T14:31:27-03:00
---

# Homebrew

How to record what Homebrew installs and how it checks it: a formula's metadata, and Homebrew's own documentation.

- **Formula.** `https://formulae.brew.sh/api/formula/<name>.json` gives a formula's version, its source URL and SHA-256, its license, and the SHA-256 of each bottle. It is data with no license: record it in your own words, without `license`, titled "Formula <name>", with the formula's page as `url` (`https://formulae.brew.sh/formula/<name>`).
- **Installed version.** `brew info <name>` and `<Cellar>/<name>/<version>/INSTALL_RECEIPT.json` say which version is installed and whether it was poured from a bottle. Note them in the page that relies on them; they describe one machine.
- **Documentation.** Homebrew's documentation, `docs.brew.sh`, is built from `docs/` in [Homebrew/brew](https://github.com/Homebrew/brew), licensed BSD-2-Clause (`LICENSE.txt`). Record a file at a full commit SHA, from `https://raw.githubusercontent.com/Homebrew/brew/<sha>/docs/<file>.md`, titled "brew: docs/<file>.md at <short sha>", with its page at the commit as `url`. Copy it in full with `license: BSD-2-Clause`; over roughly 30 KB, in your own words without `license`, each fact naming its section.

```sh
curl -fsS https://formulae.brew.sh/api/formula/act.json | jq '{versions, license, urls: .urls.stable, bottles: .bottle.stable.files | map_values(.sha256)}'
SHA=$(curl -fsS https://api.github.com/repos/Homebrew/brew/commits/main | jq -r .sha)
curl -fsS "https://raw.githubusercontent.com/Homebrew/brew/$SHA/docs/Bottles.md"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
