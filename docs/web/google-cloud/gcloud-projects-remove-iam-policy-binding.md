---
title: gcloud projects remove-iam-policy-binding
url: https://docs.cloud.google.com/sdk/gcloud/reference/projects/remove-iam-policy-binding
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud projects remove-iam-policy-binding

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud projects remove-iam-policy-binding PROJECT_ID --member=PRINCIPAL --role=ROLE [--all | --condition=[KEY=VALUE,…] | --condition-from-file=PATH_TO_FILE] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Removes a binding of a member and a role from a project's IAM policy (DESCRIPTION).
- `--member` and `--role` are required. A deleted principal is named with a `deleted:` prefix and a `?uid=<UID>` suffix (REQUIRED FLAGS, `--member`).
- `--all` removes every binding of that role and member, whatever its condition; `--condition` removes only the binding whose condition matches exactly (OPTIONAL FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
