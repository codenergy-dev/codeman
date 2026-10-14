---
title: gcloud iam service-accounts add-iam-policy-binding
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/add-iam-policy-binding
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam service-accounts add-iam-policy-binding

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam service-accounts add-iam-policy-binding SERVICE_ACCOUNT --member=PRINCIPAL --role=ROLE [--condition=[KEY=VALUE,…] | --condition-from-file=PATH_TO_FILE] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Adds a binding, at least one member, a role and an optional condition, to the IAM policy of a service account treated as a resource: it grants the member that role on the account (DESCRIPTION).
- `--member` and `--role` are required (REQUIRED FLAGS). The page lists the member forms `user:`, `group:`, `serviceAccount:` and `domain:`, and the special values `allUsers` and `allAuthenticatedUsers` (REQUIRED FLAGS, `--member`).
- `--condition` or `--condition-from-file` adds an IAM condition to the binding (OPTIONAL FLAGS).
- An account that does not exist gives a `PERMISSION_DENIED` error (DESCRIPTION).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
