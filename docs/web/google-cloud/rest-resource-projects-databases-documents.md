---
title: "REST Resource: projects.databases.documents"
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents
created_at: 2026-10-07T15:13:36-03:00
updated_at: 2026-10-07T15:13:36-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# REST Resource: projects.databases.documents

## Resource: Document

A Firestore document.

Must not exceed 1 MiB - 4 bytes.

| JSON representation |
|---|
| ``` { "name": string, "fields": { string: { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`) }, ... }, "createTime": string, "updateTime": string } ``` |

| Fields ||
|---|---|
| `name` | `string` The resource name of the document, for example `projects/{projectId}/databases/{databaseId}/documents/{document_path}`. |
| `fields` | ``map (key: string, value: object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`))`` The document's fields. The map keys represent field names. Field names matching the regular expression `__.*__` are reserved. Reserved field names are forbidden except in certain documented contexts. The field names, represented as UTF-8, must not exceed 1,500 bytes and cannot be empty. Field paths may be used in other contexts to refer to structured fields defined here. For `mapValue`, the field path is represented by a dot-delimited (`.`) string of segments. Each segment is either a simple field name (defined below) or a quoted field name. For example, the structured field `"foo" : { mapValue: { "x&y" : { stringValue: "hello" }}}` would be represented by the field path `` foo.`x&y` ``. A simple field name contains only characters `a` to `z`, `A` to `Z`, `0` to `9`, or `_`, and must not start with `0` to `9`. For example, `foo_bar_17`. A quoted field name starts and ends with `` ` `` and may contain any character. Some characters, including `` ` ``, must be escaped using a `\`. For example, `` `x&y` `` represents `x&y` and `` `bak\`tik` `` represents ``bak`tik``. An object containing a list of `"key": value` pairs. Example: `{ "name": "wrench", "mass": "1.3kg", "count": "3" }`. |
| `createTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` Output only. The time at which the document was created. This value increases monotonically when a document is deleted then recreated. It can also be compared to values from other documents and the `readTime` of a query. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |
| `updateTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` Output only. The time at which the document was last changed. This value is initially set to the `createTime` then increases monotonically with each change to the document. It can also be compared to values from other documents and the `readTime` of a query. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |

| ## Methods ||
|---|---|
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/batchGet` | Gets multiple documents. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/batchWrite` | Applies a batch of write operations. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/beginTransaction` | Starts a new transaction. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit` | Commits a transaction, while optionally updating documents. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/createDocument` | Creates a new document. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/delete` | Deletes a document. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/executePipeline` | Executes a pipeline query. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/get` | Gets a single document. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/list` | Lists documents. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/listCollectionIds` | Lists all the collection IDs underneath a document. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/listDocuments` | Lists documents. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/listen` | Listens to changes. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/partitionQuery` | Partitions a query by returning partition cursors that can be used to run the query in parallel. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/patch` | Updates or inserts a document. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/rollback` | Rolls back a transaction. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runAggregationQuery` | Runs an aggregation query. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery` | Runs a query. |
| ### `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/write` | Streams batches of document updates and deletes, in order. |
