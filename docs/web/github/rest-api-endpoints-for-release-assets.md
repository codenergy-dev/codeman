---
title: "REST API endpoints for release assets"
url: https://docs.github.com/en/rest/releases/assets
created_at: 2026-11-26T18:50:20-03:00
updated_at: 2026-11-26T18:50:20-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for release assets

Use the REST API to manage release assets.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Get a release asset

```
GET /repos/{owner}/{repo}/releases/assets/{asset_id}
```

To download the asset's binary content:

If within a browser, fetch the location specified in the browser_download_url key provided in the response.
Alternatively, set the Accept header of the request to
application/octet-stream.
The API will either redirect the client to the location, or stream it directly if possible.
API clients should handle both a 200 or 302 response.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`asset_id`** (integer) (required)
  The unique identifier of the asset.

### HTTP response status codes

- **200** - OK

- **302** - Found

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/releases/assets/ASSET_ID
```

**Response schema (Status: 200):**

* `url`: required, string, format: uri
* `browser_download_url`: required, string, format: uri
* `id`: required, integer
* `node_id`: required, string
* `name`: required, string
* `label`: required, string or null
* `state`: required, string, enum: `uploaded`, `open`
* `content_type`: required, string
* `size`: required, integer
* `digest`: required, string or null
* `download_count`: required, integer
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `uploader`: required, any of:
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

## Update a release asset

```
PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}
```

Users with push access to the repository can edit a release asset.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`asset_id`** (integer) (required)
  The unique identifier of the asset.

#### Body parameters

- **`name`** (string)
  The file name of the asset.

- **`label`** (string)
  An alternate short description of the asset. Used in place of the filename.

- **`state`** (string)

### HTTP response status codes

- **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/releases/assets/ASSET_ID \
  -d '{
  "name": "foo-1.0.0-osx.zip",
  "label": "Mac binary"
}'
```

**Response schema (Status: 200):**

Same response schema as [Get a release asset](#get-a-release-asset).

## Delete a release asset

```
DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}
```

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`asset_id`** (integer) (required)
  The unique identifier of the asset.

### HTTP response status codes

- **204** - No Content

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/releases/assets/ASSET_ID
```

**Response schema (Status: 204):**

## List release assets

```
GET /repos/{owner}/{repo}/releases/{release_id}/assets
```

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`release_id`** (integer) (required)
  The unique identifier of the release.

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
  https://api.github.com/repos/OWNER/REPO/releases/RELEASE_ID/assets
```

**Response schema (Status: 200):**

Array of `Release Asset`:
  * `url`: required, string, format: uri
  * `browser_download_url`: required, string, format: uri
  * `id`: required, integer
  * `node_id`: required, string
  * `name`: required, string
  * `label`: required, string or null
  * `state`: required, string, enum: `uploaded`, `open`
  * `content_type`: required, string
  * `size`: required, integer
  * `digest`: required, string or null
  * `download_count`: required, integer
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time
  * `uploader`: required, any of:
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

## Upload a release asset

```
POST /repos/{owner}/{repo}/releases/{release_id}/assets
```

This endpoint makes use of a Hypermedia relation to determine which URL to access. The endpoint you call to upload release assets is specific to your release. Use the upload_url returned in
the response of the Create a release endpoint to upload a release asset.
You need to use an HTTP client which supports SNI to make calls to this endpoint.
Most libraries will set the required Content-Length header automatically. Use the required Content-Type header to provide the media type of the asset. For a list of media types, see Media Types. For example:
application/zip
GitHub expects the asset data in its raw binary form, rather than JSON. You will send the raw binary content of the asset as the request body. Everything else about the endpoint is the same as the rest of the API. For example,
you'll still need to pass your authentication to be able to upload an asset.
When an upstream failure occurs, you will receive a 502 Bad Gateway status. This may leave an empty asset with a state of starter. It can be safely deleted.
Notes:

GitHub renames asset filenames that have special characters, non-alphanumeric characters, and leading or trailing periods. The "List release assets"
endpoint lists the renamed filenames. For more information and help, contact GitHub Support.
To find the release_id query the GET /repos/{owner}/{repo}/releases/latest endpoint.
If you upload an asset with the same filename as another uploaded asset, you'll receive an error and must delete the old file before you can re-upload the new asset.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`release_id`** (integer) (required)
  The unique identifier of the release.

- **`name`** (string) (required)

- **`label`** (string)

### HTTP response status codes

- **201** - Response for successful upload

- **422** - Response if you upload an asset with the same filename as another uploaded asset

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  "https://uploads.github.com/repos/OWNER/REPO/releases/RELEASE_ID/assets?name=example.zip" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@example.zip"
```

**Response schema (Status: 201):**

Same response schema as [Get a release asset](#get-a-release-asset).