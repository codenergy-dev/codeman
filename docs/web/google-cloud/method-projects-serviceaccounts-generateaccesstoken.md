---
title: "Method: projects.serviceAccounts.generateAccessToken"
url: https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
created_at: 2026-10-07T15:13:58-03:00
updated_at: 2026-10-07T15:13:58-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Method: projects.serviceAccounts.generateAccessToken

- [HTTP request](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#body.HTTP_TEMPLATE)
- [Path parameters](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#body.PATH_PARAMETERS)
- [Request body](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#body.request_body)
  - [JSON representation](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#body.request_body.SCHEMA_REPRESENTATION)
- [Response body](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#body.response_body)
  - [JSON representation](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#body.GenerateAccessTokenResponse.SCHEMA_REPRESENTATION)
- [Authorization scopes](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#body.aspect)
- [Try it!](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken#try-it)

Generates an OAuth 2.0 access token for a service account.

### HTTP request

`POST https://iamcredentials.googleapis.com/v1/{name=projects/*/serviceAccounts/*}:generateAccessToken`

The URL uses [gRPC Transcoding](https://google.aip.dev/127) syntax.

### Path parameters

| Parameters ||
|---|---|
| `name` | `string` Required. The resource name of the service account for which the credentials are requested, in the following format: `projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`. The `-` wildcard character is required; replacing it with a project ID is invalid. Authorization requires the following [IAM](https://cloud.google.com/iam/docs/) permission on the specified resource `name`: - `iam.serviceAccounts.getAccessToken` |

### Request body

The request body contains data with the following structure:

| JSON representation |
|---|
| ``` { "delegates": [ string ], "scope": [ string ], "lifetime": string } ``` |

| Fields ||
|---|---|
| `delegates[]` | `string` The sequence of service accounts in a delegation chain. This field is required for [delegated requests](https://cloud.google.com/iam/help/credentials/delegated-request). For [direct requests](https://cloud.google.com/iam/help/credentials/direct-request), which are more common, do not specify this field. Each service account must be granted the `roles/iam.serviceAccountTokenCreator` role on its next service account in the chain. The last service account in the chain must be granted the `roles/iam.serviceAccountTokenCreator` role on the service account that is specified in the `name` field of the request. The delegates must have the following format: `projects/-/serviceAccounts/{ACCOUNT_EMAIL_OR_UNIQUEID}`. The `-` wildcard character is required; replacing it with a project ID is invalid. |
| `scope[]` | `string` Required. Code to identify the scopes to be included in the OAuth 2.0 access token. See <https://developers.google.com/identity/protocols/googlescopes> for more information. At least one value required. |
| `lifetime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#duration` format)`` The desired lifetime duration of the access token in seconds. By default, the maximum allowed value is 1 hour. To set a lifetime of up to 12 hours, you can add the service account as an allowed value in an Organization Policy that enforces the `constraints/iam.allowServiceAccountCredentialLifetimeExtension` constraint. See detailed instructions at <https://cloud.google.com/iam/help/credentials/lifetime> If a value is not specified, the token's lifetime will be set to a default value of 1 hour. A duration in seconds with up to nine fractional digits, ending with '`s`'. Example: `"3.5s"`. |

### Response body

If successful, the response body contains data with the following structure:

| JSON representation |
|---|
| ``` { "accessToken": string, "expireTime": string } ``` |

| Fields ||
|---|---|
| `accessToken` | `string` The OAuth 2.0 access token. |
| `expireTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` Token expiration time. The expiration time is always set. Uses RFC 3339, where generated output will always be Z-normalized and uses 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |

### Authorization scopes

Requires one of the following OAuth scopes:

- `https://www.googleapis.com/auth/iam`
- `https://www.googleapis.com/auth/cloud-platform`

For more information, see the [Authentication Overview](https://docs.cloud.google.com/docs/authentication#authorization-gcp).
