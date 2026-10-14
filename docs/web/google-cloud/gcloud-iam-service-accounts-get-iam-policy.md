---
title: gcloud iam service-accounts get-iam-policy
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/get-iam-policy
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam service-accounts get-iam-policy

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam service-accounts get-iam-policy SERVICE_ACCOUNT [--filter=EXPRESSION] [--limit=LIMIT] [--page-size=PAGE_SIZE] [--sort-by=[FIELD,…]] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Prints the IAM policy of a service account treated as a resource: the bindings on the account itself, not the roles the account holds elsewhere; a project's policy is read with the `gcloud projects` commands (DESCRIPTION).
- The output includes an `etag`, which identifies the version of the policy (DESCRIPTION).
- An account that does not exist gives a `PERMISSION_DENIED` error (DESCRIPTION).
- The account is named by its email or by its numeric ID (POSITIONAL ARGUMENTS).
- It takes the list flags `--filter`, `--limit`, `--page-size` and `--sort-by` (LIST COMMAND FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
