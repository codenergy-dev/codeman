---
title: gcloud projects add-iam-policy-binding
url: https://docs.cloud.google.com/sdk/gcloud/reference/projects/add-iam-policy-binding
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud projects add-iam-policy-binding

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud projects add-iam-policy-binding PROJECT_ID --member=PRINCIPAL --role=ROLE [--condition=[KEY=VALUE,…] | --condition-from-file=PATH_TO_FILE] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Adds a binding, a member, a role and an optional condition, to a project's IAM policy (DESCRIPTION).
- `--member` and `--role` are required; a service account is named `serviceAccount:<email>` (REQUIRED FLAGS, EXAMPLES).
- `--condition` or `--condition-from-file` adds an IAM condition to the binding (OPTIONAL FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
