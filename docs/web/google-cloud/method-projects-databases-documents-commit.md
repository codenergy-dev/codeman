---
title: "Method: projects.databases.documents.commit"
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit
created_at: 2026-10-07T15:13:39-03:00
updated_at: 2026-10-07T15:13:39-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Method: projects.databases.documents.commit

Commits a transaction, while optionally updating documents.

### HTTP request

Choose a location:
<button value="global" default="">global</button> <button value="africa-south1">africa-south1</button> <button value="asia-east1">asia-east1</button> <button value="asia-east2">asia-east2</button> <button value="asia-northeast1">asia-northeast1</button> <button value="asia-northeast2">asia-northeast2</button> <button value="asia-northeast3">asia-northeast3</button> <button value="asia-south1">asia-south1</button> <button value="asia-south2">asia-south2</button> <button value="asia-southeast1">asia-southeast1</button> <button value="asia-southeast2">asia-southeast2</button> <button value="asia-southeast3">asia-southeast3</button> <button value="australia-southeast1">australia-southeast1</button> <button value="australia-southeast2">australia-southeast2</button> <button value="europe-central2">europe-central2</button> <button value="europe-north1">europe-north1</button> <button value="europe-north2">europe-north2</button> <button value="europe-southwest1">europe-southwest1</button> <button value="europe-west1">europe-west1</button> <button value="europe-west10">europe-west10</button> <button value="europe-west12">europe-west12</button> <button value="europe-west2">europe-west2</button> <button value="europe-west3">europe-west3</button> <button value="europe-west4">europe-west4</button> <button value="europe-west6">europe-west6</button> <button value="europe-west8">europe-west8</button> <button value="europe-west9">europe-west9</button> <button value="me-central1">me-central1</button> <button value="me-central2">me-central2</button> <button value="me-west1">me-west1</button> <button value="northamerica-northeast1">northamerica-northeast1</button> <button value="northamerica-northeast2">northamerica-northeast2</button> <button value="northamerica-south1">northamerica-south1</button> <button value="southamerica-east1">southamerica-east1</button> <button value="southamerica-west1">southamerica-west1</button> <button value="us-central1">us-central1</button> <button value="us-east1">us-east1</button> <button value="us-east4">us-east4</button> <button value="us-east5">us-east5</button> <button value="us-south1">us-south1</button> <button value="us-west1">us-west1</button> <button value="us-west2">us-west2</button> <button value="us-west3">us-west3</button> <button value="us-west4">us-west4</button> <button value="eu">eu</button> <button value="us">us</button>   
`POST https://firestore.googleapis.com/v1/{database=projects/*/databases/*}/documents:commit`

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
| ``` { "writes": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write`) } ], "transaction": string } ``` |

| Fields ||
|---|---|
| `writes[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write`)`` The writes to apply. Always executed atomically and in order. |
| `transaction` | `string (https://developers.google.com/discovery/v1/type-format format)` If set, applies all writes in this transaction, and commits it. A base64-encoded string. |

### Response body

The response for `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit#google.firestore.v1.Firestore.Commit`.

If successful, the response body contains data with the following structure:

| JSON representation |
|---|
| ``` { "writeResults": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/WriteResult`) } ], "commitTime": string } ``` |

| Fields ||
|---|---|
| `writeResults[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/WriteResult`)`` The result of applying the writes. This i-th write result corresponds to the i-th write in the request. |
| `commitTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` The time at which the commit occurred. Any read with an equal or greater `readTime` is guaranteed to see the effects of the commit. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |

### Authorization scopes

Requires one of the following OAuth scopes:

- `https://www.googleapis.com/auth/datastore`
- `https://www.googleapis.com/auth/cloud-platform`

For more information, see the [Authentication Overview](https://docs.cloud.google.com/docs/authentication#authorization-gcp).
