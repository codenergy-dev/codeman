---
title: gcloud logging read
url: https://docs.cloud.google.com/sdk/gcloud/reference/logging/read
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud logging read

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Synopsis

```
gcloud logging read [LOG_FILTER] [--freshness=FRESHNESS; default="1d"] [--order=ORDER; default="desc"] [--billing-account=BILLING_ACCOUNT_ID | --folder=FOLDER_ID | --organization=ORGANIZATION_ID | --project=PROJECT_ID] [--resource-names=[RESOURCE,…] | --bucket=BUCKET --location=LOCATION --view=VIEW] [--limit=LIMIT] [GCLOUD_WIDE_FLAG …]
```

## Facts

- Reads the log entries that match a filter, the optional `LOG_FILTER` argument written in the Logging query language, most recent first (DESCRIPTION, POSITIONAL ARGUMENTS).
- `--freshness`, `1d` by default, returns only entries not older than that; it works only in descending order and with a filter that has no timestamp (FLAGS).
- `--project`, `--folder`, `--organization` or `--billing-account` chooses whose entries are read (FLAGS); `--limit` caps how many (LIST COMMAND FLAGS).
- An example reads in a time window with `timestamp>=` and `timestamp<=` terms in the filter (EXAMPLES).
- It also takes the flags every `gcloud` command takes, among them `--project`, `--format` and `--flatten` (GCLOUD WIDE FLAGS).
