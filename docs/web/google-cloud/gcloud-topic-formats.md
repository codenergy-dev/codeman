---
title: gcloud topic formats
url: https://docs.cloud.google.com/sdk/gcloud/reference/topic/formats
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# gcloud topic formats

Google's page has no Markdown source, so this page holds, in Codeman's words, only what Codeman's documentation relies on; each fact names the section of the page it comes from.

## Facts

- `--format` changes a command's output. A format expression is a name, optional attributes in brackets, and a projection in parentheses: the resource keys to print (DESCRIPTION, Formats).
- `value` prints the projected values with no heading, separated by tabs; it requires a projection, such as `value(attributeCondition)` (Formats, `value`).
- `yaml` and `json` print the resource as YAML or JSON (Formats). A projection lists a subset of the resource's keys, such as `yaml(attributeMapping)` (DESCRIPTION).
- `table` prints the projected keys in aligned columns with headings; it requires a projection (Formats, `table`).
