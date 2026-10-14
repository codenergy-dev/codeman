---
title: gcloud services list
url: https://docs.cloud.google.com/sdk/gcloud/reference/services/list
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud services list

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud services list [--available | --enabled] [--filter=EXPRESSION] [--limit=LIMIT] [--page-size=PAGE_SIZE; default=200] [--sort-by=[FIELD,…]] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Lists the services a project has enabled (`--enabled`, the default) or can enable (`--available`) (DESCRIPTION, FLAGS).
- The examples name the project with `--project` (EXAMPLES).
- It takes the list flags `--filter`, `--limit`, `--page-size` and `--sort-by` (LIST COMMAND FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
