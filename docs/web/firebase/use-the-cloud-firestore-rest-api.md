---
title: Use the Cloud Firestore REST API
url: https://firebase.google.com/docs/firestore/use-rest-api
created_at: 2026-10-07T15:14:03-03:00
updated_at: 2026-10-07T15:14:03-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Use the Cloud Firestore REST API

While the easiest way to use Cloud Firestore is to use one of the
native client libraries, there are some situations when it is useful to
call the REST API directly.

The REST API can be helpful for the following use cases:

- Accessing Cloud Firestore from a resource-constrained environment, such as an internet of things (IoT) device, where running a complete client library is not possible.
- Automating database administration or retrieving detailed database metadata.

If you are using a
[gRPC-supported language](https://grpc.io/about/#osp), consider using the
[RPC API](https://firebase.google.com/docs/firestore/reference/rpc/) rather than the REST API.

## Authentication and authorization

For authentication, the Cloud Firestore REST API accepts either a
[Firebase Authentication](https://firebase.google.com/docs/auth/) ID token or a
[Google Identity OAuth 2.0](https://developers.google.com/identity/protocols/OAuth2) token. The token you provide
affects your request's authorization:

- Use Firebase ID tokens to authenticate requests from your application's users.
  For these requests, Cloud Firestore uses
  [Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started) to determine if a request
  is authorized.

- Use a Google Identity OAuth 2.0 token and a
  [service account](https://cloud.google.com/iam/docs/service-accounts) to authenticate requests from your
  application, such as requests for database administration. For these requests,
  Cloud Firestore uses
  [Identity and Access Management (IAM)](https://cloud.google.com/iam/docs/overview) to determine if a
  request is authorized.

### Working with Firebase ID tokens

You can attain a Firebase ID token in two ways:

- [Generate a Firebase ID token using the
  Firebase Authentication REST API](https://firebase.google.com/docs/reference/rest/auth/).
- [Retrieve a user's Firebase ID token from a
  Firebase Authentication SDK](https://firebase.google.com/docs/auth/admin/verify-id-tokens#retrieve_id_tokens_on_clients).

By retrieving a user's Firebase ID token, you can make requests on behalf of the
user.

For requests authenticated with a Firebase ID token and for unauthenticated
requests, Cloud Firestore uses your
[Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started) to determine if a request is
authorized.

### Working with Google Identity OAuth 2.0 tokens

You can generate an access token by using a
[service account](https://cloud.google.com/iam/docs/service-accounts) with a
[Google API Client Library](https://developers.google.com/api-client-library/)
or by following the steps in
[Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/OAuth2ServiceAccount). You
can also generate a token with the [`gcloud`](https://cloud.google.com/sdk/gcloud/) command-line tool and the
command [`gcloud auth application-default print-access-token`](https://cloud.google.com/sdk/gcloud/reference/auth/application-default/print-access-token).

This token must have the following scope to send requests to the
Cloud Firestore REST API:

- `https://www.googleapis.com/auth/datastore`

If you authenticate your requests with a service account and a Google Identity
OAuth 2.0 token, Cloud Firestore assumes that your requests act on behalf
of your application instead of an individual user. Cloud Firestore allows
these requests to ignore your security rules. Instead, Cloud Firestore
uses [IAM](https://cloud.google.com/iam/docs/overview) to determine if a request is authorized.

You can control the access permissions of service accounts by assigning
[Cloud Firestore IAM roles](https://cloud.google.com/firestore/docs/security/iam#roles).

### Authenticating with an access token

After you obtain either a Firebase ID token or a Google Identity OAuth 2.0
token, pass it to the Cloud Firestore endpoints as an `Authorization`
header set to `Bearer {YOUR_TOKEN}`.

## Making REST calls

All REST API endpoints exist under the base URL `https://firestore.googleapis.com/v1/`.

To create a path to a document with the ID `LA` in the collection `cities`
under the project `YOUR_PROJECT_ID` you would use the following structure.

    /projects/YOUR_PROJECT_ID/databases/(default)/documents/cities/LA

To interact with this path, combine it with the base API URL.

    https://firestore.googleapis.com/v1/projects/YOUR_PROJECT_ID/databases/(default)/documents/cities/LA

The best way to begin experimenting with the REST API is to use the
[API Explorer](https://developers.google.com/apis-explorer/#search/firestore/firestore/v1/), which automatically generates Google Identity
OAuth 2.0 tokens and allows you to examine the API.

## Methods

Below are brief descriptions of the two most important method groups. For a complete
list, see the [REST API reference](https://firebase.google.com/docs/firestore/reference/rest/) or use the [API Explorer](https://developers.google.com/apis-explorer/#search/firestore/firestore/v1/).

#### `v1.projects.databases.documents`

Perform CRUD operations on documents, similar to those outlined in the
[add data](https://firebase.google.com/docs/firestore/manage-data/add-data) or [get data](https://firebase.google.com/docs/firestore/query-data/get-data) guides.

#### `v1.projects.databases.collectionGroups.indexes`

Perform actions on indexes such as creating new indexes, disabling an existing
index, or listing all current indexes. Useful for automating data structure
migrations or synchronizing indexes between projects.

Also enables retrieval of document metadata, such as the list of all
fields and subcollections for a given document.

## Error Codes

When a Cloud Firestore request succeeds, the
Cloud Firestore API returns an HTTP `200 OK` status code and the
requested data. When a request fails, the Cloud Firestore API returns an
HTTP `4xx` or `5xx` status code and a response with information about
the error.

The following table lists recommended actions for each error code. These codes apply
to the Cloud Firestore REST and RPC APIs. The [Cloud Firestore
SDKs and client libraries](https://firebase.google.com/docs/firestore/client/libraries) may not return these same error codes.

| Canonical Error Code | Description | Recommended Action |
|---|---|---|
| `ABORTED` | The request conflicted with another request. | For a non-transactional commit: Retry the request or re-structure your data model to reduce contention. For requests in a transaction: Retry the entire transaction or re-structure your data model to reduce contention. |
| `ALREADY_EXISTS` | The request tried to create a document that already exists. | Do not retry without fixing the problem. |
| `DEADLINE_EXCEEDED` | The Cloud Firestore server handling the request exceeded a deadline. | Retry using exponential backoff. |
| `FAILED_PRECONDITION` | The request did not meet one of its preconditions. For example, a query request might require an index not yet defined. See the message field in the error response for the precondition that failed. | Do not retry without fixing the problem. |
| `INTERNAL` | The Cloud Firestore server returned an error. | Do not retry this request more than once. |
| `INVALID_ARGUMENT` | A request parameter includes an invalid value. See the message field in the error response for the invalid value. | Do not retry without fixing the problem. |
| `NOT_FOUND` | The request attempted to update a document that does not exist. | Do not retry without fixing the problem. |
| `PERMISSION_DENIED` | The user is not authorized to make this request. | Do not retry without fixing the problem. |
| `RESOURCE_EXHAUSTED` | The project exceeded either its [quota](https://firebase.google.com/docs/firestore/quotas) or the region/multi-region capacity. | [Verify that you did not exceed your project quota](https://firebase.google.com/docs/firestore/monitor-usage#view-quota). If you exceeded a project quota, do not retry without fixing the problem. Otherwise, retry with exponential backoff. |
| `UNAUTHENTICATED` | The request did not include valid authentication credentials. | Do not retry without fixing the problem. |
| `UNAVAILABLE` | The Cloud Firestore server returned an error. | Retry using exponential backoff. |
