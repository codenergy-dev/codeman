---
title: "Method: projects.databases.documents.runQuery"
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery
created_at: 2026-10-07T15:13:46-03:00
updated_at: 2026-10-07T15:13:46-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Method: projects.databases.documents.runQuery

Runs a query.

### HTTP request

Choose a location:
<button value="global" default="">global</button> <button value="africa-south1">africa-south1</button> <button value="asia-east1">asia-east1</button> <button value="asia-east2">asia-east2</button> <button value="asia-northeast1">asia-northeast1</button> <button value="asia-northeast2">asia-northeast2</button> <button value="asia-northeast3">asia-northeast3</button> <button value="asia-south1">asia-south1</button> <button value="asia-south2">asia-south2</button> <button value="asia-southeast1">asia-southeast1</button> <button value="asia-southeast2">asia-southeast2</button> <button value="asia-southeast3">asia-southeast3</button> <button value="australia-southeast1">australia-southeast1</button> <button value="australia-southeast2">australia-southeast2</button> <button value="europe-central2">europe-central2</button> <button value="europe-north1">europe-north1</button> <button value="europe-north2">europe-north2</button> <button value="europe-southwest1">europe-southwest1</button> <button value="europe-west1">europe-west1</button> <button value="europe-west10">europe-west10</button> <button value="europe-west12">europe-west12</button> <button value="europe-west2">europe-west2</button> <button value="europe-west3">europe-west3</button> <button value="europe-west4">europe-west4</button> <button value="europe-west6">europe-west6</button> <button value="europe-west8">europe-west8</button> <button value="europe-west9">europe-west9</button> <button value="me-central1">me-central1</button> <button value="me-central2">me-central2</button> <button value="me-west1">me-west1</button> <button value="northamerica-northeast1">northamerica-northeast1</button> <button value="northamerica-northeast2">northamerica-northeast2</button> <button value="northamerica-south1">northamerica-south1</button> <button value="southamerica-east1">southamerica-east1</button> <button value="southamerica-west1">southamerica-west1</button> <button value="us-central1">us-central1</button> <button value="us-east1">us-east1</button> <button value="us-east4">us-east4</button> <button value="us-east5">us-east5</button> <button value="us-south1">us-south1</button> <button value="us-west1">us-west1</button> <button value="us-west2">us-west2</button> <button value="us-west3">us-west3</button> <button value="us-west4">us-west4</button> <button value="eu">eu</button> <button value="us">us</button>   
`POST https://firestore.googleapis.com/v1/{parent=projects/*/databases/*/documents}:runQuery`

<br />

The URLs use [gRPC Transcoding](https://google.aip.dev/127) syntax.

### Path parameters

| Parameters ||
|---|---|
| `parent` | `string` Required. The parent resource name. In the format: `projects/{projectId}/databases/{databaseId}/documents` or `projects/{projectId}/databases/{databaseId}/documents/{document_path}`. For example: `projects/my-project/databases/my-database/documents` or `projects/my-project/databases/my-database/documents/chatrooms/my-chatroom` |

### Request body

The request body contains data with the following structure:

| JSON representation |
|---|
| ``` { "explainOptions": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/ExplainOptions`) }, // Union field `query_type` can be only one of the following: "structuredQuery": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery`) } // End of list of possible types for union field `query_type`. // Union field `consistency_selector` can be only one of the following: "transaction": string, "newTransaction": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/TransactionOptions`) }, "readTime": string // End of list of possible types for union field `consistency_selector`. } ``` |

| Fields ||
|---|---|
| `explainOptions` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/ExplainOptions`)`` Optional. Explain options for the query. If set, additional query statistics will be returned. If not, only query results will be returned. |
| Union field `query_type`. The query to run. `query_type` can be only one of the following: ||
| `structuredQuery` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery`)`` A structured query. |
| Union field `consistency_selector`. The consistency mode for this transaction. If not set, defaults to strong consistency. `consistency_selector` can be only one of the following: ||
| `transaction` | `string (https://developers.google.com/discovery/v1/type-format format)` Run the query within an already active transaction. The value here is the opaque transaction ID to execute the query in. A base64-encoded string. |
| `newTransaction` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/TransactionOptions`)`` Starts a new transaction and reads the documents. Defaults to a read-only transaction. The new transaction ID will be returned as the first response in the stream. |
| `readTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` Reads documents as they were at the given time. This must be a microsecond precision timestamp within the past one hour, or if Point-in-Time Recovery is enabled, can additionally be a whole minute timestamp within the past 7 days. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |

### Response body

The response for `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery#google.firestore.v1.Firestore.RunQuery`.

If successful, the response body contains data with the following structure:

| JSON representation |
|---|
| ``` { "transaction": string, "document": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document`) }, "readTime": string, "skippedResults": integer, "explainMetrics": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/ExplainMetrics`) }, // Union field `continuation_selector` can be only one of the following: "done": boolean // End of list of possible types for union field `continuation_selector`. } ``` |

| Fields ||
|---|---|
| `transaction` | `string (https://developers.google.com/discovery/v1/type-format format)` The transaction that was started as part of this request. Can only be set in the first response, and only if `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery#body.request_body.FIELDS.new_transaction` was set in the request. If set, no other fields will be set in this response. A base64-encoded string. |
| `document` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document`)`` A query result, not set when reporting partial progress. |
| `readTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` The time at which the document was read. This may be monotonically increasing; in this case, the previous documents in the result stream are guaranteed not to have changed between their `readTime` and this one. If the query returns no results, a response with `readTime` and no `document` will be sent, and this represents the time at which the query was run. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |
| `skippedResults` | `integer` The number of results that have been skipped due to an offset between the last response and the current response. |
| `explainMetrics` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/ExplainMetrics`)`` Query explain metrics. This is only present when the `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery#body.request_body.FIELDS.explain_options` is provided, and it is sent only once with the last response in the stream. |
| Union field `continuation_selector`. The continuation mode for the query. If present, it indicates the current query response stream has finished. This can be set with or without a `document` present, but when set, no more results are returned. `continuation_selector` can be only one of the following: ||
| `done` | `boolean` If present, Firestore has completely finished the request and no more documents will be returned. |

### Authorization scopes

Requires one of the following OAuth scopes:

- `https://www.googleapis.com/auth/datastore`
- `https://www.googleapis.com/auth/cloud-platform`

For more information, see the [Authentication Overview](https://docs.cloud.google.com/docs/authentication#authorization-gcp).
