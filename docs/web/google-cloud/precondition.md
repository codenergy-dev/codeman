---
title: Precondition
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition
created_at: 2026-10-07T15:13:48-03:00
updated_at: 2026-10-07T15:13:48-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Precondition

A precondition on a document, used for conditional operations.

| JSON representation |
|---|
| ``` { // Union field `condition_type` can be only one of the following: "exists": boolean, "updateTime": string // End of list of possible types for union field `condition_type`. } ``` |

| Fields ||
|---|---|
| Union field `condition_type`. The type of precondition. `condition_type` can be only one of the following: ||
| `exists` | `boolean` When set to `true`, the target document must exist. When set to `false`, the target document must not exist. |
| `updateTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` When set, the target document must exist and have been last updated at that time. Timestamp must be microsecond aligned. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |
