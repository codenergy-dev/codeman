---
title: REST API endpoints for issue comments
url: https://docs.github.com/en/rest/issues/comments
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for issue comments

Use the REST API to manage comments on issues and pull requests.

## About issue and pull request comments

You can use the REST API to create and manage comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request. For this reason, "shared" actions for both features, like managing assignees, labels, and milestones, are provided within the Issues endpoints. To manage pull request review comments, see [REST API endpoints for pull request review comments](/en/rest/pulls/comments).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List issue comments for a repository

```
GET /repos/{owner}/{repo}/issues/comments
```

You can use the REST API to list comments on issues and pull requests for a repository. Every pull request is an issue, but not every issue is a pull request.
By default, issue comments are ordered by ascending ID.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`sort`** (string)
  The property to sort the results by.
  Default: `created`
  Can be one of: `created`, `updated`

* **`direction`** (string)
  Either asc or desc. Ignored without the sort parameter.
  Can be one of: `asc`, `desc`

* **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

* **200** - OK

* **404** - Resource not found

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues/comments
```

**Response schema (Status: 200):**

Array of `Issue Comment`:

* `id`: required, integer, format: int64
* `node_id`: required, string
* `url`: required, string, format: uri
* `body`: string
* `body_text`: string
* `body_html`: string
* `html_url`: required, string, format: uri
* `user`: required, any of:
  * **null**
  * **Simple User**
    * `name`: string or null
    * `email`: string or null
    * `login`: required, string
    * `id`: required, integer, format: int64
    * `node_id`: required, string
    * `avatar_url`: required, string, format: uri
    * `gravatar_id`: required, string or null
    * `url`: required, string, format: uri
    * `html_url`: required, string, format: uri
    * `followers_url`: required, string, format: uri
    * `following_url`: required, string
    * `gists_url`: required, string
    * `starred_url`: required, string
    * `subscriptions_url`: required, string, format: uri
    * `organizations_url`: required, string, format: uri
    * `repos_url`: required, string, format: uri
    * `events_url`: required, string
    * `received_events_url`: required, string, format: uri
    * `type`: required, string
    * `site_admin`: required, boolean
    * `starred_at`: string
    * `user_view_type`: string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `issue_url`: required, string, format: uri
* `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
* `performed_via_github_app`: any of:
  * **null**
  * **GitHub app**
    * `id`: required, integer
    * `slug`: string
    * `node_id`: required, string
    * `client_id`: string
    * `owner`: required, one of:
      * **Simple User** (see above)
      * **Enterprise**
        * `description`: string or null
        * `html_url`: required, string, format: uri
        * `website_url`: string or null, format: uri
        * `id`: required, integer
        * `node_id`: required, string
        * `name`: required, string
        * `slug`: required, string
        * `created_at`: required, string or null, format: date-time
        * `updated_at`: required, string or null, format: date-time
        * `avatar_url`: required, string, format: uri
    * `name`: required, string
    * `description`: required, string or null
    * `external_url`: required, string, format: uri
    * `html_url`: required, string, format: uri
    * `created_at`: required, string, format: date-time
    * `updated_at`: required, string, format: date-time
    * `permissions`: required, object, additional properties: string:
      * `issues`: string
      * `checks`: string
      * `metadata`: string
      * `contents`: string
      * `deployments`: string
    * `events`: required, array of string
    * `installations_count`: integer
* `reactions`: `Reaction Rollup`:
  * `url`: required, string, format: uri
  * `total_count`: required, integer
  * `+1`: required, integer
  * `-1`: required, integer
  * `laugh`: required, integer
  * `confused`: required, integer
  * `heart`: required, integer
  * `hooray`: required, integer
  * `eyes`: required, integer
  * `rocket`: required, integer
* `pin`: any of:
  * **null**
  * **Pinned Issue Comment**
    * `pinned_at`: required, string, format: date-time
    * `pinned_by`: required, any of:
      * **null**
      * **Simple User** (see above)
* `minimized`: any of:
  * **null**
  * **Minimized Issue Comment**
    * `reason`: required, string or null

## Get an issue comment

```
GET /repos/{owner}/{repo}/issues/comments/{comment_id}
```

You can use the REST API to get comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`comment_id`** (integer) (required)
  The unique identifier of the comment.

### HTTP response status codes

* **200** - OK

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues/comments/COMMENT_ID
```

**Response schema (Status: 200):**

* `id`: required, integer, format: int64
* `node_id`: required, string
* `url`: required, string, format: uri
* `body`: string
* `body_text`: string
* `body_html`: string
* `html_url`: required, string, format: uri
* `user`: required, any of:
  * **null**
  * **Simple User**
    * `name`: string or null
    * `email`: string or null
    * `login`: required, string
    * `id`: required, integer, format: int64
    * `node_id`: required, string
    * `avatar_url`: required, string, format: uri
    * `gravatar_id`: required, string or null
    * `url`: required, string, format: uri
    * `html_url`: required, string, format: uri
    * `followers_url`: required, string, format: uri
    * `following_url`: required, string
    * `gists_url`: required, string
    * `starred_url`: required, string
    * `subscriptions_url`: required, string, format: uri
    * `organizations_url`: required, string, format: uri
    * `repos_url`: required, string, format: uri
    * `events_url`: required, string
    * `received_events_url`: required, string, format: uri
    * `type`: required, string
    * `site_admin`: required, boolean
    * `starred_at`: string
    * `user_view_type`: string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `issue_url`: required, string, format: uri
* `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
* `performed_via_github_app`: any of:
  * **null**
  * **GitHub app**
    * `id`: required, integer
    * `slug`: string
    * `node_id`: required, string
    * `client_id`: string
    * `owner`: required, one of:
      * **Simple User** (see above)
      * **Enterprise**
        * `description`: string or null
        * `html_url`: required, string, format: uri
        * `website_url`: string or null, format: uri
        * `id`: required, integer
        * `node_id`: required, string
        * `name`: required, string
        * `slug`: required, string
        * `created_at`: required, string or null, format: date-time
        * `updated_at`: required, string or null, format: date-time
        * `avatar_url`: required, string, format: uri
    * `name`: required, string
    * `description`: required, string or null
    * `external_url`: required, string, format: uri
    * `html_url`: required, string, format: uri
    * `created_at`: required, string, format: date-time
    * `updated_at`: required, string, format: date-time
    * `permissions`: required, object, additional properties: string:
      * `issues`: string
      * `checks`: string
      * `metadata`: string
      * `contents`: string
      * `deployments`: string
    * `events`: required, array of string
    * `installations_count`: integer
* `reactions`: `Reaction Rollup`:
  * `url`: required, string, format: uri
  * `total_count`: required, integer
  * `+1`: required, integer
  * `-1`: required, integer
  * `laugh`: required, integer
  * `confused`: required, integer
  * `heart`: required, integer
  * `hooray`: required, integer
  * `eyes`: required, integer
  * `rocket`: required, integer
* `pin`: any of:
  * **null**
  * **Pinned Issue Comment**
    * `pinned_at`: required, string, format: date-time
    * `pinned_by`: required, any of:
      * **null**
      * **Simple User** (see above)
* `minimized`: any of:
  * **null**
  * **Minimized Issue Comment**
    * `reason`: required, string or null

## Update an issue comment

```
PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}
```

You can use the REST API to update comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`comment_id`** (integer) (required)
  The unique identifier of the comment.

#### Body parameters

* **`body`** (string) (required)
  The contents of the comment.

### HTTP response status codes

* **200** - OK

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/issues/comments/COMMENT_ID \
  -d '{
  "body": "Me too"
}'
```

**Response schema (Status: 200):**

Same response schema as [Get an issue comment](#get-an-issue-comment).

## Delete an issue comment

```
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}
```

You can use the REST API to delete comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`comment_id`** (integer) (required)
  The unique identifier of the comment.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/issues/comments/COMMENT_ID
```

**Response schema (Status: 204):**

## Pin an issue comment

```
PUT /repos/{owner}/{repo}/issues/comments/{comment_id}/pin
```

You can use the REST API to pin comments on issues.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`comment_id`** (integer) (required)
  The unique identifier of the comment.

### HTTP response status codes

* **200** - OK

* **401** - Requires authentication

* **403** - Forbidden

* **404** - Resource not found

* **410** - Gone

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/issues/comments/COMMENT_ID/pin
```

**Response schema (Status: 200):**

Same response schema as [Get an issue comment](#get-an-issue-comment).

## Unpin an issue comment

```
DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/pin
```

You can use the REST API to unpin comments on issues.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`comment_id`** (integer) (required)
  The unique identifier of the comment.

### HTTP response status codes

* **204** - No Content

* **401** - Requires authentication

* **403** - Forbidden

* **404** - Resource not found

* **410** - Gone

* **503** - Service unavailable

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/issues/comments/COMMENT_ID/pin
```

**Response schema (Status: 204):**

## List issue comments

```
GET /repos/{owner}/{repo}/issues/{issue_number}/comments
```

You can use the REST API to list comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request.
Issue comments are ordered by ascending ID.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`issue_number`** (integer) (required)
  The number that identifies the issue.

* **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

* **200** - OK

* **404** - Resource not found

* **410** - Gone

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/comments
```

**Response schema (Status: 200):**

Same response schema as [List issue comments for a repository](#list-issue-comments-for-a-repository).

## Create an issue comment

```
POST /repos/{owner}/{repo}/issues/{issue_number}/comments
```

You can use the REST API to create comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request.
This endpoint triggers notifications.
Creating content too quickly using this endpoint may result in secondary rate limiting.
For more information, see "Rate limits for the API"
and "Best practices for using the REST API."
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`issue_number`** (integer) (required)
  The number that identifies the issue.

#### Body parameters

* **`body`** (string) (required)
  The contents of the comment.

### HTTP response status codes

* **201** - Created

* **403** - Forbidden

* **404** - Resource not found

* **410** - Gone

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/comments \
  -d '{
  "body": "Me too"
}'
```

**Response schema (Status: 201):**

Same response schema as [Get an issue comment](#get-an-issue-comment).