---
title: gcloud iam workload-identity-pools list
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/list
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam workload-identity-pools list

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam workload-identity-pools list --location=LOCATION [--show-deleted] [--filter=EXPRESSION] [--limit=LIMIT] [--page-size=PAGE_SIZE] [--sort-by=[FIELD,…]] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Lists a project's workload identity pools. `--location` is required; the examples use `global` (REQUIRED FLAGS, EXAMPLES).
- `--show-deleted` includes soft-deleted pools (FLAGS).
- It takes the list flags `--filter`, `--limit`, `--page-size` and `--sort-by` (LIST COMMAND FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
