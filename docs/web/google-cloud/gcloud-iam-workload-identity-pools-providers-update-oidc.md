---
title: gcloud iam workload-identity-pools providers update-oidc
url: https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/update-oidc
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud iam workload-identity-pools providers update-oidc

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud iam workload-identity-pools providers update-oidc (PROVIDER : --location=LOCATION --workload-identity-pool=WORKLOAD_IDENTITY_POOL) [--allowed-audiences=[ALLOWED_AUDIENCES,…]] [--attribute-condition=ATTRIBUTE_CONDITION] [--attribute-mapping=[KEY=VALUE,…]] [--description=DESCRIPTION] [--disabled] [--display-name=DISPLAY_NAME] [--issuer-uri=ISSUER_URI] [--jwk-json-path=PATH_TO_FILE] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Changes an OIDC provider, named by its ID with `--workload-identity-pool` and `--location`. Every field is an optional flag: `--attribute-condition`, `--attribute-mapping`, `--allowed-audiences`, `--issuer-uri`, `--display-name`, `--description`, `--disabled` and `--jwk-json-path` (SYNOPSIS, POSITIONAL ARGUMENTS).
- `--attribute-condition`: a Common Expression Language (CEL) expression that returns a boolean, whether to accept the credential. It may use `assertion`, the credential the identity provider issued, as JSON; `google`, the Google attributes the mapping defines; and `attribute`, the custom attributes the mapping defines. It is at most 4096 characters. Without a condition, every valid credential is accepted (FLAGS).
- `--attribute-mapping`: `KEY=VALUE` pairs. The keys are `google.subject` (at most 127 bytes once evaluated), `google.groups`, and up to 50 custom `attribute.<name>` keys; a key is at most 100 characters, of `[a-z0-9_]`. Each value is a CEL expression over `assertion`, at most 2048 characters; all mapped attributes together must not exceed 8 KB once evaluated. An OIDC provider's mapping must include `google.subject` (FLAGS).
- `--disabled`: a disabled provider exchanges no tokens, but the tokens it already issued still grant access (FLAGS).
- `--allowed-audiences`: when empty, the OIDC token's audience must be the provider's full resource name, with or without the `https:` prefix (FLAGS).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
