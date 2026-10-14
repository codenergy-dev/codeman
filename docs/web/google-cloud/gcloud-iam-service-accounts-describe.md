---
title: gcloud iam service-accounts describe
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/describe
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam service-accounts describe

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam service-accounts describe SERVICE_ACCOUNT [GCLOUD_WIDE_FLAG …]
```

## Facts

- Prints a service account's metadata. The account is named by its email or by its numeric ID (POSITIONAL ARGUMENTS, EXAMPLES).
- An account that does not exist gives a `PERMISSION_DENIED` error, as does one the caller may not read (DESCRIPTION).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
