---
title: gh api
url: https://cli.github.com/manual/gh_api
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/github-cli.md
---

# gh api

The manual's pages have no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from. Checked against release v2.102.0, the latest when recorded.

## Facts

- Makes an authenticated request to GitHub's API and prints the response; the endpoint is a path of the REST API, or `graphql` (description).
- The method is `GET`, or `POST` when the request has parameters; `-X`, `--method` sets another, such as `PUT` (description, Options).
- `-q`, `--jq` filters the JSON response with a jq expression; `--paginate` requests every page of results (Options).
