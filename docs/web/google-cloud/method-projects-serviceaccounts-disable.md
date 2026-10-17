---
title: "Method: projects.serviceAccounts.disable"
url: https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable
created_at: 2026-10-17T13:07:14-03:00
updated_at: 2026-10-17T13:07:14-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Method: projects.serviceAccounts.disable

- [HTTP request](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable#body.HTTP_TEMPLATE)
- [Path parameters](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable#body.PATH_PARAMETERS)
- [Request body](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable#body.request_body)
- [Response body](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable#body.response_body)
- [Authorization scopes](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable#body.aspect)
- [Examples](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable#examples)
- [Try it!](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/disable#try-it)

Disables a `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts#ServiceAccount` immediately.

If an application uses the service account to authenticate, that application can no longer call Google APIs or access Google Cloud resources. Existing access tokens for the service account are rejected, and requests for new access tokens will fail.

To re-enable the service account, use `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/enable#google.iam.admin.v1.IAM.EnableServiceAccount`. After you re-enable the service account, its existing access tokens will be accepted, and you can request new access tokens.

To help avoid unplanned outages, we recommend that you disable the service account before you delete it. Use this method to disable the service account, then wait at least 24 hours and watch for unintended consequences. If there are no unintended consequences, you can delete the service account with `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/delete#google.iam.admin.v1.IAM.DeleteServiceAccount`.

### HTTP request

`POST https://iam.googleapis.com/v1/{name=projects/*/serviceAccounts/*}:disable`

The URL uses [gRPC Transcoding](https://google.aip.dev/127) syntax.

### Path parameters

| Parameters ||
|---|---|
| `name` | `string` The resource name of the service account. Use one of the following formats: - `projects/{PROJECT_ID}/serviceAccounts/{EMAIL_ADDRESS}` - `projects/{PROJECT_ID}/serviceAccounts/{UNIQUE_ID}` As an alternative, you can use the `-` wildcard character instead of the project ID: - `projects/-/serviceAccounts/{EMAIL_ADDRESS}` - `projects/-/serviceAccounts/{UNIQUE_ID}` When possible, avoid using the `-` wildcard character, because it can cause response messages to contain misleading error codes. For example, if you try to access the service account `projects/-/serviceAccounts/fake@example.com`, which does not exist, the response contains an HTTP `403 Forbidden` error instead of a `404 Not Found` error. Authorization requires the following [IAM](https://cloud.google.com/iam/docs/) permission on the specified resource `name`: - `iam.serviceAccounts.disable` |

### Request body

The request body must be empty.

### Response body

If successful, the response body is an empty JSON object.

### Authorization scopes

Requires one of the following OAuth scopes:

- `https://www.googleapis.com/auth/iam`
- `
  https://www.googleapis.com/auth/cloud-platform`

For more information, see the [Authentication Overview](https://docs.cloud.google.com/docs/authentication#authorization-gcp).