---
title: REST API endpoints for Git blobs
url: https://docs.github.com/en/rest/git/blobs
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for Git blobs

Use the REST API to interact with a Git blob (binary large object), the object type used to store the contents of each file in a repository.

## About Git blobs

A Git blob (binary large object) is the object type used to store the contents of each file in a repository. The file's SHA-1 hash is computed and stored in the blob object. These endpoints allow you to read and write [blob objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)
to your Git database on GitHub. Blobs leverage custom media types. For more information about the use of media types in the API, see [Getting started with the REST API](/en/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Create a blob

```
POST /repos/{owner}/{repo}/git/blobs
```

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

#### Body parameters

* **`content`** (string) (required)
  The new blob's content.

* **`encoding`** (string)
  The encoding used for content. Currently, "utf-8" and "base64" are supported.
  Default: `utf-8`

### HTTP response status codes

* **201** - Created

* **403** - Forbidden

* **404** - Resource not found

* **409** - Conflict

* **422** - Validation failed

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/git/blobs \
  -d '{
  "content": "Content of the blob",
  "encoding": "utf-8"
}'
```

**Response schema (Status: 201):**

* `url`: required, string
* `sha`: required, string

## Get a blob

```
GET /repos/{owner}/{repo}/git/blobs/{file_sha}
```

The content in the response will always be Base64 encoded.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw blob data.
application/vnd.github+json: Returns a JSON representation of the blob with content as a base64 encoded string. This is the default if no media type is specified.

Note This endpoint supports blobs up to 100 megabytes in size.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`file_sha`** (string) (required)

### HTTP response status codes

* **200** - OK

* **403** - Forbidden

* **404** - Resource not found

* **409** - Conflict

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/git/blobs/FILE_SHA
```

**Response schema (Status: 200):**

* `content`: required, string
* `encoding`: required, string
* `url`: required, string, format: uri
* `sha`: required, string
* `size`: required, integer or null
* `node_id`: required, string
* `highlighted_content`: string