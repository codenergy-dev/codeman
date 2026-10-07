---
title: Firebase
url: https://firebase.google.com/docs
created_at: 2026-10-07T15:13:26-03:00
updated_at: 2026-10-07T15:13:26-03:00
---

# Firebase

How to record pages of Firebase's documentation, `firebase.google.com/docs`.

- **Source.** Each page answers as Markdown with `.md.txt` appended to its URL, such as `https://firebase.google.com/docs/firestore/quotas.md.txt`. `https://firebase.google.com/docs/llms.txt` lists pages with their Markdown URLs.
- **License.** As on [Google Cloud](google-cloud.md): each HTML page's footer licenses its content under the Creative Commons Attribution 4.0 License, except as otherwise noted, and code samples under the Apache 2.0 License. Check the HTML page for that sentence, then copy the page in full with `license: CC-BY-4.0`.
- **Title.** The HTML page's `<title>`, before the first `|`, such as "Usage and limits". Guides' Markdown sources do not start with it: add it as the page's first heading.

```sh
URL=https://firebase.google.com/docs/firestore/quotas
curl -fsSL "$URL" | grep -o '<title>[^<]*'
curl -fsSL "$URL" | grep -c 'creativecommons.org/licenses/by/4.0/'
curl -fsSL "$URL.md.txt"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
