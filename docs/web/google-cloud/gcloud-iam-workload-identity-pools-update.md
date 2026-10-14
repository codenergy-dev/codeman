---
title: gcloud iam workload-identity-pools update
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/update
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam workload-identity-pools update

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam workload-identity-pools update (WORKLOAD_IDENTITY_POOL : --location=LOCATION) [--description=DESCRIPTION] [--disabled] [--display-name=DISPLAY_NAME] [--inline-trust-config-file=INLINE_TRUST_CONFIG_FILE] [--inline-certificate-issuance-config-file=INLINE_CERTIFICATE_ISSUANCE_CONFIG_FILE | --certificate-lifetime=CERTIFICATE_LIFETIME --key-algorithm=KEY_ALGORITHM --rotation-window-percentage=ROTATION_WINDOW_PERCENTAGE --[no-]use-default-shared-ca] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Changes a pool's display name (`--display-name`, at most 32 characters), description (`--description`, at most 256 characters) and state (`--disabled`) (FLAGS).
- `--disabled`: a disabled pool exchanges no tokens, and the tokens it already issued stop granting access to resources; if the pool is enabled again, those tokens grant access again (FLAGS).
- The page documents no flag that enables a pool again: its synopsis lists only `--disabled` (SYNOPSIS, FLAGS).
- Its other flags configure trust bundles and certificates for workloads (FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
