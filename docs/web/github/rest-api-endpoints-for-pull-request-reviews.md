---
title: REST API endpoints for pull request reviews
url: https://docs.github.com/en/rest/pulls/reviews
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for pull request reviews

Use the REST API to interact with pull request reviews.

## About pull request reviews

Pull Request Reviews are groups of pull request review comments on a pull request, grouped together with a state and optional body comment.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List reviews for a pull request

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews
```

Lists all reviews for a specified pull request. The list of reviews returns in chronological order.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - The list of reviews returns in chronological order.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews
```

**Response schema (Status: 200):**

Array of `Pull Request Review`:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
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
  * `state`: required, string
  * `html_url`: required, string, format: uri
  * `pull_request_url`: required, string, format: uri
  * `_links`: required, object:
    * `html`: required, object:
      * `href`: required, string
    * `pull_request`: required, object:
      * `href`: required, string
  * `submitted_at`: string, format: date-time
  * `commit_id`: required, string or null
  * `body_html`: string
  * `body_text`: string
  * `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`

## Create a review for a pull request

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
```

Creates a review on a specified pull request.
This endpoint triggers notifications. Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "Rate limits for the API" and "Best practices for using the REST API."
Pull request reviews created in the PENDING state are not submitted and therefore do not include the submitted_at property in the response. To create a pending review for a pull request, leave the event parameter blank. For more information about submitting a PENDING review, see "Submit a review for a pull request."
Note

To comment on a specific line in a file, you need to first determine the position of that line in the diff. To see a pull request diff, add the application/vnd.github.v3.diff media type to the Accept header of a call to the Get a pull request endpoint.

The position value equals the number of lines down from the first "@@" hunk header in the file you want to add a comment. The line just below the "@@" line is position 1, the next line is position 2, and so on. The position in the diff continues to increase through lines of whitespace and additional hunks until the beginning of a new file.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

#### Body parameters

- **`commit_id`** (string)
  The SHA of the commit that needs a review. Not using the latest commit SHA may render your review comment outdated if a subsequent commit modifies the line you specify as the position. Defaults to the most recent commit in the pull request when you do not specify a value.

- **`body`** (string)
  Required when using REQUEST_CHANGES or COMMENT for the event parameter. The body text of the pull request review.

- **`event`** (string)
  The review action you want to perform. The review actions include: APPROVE, REQUEST_CHANGES, or COMMENT. By leaving this blank, you set the review action state to PENDING, which means you will need to submit the pull request review when you are ready.
  Can be one of: `APPROVE`, `REQUEST_CHANGES`, `COMMENT`

- **`comments`** (array of objects)
  Use the following table to specify the location, destination, and contents of the draft review comment.
  - **`path`** (string) (required)
    The relative path to the file that necessitates a review comment.
  - **`position`** (integer)
    The position in the diff where you want to add a review comment. Note this value is not the same as the line number in the file. The position value equals the number of lines down from the first "@@" hunk header in the file you want to add a comment. The line just below the "@@" line is position 1, the next line is position 2, and so on. The position in the diff continues to increase through lines of whitespace and additional hunks until the beginning of a new file.
  - **`body`** (string) (required)
    Text of the review comment.
  - **`line`** (integer)
  - **`side`** (string)
  - **`start_line`** (integer)
  - **`start_side`** (string)

### HTTP response status codes

- **200** - OK

- **403** - Forbidden

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews \
  -d '{
  "commit_id": "ecdd80bb57125d7ba9641ffaa4d7d2c19d3f3091",
  "body": "This is close to perfect! Please address the suggested inline change.",
  "event": "REQUEST_CHANGES",
  "comments": [
    {
      "path": "file.md",
      "position": 6,
      "body": "Please add more information here, and fix this typo."
    }
  ]
}'
```

**Response schema (Status: 200):**

* `id`: required, integer, format: int64
* `node_id`: required, string
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
* `state`: required, string
* `html_url`: required, string, format: uri
* `pull_request_url`: required, string, format: uri
* `_links`: required, object:
  * `html`: required, object:
    * `href`: required, string
  * `pull_request`: required, object:
    * `href`: required, string
* `submitted_at`: string, format: date-time
* `commit_id`: required, string or null
* `body_html`: string
* `body_text`: string
* `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`

## Get a review for a pull request

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}
```

Retrieves a pull request review by its ID.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

- **`review_id`** (integer) (required)
  The unique identifier of the review.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews/REVIEW_ID
```

**Response schema (Status: 200):**

Same response schema as [Create a review for a pull request](#create-a-review-for-a-pull-request).

## Update a review for a pull request

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}
```

Updates the contents of a specified review summary comment.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

- **`review_id`** (integer) (required)
  The unique identifier of the review.

#### Body parameters

- **`body`** (string) (required)
  The body text of the pull request review.

### HTTP response status codes

- **200** - OK

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews/REVIEW_ID \
  -d '{
  "body": "This is close to perfect! Please address the suggested inline change. And add more about this."
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a review for a pull request](#create-a-review-for-a-pull-request).

## Delete a pending review for a pull request

```
DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}
```

Deletes a pull request review that has not been submitted. Submitted reviews cannot be deleted.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

- **`review_id`** (integer) (required)
  The unique identifier of the review.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews/REVIEW_ID
```

**Response schema (Status: 200):**

Same response schema as [Create a review for a pull request](#create-a-review-for-a-pull-request).

## List comments for a pull request review

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments
```

Lists comments for a specific pull request review.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

- **`review_id`** (integer) (required)
  The unique identifier of the review.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews/REVIEW_ID/comments
```

**Response schema (Status: 200):**

Array of `Legacy Review Comment`:
  * `url`: required, string, format: uri
  * `pull_request_review_id`: required, integer or null, format: int64
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `diff_hunk`: required, string
  * `path`: required, string
  * `position`: required, integer or null
  * `original_position`: required, integer
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
    * `self`: required, `Link`:
      * `href`: required, string
    * `html`: required, `Link` (see above)
    * `pull_request`: required, `Link` (see above)
  * `body_text`: string
  * `body_html`: string
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
  * `side`: string, enum: `LEFT`, `RIGHT`, default: `"RIGHT"`
  * `start_side`: string or null, enum: `LEFT`, `RIGHT`, `null`, default: `"RIGHT"`
  * `line`: integer
  * `original_line`: integer
  * `start_line`: integer or null
  * `original_start_line`: integer or null
  * `subject_type`: string, enum: `line`, `file`

## Dismiss a review for a pull request

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals
```

Dismisses a specified review on a pull request.
Note

To dismiss a pull request review on a protected branch, you must be a repository administrator or be included in the list of people or teams who can dismiss pull request reviews.

This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

- **`review_id`** (integer) (required)
  The unique identifier of the review.

#### Body parameters

- **`message`** (string) (required)
  The message for the pull request review dismissal

- **`event`** (string)
  Can be one of: `DISMISS`

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews/REVIEW_ID/dismissals \
  -d '{
  "message": "You are dismissed",
  "event": "DISMISS"
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a review for a pull request](#create-a-review-for-a-pull-request).

## Submit a review for a pull request

```
POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events
```

Submits a pending review for a pull request. For more information about creating a pending review for a pull request, see "Create a review for a pull request."
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github-commitcomment.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github-commitcomment.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github-commitcomment.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github-commitcomment.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`pull_number`** (integer) (required)
  The number that identifies the pull request.

- **`review_id`** (integer) (required)
  The unique identifier of the review.

#### Body parameters

- **`body`** (string)
  The body text of the pull request review

- **`event`** (string) (required)
  The review action you want to perform. The review actions include: APPROVE, REQUEST_CHANGES, or COMMENT. When you leave this blank, the API returns HTTP 422 (Unrecognizable entity) and sets the review action state to PENDING, which means you will need to re-submit the pull request review using a review action.
  Can be one of: `APPROVE`, `REQUEST_CHANGES`, `COMMENT`

### HTTP response status codes

- **200** - OK

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/reviews/REVIEW_ID/events \
  -d '{
  "body": "Here is the body for the review.",
  "event": "REQUEST_CHANGES"
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a review for a pull request](#create-a-review-for-a-pull-request).