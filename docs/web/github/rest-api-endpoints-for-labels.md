---
title: REST API endpoints for labels
url: https://docs.github.com/en/rest/issues/labels
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for labels

Use the REST API to manage labels for repositories, issues and pull requests.

## About labels

You can use the REST API to manage labels for a repository and add or remove labels to issues and pull requests. Every pull request is an issue, but not every issue is a pull request. For this reason, "shared" actions for both features, like managing assignees, labels, and milestones, are provided within the Issues endpoints.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List labels for an issue

```
GET /repos/{owner}/{repo}/issues/{issue_number}/labels
```

Lists all labels for an issue.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`issue_number`** (integer) (required)
  The number that identifies the issue.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

- **301** - Moved permanently

- **404** - Resource not found

- **410** - Gone

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/labels
```

**Response schema (Status: 200):**

Array of `Label`:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `url`: required, string, format: uri
  * `name`: required, string
  * `description`: required, string or null
  * `color`: required, string
  * `default`: required, boolean
  * `archived_at`: required, string or null, format: date-time
  * `archived_by`: required, all of:
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

## Add labels to an issue

```
POST /repos/{owner}/{repo}/issues/{issue_number}/labels
```

Adds labels to an issue.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`issue_number`** (integer) (required)
  The number that identifies the issue.

#### Body parameters

- **`labels`** (array)
  The labels to add to the issue's existing labels. You can also pass an array of labels directly, but GitHub recommends passing an object with the labels key. To replace all of the labels for an issue, use "Set labels for an issue."

### HTTP response status codes

- **200** - OK

- **301** - Moved permanently

- **404** - Resource not found

- **410** - Gone

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/labels \
  -d '{
  "labels": [
    "bug",
    "enhancement"
  ]
}'
```

**Response schema (Status: 200):**

Same response schema as [List labels for an issue](#list-labels-for-an-issue).

## Set labels for an issue

```
PUT /repos/{owner}/{repo}/issues/{issue_number}/labels
```

Removes any previous labels and sets the new labels for an issue.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`issue_number`** (integer) (required)
  The number that identifies the issue.

#### Body parameters

- **`labels`** (array of strings)
  The names of the labels to set for the issue. The labels you set replace any existing labels. You can pass an empty array to remove all labels. Alternatively, you can pass a single label as a string or an array of labels directly, but GitHub recommends passing an object with the labels key. You can also add labels to the existing labels for an issue. For more information, see "Add labels to an issue."

### HTTP response status codes

- **200** - OK

- **301** - Moved permanently

- **404** - Resource not found

- **410** - Gone

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/labels \
  -d '{
  "labels": [
    "bug",
    "enhancement"
  ]
}'
```

**Response schema (Status: 200):**

Same response schema as [List labels for an issue](#list-labels-for-an-issue).

## Remove all labels from an issue

```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels
```

Removes all labels from an issue.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`issue_number`** (integer) (required)
  The number that identifies the issue.

### HTTP response status codes

- **204** - No Content

- **301** - Moved permanently

- **404** - Resource not found

- **410** - Gone

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/labels
```

**Response schema (Status: 204):**

## Remove a label from an issue

```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}
```

Removes the specified label from the issue, and returns the remaining labels on the issue. This endpoint returns a 404 Not Found status if the label does not exist.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`issue_number`** (integer) (required)
  The number that identifies the issue.

- **`name`** (string) (required)

### HTTP response status codes

- **200** - OK

- **301** - Moved permanently

- **404** - Resource not found

- **410** - Gone

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/labels/NAME
```

**Response schema (Status: 200):**

Same response schema as [List labels for an issue](#list-labels-for-an-issue).

## List labels for a repository

```
GET /repos/{owner}/{repo}/labels
```

Lists all labels for a repository.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

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
  https://api.github.com/repos/OWNER/REPO/labels
```

**Response schema (Status: 200):**

Same response schema as [List labels for an issue](#list-labels-for-an-issue).

## Create a label

```
POST /repos/{owner}/{repo}/labels
```

Creates a label for the specified repository with the given name and color. The name and color parameters are required. The color must be a valid hexadecimal color code.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

#### Body parameters

- **`name`** (string) (required)
  The name of the label. Emoji can be added to label names, using either native emoji or colon-style markup. For example, typing :strawberry: will render the emoji . For a full list of available emoji and codes, see "Emoji cheat sheet."

- **`color`** (string)
  The hexadecimal color code for the label, without the leading #.

- **`description`** (string)
  A short description of the label. Must be 100 characters or fewer.

### HTTP response status codes

- **201** - Created

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/labels \
  -d '{
  "name": "bug",
  "description": "Something isn'\''t working",
  "color": "f29513"
}'
```

**Response schema (Status: 201):**

* `id`: required, integer, format: int64
* `node_id`: required, string
* `url`: required, string, format: uri
* `name`: required, string
* `description`: required, string or null
* `color`: required, string
* `default`: required, boolean
* `archived_at`: required, string or null, format: date-time
* `archived_by`: required, all of:
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

## Get a label

```
GET /repos/{owner}/{repo}/labels/{name}
```

Gets a label using the given name.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`name`** (string) (required)

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/labels/NAME
```

**Response schema (Status: 200):**

Same response schema as [Create a label](#create-a-label).

## Update a label

```
PATCH /repos/{owner}/{repo}/labels/{name}
```

Updates a label using the given label name.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`name`** (string) (required)

#### Body parameters

- **`new_name`** (string)
  The new name of the label. Emoji can be added to label names, using either native emoji or colon-style markup. For example, typing :strawberry: will render the emoji . For a full list of available emoji and codes, see "Emoji cheat sheet."

- **`color`** (string)
  The hexadecimal color code for the label, without the leading #.

- **`description`** (string)
  A short description of the label. Must be 100 characters or fewer.

- **`archived`** (boolean)
  Whether to archive or unarchive the label. Archived labels cannot be added to issues or pull requests. For more information, see "Archiving labels."

### HTTP response status codes

- **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/labels/NAME \
  -d '{
  "new_name": "bug :bug:",
  "description": "Small bug fix required",
  "color": "b01f26"
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a label](#create-a-label).

## Delete a label

```
DELETE /repos/{owner}/{repo}/labels/{name}
```

Deletes a label using the given label name.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`name`** (string) (required)

### HTTP response status codes

- **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/labels/NAME
```

**Response schema (Status: 204):**

## List labels for issues in a milestone

```
GET /repos/{owner}/{repo}/milestones/{milestone_number}/labels
```

Lists labels for issues in a milestone.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`milestone_number`** (integer) (required)
  The number that identifies the milestone.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/milestones/MILESTONE_NUMBER/labels
```

**Response schema (Status: 200):**

Same response schema as [List labels for an issue](#list-labels-for-an-issue).