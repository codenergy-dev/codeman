---
title: gcloud iam workload-identity-pools providers list
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/list
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam workload-identity-pools providers list

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam workload-identity-pools providers list (--workload-identity-pool=WORKLOAD_IDENTITY_POOL : --location=LOCATION) [--show-deleted] [--filter=EXPRESSION] [--limit=LIMIT] [--page-size=PAGE_SIZE] [--sort-by=[FIELD,…]] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Lists the providers of one pool: `--workload-identity-pool` and `--location` are required (REQUIRED FLAGS, EXAMPLES).
- `--show-deleted` includes soft-deleted providers (FLAGS).
- It takes the list flags `--filter`, `--limit`, `--page-size` and `--sort-by` (LIST COMMAND FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
