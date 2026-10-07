---
title: "Method: projects.databases.documents.batchGet"
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/batchGet
created_at: 2026-10-07T15:13:37-03:00
updated_at: 2026-10-07T15:13:37-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Method: projects.databases.documents.batchGet

Gets multiple documents.

Documents returned by this method are not guaranteed to be returned in the same order that they were requested.

### HTTP request

Choose a location:
<button value="global" default="">global</button> <button value="africa-south1">africa-south1</button> <button value="asia-east1">asia-east1</button> <button value="asia-east2">asia-east2</button> <button value="asia-northeast1">asia-northeast1</button> <button value="asia-northeast2">asia-northeast2</button> <button value="asia-northeast3">asia-northeast3</button> <button value="asia-south1">asia-south1</button> <button value="asia-south2">asia-south2</button> <button value="asia-southeast1">asia-southeast1</button> <button value="asia-southeast2">asia-southeast2</button> <button value="asia-southeast3">asia-southeast3</button> <button value="australia-southeast1">australia-southeast1</button> <button value="australia-southeast2">australia-southeast2</button> <button value="europe-central2">europe-central2</button> <button value="europe-north1">europe-north1</button> <button value="europe-north2">europe-north2</button> <button value="europe-southwest1">europe-southwest1</button> <button value="europe-west1">europe-west1</button> <button value="europe-west10">europe-west10</button> <button value="europe-west12">europe-west12</button> <button value="europe-west2">europe-west2</button> <button value="europe-west3">europe-west3</button> <button value="europe-west4">europe-west4</button> <button value="europe-west6">europe-west6</button> <button value="europe-west8">europe-west8</button> <button value="europe-west9">europe-west9</button> <button value="me-central1">me-central1</button> <button value="me-central2">me-central2</button> <button value="me-west1">me-west1</button> <button value="northamerica-northeast1">northamerica-northeast1</button> <button value="northamerica-northeast2">northamerica-northeast2</button> <button value="northamerica-south1">northamerica-south1</button> <button value="southamerica-east1">southamerica-east1</button> <button value="southamerica-west1">southamerica-west1</button> <button value="us-central1">us-central1</button> <button value="us-east1">us-east1</button> <button value="us-east4">us-east4</button> <button value="us-east5">us-east5</button> <button value="us-south1">us-south1</button> <button value="us-west1">us-west1</button> <button value="us-west2">us-west2</button> <button value="us-west3">us-west3</button> <button value="us-west4">us-west4</button> <button value="eu">eu</button> <button value="us">us</button>   
`POST https://firestore.googleapis.com/v1/{database=projects/*/databases/*}/documents:batchGet`

<br />

The URLs use [gRPC Transcoding](https://google.aip.dev/127) syntax.

### Path parameters

| Parameters ||
|---|---|
| `database` | `string` Required. The database name. In the format: `projects/{projectId}/databases/{databaseId}`. |

### Request body

The request body contains data with the following structure:

| JSON representation |
|---|
| ``` { "documents": [ string ], "mask": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/DocumentMask`) }, // Union field `consistency_selector` can be only one of the following: "transaction": string, "newTransaction": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/TransactionOptions`) }, "readTime": string // End of list of possible types for union field `consistency_selector`. } ``` |

| Fields ||
|---|---|
| `documents[]` | `string` The names of the documents to retrieve. In the format: `projects/{projectId}/databases/{databaseId}/documents/{document_path}`. The request will fail if any of the document is not a child resource of the given `database`. Duplicate names will be elided. |
| `mask` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/DocumentMask`)`` The fields to return. If not set, returns all fields. If a document has a field that is not present in this mask, that field will not be returned in the response. |
| Union field `consistency_selector`. The consistency mode for this transaction. If not set, defaults to strong consistency. `consistency_selector` can be only one of the following: ||
| `transaction` | `string (https://developers.google.com/discovery/v1/type-format format)` Reads documents in a transaction. A base64-encoded string. |
| `newTransaction` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/TransactionOptions`)`` Starts a new transaction and reads the documents. Defaults to a read-only transaction. The new transaction ID will be returned as the first response in the stream. |
| `readTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` Reads documents as they were at the given time. This must be a microsecond precision timestamp within the past one hour, or if Point-in-Time Recovery is enabled, can additionally be a whole minute timestamp within the past 7 days. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |

### Response body

The streamed response for `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/batchGet#google.firestore.v1.Firestore.BatchGetDocuments`.

If successful, the response body contains data with the following structure:

| JSON representation |
|---|
| ``` { "transaction": string, "readTime": string, // Union field `result` can be only one of the following: "found": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document`) }, "missing": string // End of list of possible types for union field `result`. } ``` |

| Fields ||
|---|---|
| `transaction` | `string (https://developers.google.com/discovery/v1/type-format format)` The transaction that was started as part of this request. Will only be set in the first response, and only if `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/batchGet#body.request_body.FIELDS.new_transaction` was set in the request. A base64-encoded string. |
| `readTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` The time at which the document was read. This may be monotically increasing, in this case the previous documents in the result stream are guaranteed not to have changed between their readTime and this one. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |
| Union field `result`. A single result. This can be empty if the server is just returning a transaction. `result` can be only one of the following: ||
| `found` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document`)`` A document that was requested. |
| `missing` | `string` A document name that was requested but does not exist. In the format: `projects/{projectId}/databases/{databaseId}/documents/{document_path}`. |

### Authorization scopes

Requires one of the following OAuth scopes:

- `https://www.googleapis.com/auth/datastore`
- `https://www.googleapis.com/auth/cloud-platform`

For more information, see the [Authentication Overview](https://docs.cloud.google.com/docs/authentication#authorization-gcp).
