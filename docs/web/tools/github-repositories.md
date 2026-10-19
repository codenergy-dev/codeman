---
title: GitHub repositories
url: https://github.com
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
---

# GitHub repositories

How to record files and issues of public repositories on GitHub that are not documentation sites, such as `actions/runner-images` (the hosted runners' images) and the source of an action such as `actions/checkout`.

- **Commit.** Record files at a full commit SHA, never a branch: `https://api.github.com/repos/<owner>/<repo>/commits/main` gives the current one. The action a workflow pins is recorded at the SHA it pins.
- **License.** Read the `LICENSE` file at the same commit. Under MIT or Apache-2.0, copy each file in full, inside a fenced code block of its language, with that license in `license`.
- **Source.** `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. The `url` is the file's page at the commit: `https://github.com/<owner>/<repo>/blob/<sha>/<path>`.
- **Title.** The repository's name, the file's path or name, and the SHA's first seven characters, such as "runner-images: configure-system.sh at 82d1b86".
- **Size.** A file over roughly 30 KB is recorded in your own words: only what the repository relies on, each fact naming the function or section it comes from, without `license`.
- **Issues.** An issue's text belongs to its author and has no license, so record it in your own words, without `license`. Its title is the issue's title. Read it, and its comments at `/comments` after that URL, from `https://api.github.com/repos/<owner>/<repo>/issues/<number>`, and note its state and dates: an issue reports one image version, not every one.

```sh
SHA=$(curl -fsS https://api.github.com/repos/actions/runner-images/commits/main | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["sha"])')
curl -fsS "https://raw.githubusercontent.com/actions/runner-images/$SHA/LICENSE" | head -1
curl -fsS "https://raw.githubusercontent.com/actions/runner-images/$SHA/images/ubuntu/scripts/build/configure-system.sh"
curl -fsS https://api.github.com/repos/actions/runner-images/issues/11414
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
