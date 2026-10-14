---
title: gcloud projects get-iam-policy
url: https://docs.cloud.google.com/sdk/gcloud/reference/projects/get-iam-policy
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud projects get-iam-policy

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud projects get-iam-policy PROJECT_ID_OR_NUMBER [--filter=EXPRESSION] [--limit=LIMIT] [--page-size=PAGE_SIZE] [--sort-by=[FIELD,…]] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Prints a project's IAM policy; the project is named by its ID or number (DESCRIPTION, POSITIONAL ARGUMENTS).
- It takes the list flags `--filter`, `--limit`, `--page-size` and `--sort-by` (LIST COMMAND FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
