---
title: gcloud topic filters
url: https://docs.cloud.google.com/sdk/gcloud/reference/topic/filters
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud topic filters

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Facts

- `--filter` selects the resources a command prints with a Boolean expression of terms on resource keys (DESCRIPTION, Filter Expressions).
- `key:pattern` matches when the pattern matches a word of the key's value; the page says its evaluation is changing, and the deprecated default matches when the value contains the pattern. `key=value` tests equality for most APIs (Filter Expressions, Operator Terms).
- A filter works on the resources at the root of the output. To filter the items of a nested list, `--flatten` names the list; the page's example lists the members that hold a role in a project: `gcloud projects get-iam-policy cloudsdktest --flatten=bindings --filter=bindings.role:roles/editor --format='value(bindings.members)'` (Filter on a custom or nested list in response).
