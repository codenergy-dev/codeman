---
title: gcloud iam workload-identity-pools providers create-oidc
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/create-oidc
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam workload-identity-pools providers create-oidc

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam workload-identity-pools providers create-oidc (PROVIDER : --location=LOCATION --workload-identity-pool=WORKLOAD_IDENTITY_POOL) --attribute-mapping=[KEY=VALUE,…] --issuer-uri=ISSUER_URI [--allowed-audiences=[ALLOWED_AUDIENCES,…]] [--attribute-condition=ATTRIBUTE_CONDITION] [--description=DESCRIPTION] [--disabled] [--display-name=DISPLAY_NAME] [--jwk-json-path=PATH_TO_FILE] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Creates an OIDC provider in a pool, named by its ID with `--workload-identity-pool` and `--location` (POSITIONAL ARGUMENTS).
- `--attribute-mapping` and `--issuer-uri` are required; `--attribute-condition`, `--allowed-audiences`, `--display-name`, `--description` and `--disabled` are optional (SYNOPSIS).
- `--attribute-condition` and `--attribute-mapping` follow the same rules as in [`update-oidc`](gcloud-iam-workload-identity-pools-providers-update-oidc.md); among them, a condition is at most 4096 characters (FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
