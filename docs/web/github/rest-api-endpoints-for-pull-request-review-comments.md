---
title: REST API endpoints for pull request review comments
url: https://docs.github.com/en/rest/pulls/comments
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for pull request review comments

Use the REST API to interact with pull request review comments.

## About pull request review comments

Pull request review comments are comments made on a portion of the unified diff during a pull request review. These are different from commit comments and issue comments in a pull request. For more information, see [REST API endpoints for commit comments](/en/rest/commits/comments) and [REST API endpoints for issue comments](/en/rest/issues/comments).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List review comments in a repository

```
GET /repos/{owner}/{repo}/pulls/comments
```

Lists review comments for all pull requests in a repository. By default,
review comments are in ascending order by ID.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

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
  Can be one of: `created`, `updated`, `created_at`

* **`direction`** (string)
  The direction to sort results. Ignored without sort parameter.
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

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/comments
```

**Response schema (Status: 200):**

Array of `Pull Request Review Comment`:

* `url`: required, string
* `pull_request_review_id`: required, integer or null, format: int64
* `id`: required, integer, format: int64
* `node_id`: required, string
* `diff_hunk`: required, string
* `path`: required, string
* `position`: integer
* `original_position`: integer
* `commit_id`: required, string
* `original_commit_id`: required, string
* `in_reply_to_id`: integer
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
* `body`: required, string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `html_url`: required, string, format: uri
* `pull_request_url`: required, string, format: uri
* `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
* `_links`: required, object:
  * `self`: required, object:
    * `href`: required, string, format: uri
  * `html`: required, object:
    * `href`: required, string, format: uri
  * `pull_request`: required, object:
    * `href`: required, string, format: uri
* `start_line`: integer or null
* `original_start_line`: integer or null
* `start_side`: string or null, enum: `LEFT`, `RIGHT`, `null`, default: `"RIGHT"`
* `line`: integer
* `original_line`: integer
* `side`: string, enum: `LEFT`, `RIGHT`, default: `"RIGHT"`
* `subject_type`: string, enum: `line`, `file`
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
* `body_html`: string
* `body_text`: string

## Get a review comment for a pull request

```
GET /repos/{owner}/{repo}/pulls/comments/{comment_id}
```

Provides details for a specified review comment.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

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
  https://api.github.com/repos/OWNER/REPO/pulls/comments/COMMENT_ID
```

**Response schema (Status: 200):**

* `url`: required, string
* `pull_request_review_id`: required, integer or null, format: int64
* `id`: required, integer, format: int64
* `node_id`: required, string
* `diff_hunk`: required, string
* `path`: required, string
* `position`: integer
* `original_position`: integer
* `commit_id`: required, string
* `original_commit_id`: required, string
* `in_reply_to_id`: integer
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
* `body`: required, string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `html_url`: required, string, format: uri
* `pull_request_url`: required, string, format: uri
* `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
* `_links`: required, object:
  * `self`: required, object:
    * `href`: required, string, format: uri
  * `html`: required, object:
    * `href`: required, string, format: uri
  * `pull_request`: required, object:
    * `href`: required, string, format: uri
* `start_line`: integer or null
* `original_start_line`: integer or null
* `start_side`: string or null, enum: `LEFT`, `RIGHT`, `null`, default: `"RIGHT"`
* `line`: integer
* `original_line`: integer
* `side`: string, enum: `LEFT`, `RIGHT`, default: `"RIGHT"`
* `subject_type`: string, enum: `line`, `file`
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
* `body_html`: string
* `body_text`: string

## Update a review comment for a pull request

```
PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}
```

Edits the content of a specified review comment.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

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
  The text of the reply to the review comment.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/pulls/comments/COMMENT_ID \
  -d '{
  "body": "I like this too!"
}'
```

**Response schema (Status: 200):**

Same response schema as [Get a review comment for a pull request](#get-a-review-comment-for-a-pull-request).

## Delete a review comment for a pull request

```
DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}
```

Deletes a review comment.

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

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/pulls/comments/COMMENT_ID
```

**Response schema (Status: 204):**

## List review comments on a pull request

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/comments
```

Lists all review comments for a specified pull request. By default, review comments
are in ascending order by ID.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

* **`sort`** (string)
  The property to sort the results by.
  Default: `created`
  Can be one of: `created`, `updated`

* **`direction`** (string)
  The direction to sort results. Ignored without sort parameter.
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

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/comments
```

**Response schema (Status: 200):**

Same response schema as [List review comments in a repository](#list-review-comments-in-a-repository).

## Create a review comment for a pull request

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/comments
```

Creates a review comment on the diff of a specified pull request. To add a regular comment to a pull request timeline, see "Create an issue comment."
If your comment applies to more than one line in the pull request diff, you should use the parameters line, side, and optionally start\_line and start\_side in your request.
The position parameter is closing down. If you use position, the line, side, start\_line, and start\_side parameters are not required.
This endpoint triggers notifications. Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "Rate limits for the API"
and "Best practices for using the REST API."
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

#### Body parameters

* **`body`** (string) (required)
  The text of the review comment.

* **`commit_id`** (string) (required)
  The SHA of the commit needing a comment. Not using the latest commit SHA may render your comment outdated if a subsequent commit modifies the line you specify as the position.

* **`path`** (string) (required)
  The relative path to the file that necessitates a comment.

* **`position`** (integer)
  This parameter is closing down. Use line instead. The position in the diff where you want to add a review comment. Note this value is not the same as the line number in the file. The position value equals the number of lines down from the first "@@" hunk header in the file you want to add a comment. The line just below the "@@" line is position 1, the next line is position 2, and so on. The position in the diff continues to increase through lines of whitespace and additional hunks until the beginning of a new file.

* **`side`** (string)
  In a split diff view, the side of the diff that the pull request's changes appear on. Can be LEFT or RIGHT. Use LEFT for deletions that appear in red. Use RIGHT for additions that appear in green or unchanged lines that appear in white and are shown for context. For a multi-line comment, side represents whether the last line of the comment range is a deletion or addition. For more information, see "Diff view options" in the GitHub Help documentation.
  Can be one of: `LEFT`, `RIGHT`

* **`line`** (integer)
  Required unless using subject\_type:file. The line of the blob in the pull request diff that the comment applies to. For a multi-line comment, the last line of the range that your comment applies to.

* **`start_line`** (integer)
  Required when using multi-line comments unless using in\_reply\_to. The start\_line is the first line in the pull request diff that your multi-line comment applies to. To learn more about multi-line comments, see "Commenting on a pull request" in the GitHub Help documentation.

* **`start_side`** (string)
  Required when using multi-line comments unless using in\_reply\_to. The start\_side is the starting side of the diff that the comment applies to. Can be LEFT or RIGHT. To learn more about multi-line comments, see "Commenting on a pull request" in the GitHub Help documentation. See side in this table for additional context.
  Can be one of: `LEFT`, `RIGHT`, `side`

* **`in_reply_to`** (integer)
  The ID of the review comment to reply to. To find the ID of a review comment with "List review comments on a pull request". When specified, all parameters other than body in the request body are ignored.

* **`subject_type`** (string)
  The level at which the comment is targeted.
  Can be one of: `line`, `file`

### HTTP response status codes

* **201** - Created

* **403** - Forbidden

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example for a multi-line comment

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/comments \
  -d '{
  "body": "Great stuff!",
  "commit_id": "6dcb09b5b57875f334f61aebed695e2e4193db5e",
  "path": "file1.txt",
  "start_line": 1,
  "start_side": "RIGHT",
  "line": 2,
  "side": "RIGHT"
}'
```

**Response schema (Status: 201):**

Same response schema as [Get a review comment for a pull request](#get-a-review-comment-for-a-pull-request).

## Create a reply for a review comment

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies
```

Creates a reply to a review comment for a pull request. For the comment\_id, provide the ID of the review comment you are replying to. This must be the ID of a top-level review comment, not a reply to that comment. Replies to replies are not supported.
This endpoint triggers notifications. Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "Rate limits for the API"
and "Best practices for using the REST API."
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

* **`comment_id`** (integer) (required)
  The unique identifier of the comment.

#### Body parameters

* **`body`** (string) (required)
  The text of the review comment.

### HTTP response status codes

* **201** - Created

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/comments/COMMENT_ID/replies \
  -d '{
  "body": "Great stuff!"
}'
```

**Response schema (Status: 201):**

Same response schema as [Get a review comment for a pull request](#get-a-review-comment-for-a-pull-request).