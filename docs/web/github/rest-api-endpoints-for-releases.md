---
title: "REST API endpoints for releases"
url: https://docs.github.com/en/rest/releases/releases
created_at: 2026-10-30T11:47:44-03:00
updated_at: 2026-10-30T11:47:44-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for releases

Use the REST API to create, modify, and delete releases.

> [!NOTE]
> These endpoints replace the endpoints to manage downloads. You can retrieve the download count and browser download URL from these endpoints.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List releases

```
GET /repos/{owner}/{repo}/releases
```

This returns a list of releases, which does not include regular Git tags that have not been associated with a release. To get a list of Git tags, use the Repository Tags API.
Information about published releases are available to everyone. Only users with push access will receive listings for draft releases.

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
  https://api.github.com/repos/OWNER/REPO/releases
```

**Response schema (Status: 200):**

Array of `Release`:
  * `url`: required, string, format: uri
  * `html_url`: required, string, format: uri
  * `assets_url`: required, string, format: uri
  * `upload_url`: required, string
  * `tarball_url`: required, string or null, format: uri
  * `zipball_url`: required, string or null, format: uri
  * `id`: required, integer
  * `node_id`: required, string
  * `tag_name`: required, string
  * `target_commitish`: required, string
  * `name`: required, string or null
  * `body`: string or null
  * `draft`: required, boolean
  * `prerelease`: required, boolean
  * `immutable`: boolean
  * `created_at`: required, string, format: date-time
  * `published_at`: required, string or null, format: date-time
  * `updated_at`: string or null, format: date-time
  * `author`: required, `Simple User`:
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
  * `assets`: required, array of `Release Asset`:
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
      * **Simple User** (see above)
  * `body_html`: string
  * `body_text`: string
  * `mentions_count`: integer
  * `discussion_url`: string, format: uri
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

## Create a release

```
POST /repos/{owner}/{repo}/releases
```

Users with push access to the repository can create a release.
Note

If the commit identified by target_commitish (or, when target_commitish is omitted, the latest commit on the default branch) adds or modifies any file under .github/workflows/ relative to the repository's default branch, the authenticating token must be authorized to modify workflows. Otherwise, this endpoint returns 404 Not Found; some authentication paths surface 403 Resource not accessible by integration instead.

OAuth app tokens and personal access tokens (classic) need the workflow scope when the resolved target commit modifies workflow files. Fine-grained access tokens and GitHub App installation tokens also need the "Workflows" repository permission (write). The GITHUB_TOKEN available to GitHub Actions cannot be authorized for this; for more information, see "Automatic token authentication".
This endpoint triggers notifications. Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "Rate limits for the API" and "Best practices for using the REST API."

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

- **`tag_name`** (string) (required)
  The name of the tag.

- **`target_commitish`** (string)
  Specifies the commitish value that determines where the Git tag is created from. Can be any branch or commit SHA. Unused if the Git tag already exists. Default: the repository's default branch.

- **`name`** (string)
  The name of the release.

- **`body`** (string)
  Text describing the contents of the tag.

- **`draft`** (boolean)
  true to create a draft (unpublished) release, false to create a published one.
  Default: `false`

- **`prerelease`** (boolean)
  true to identify the release as a prerelease. false to identify the release as a full release.
  Default: `false`

- **`discussion_category_name`** (string)
  If specified, a discussion of the specified category is created and linked to the release. The value must be a category that already exists in the repository. For more information, see "Managing categories for discussions in your repository."

- **`generate_release_notes`** (boolean)
  Whether to automatically generate the name and body for this release. If name is specified, the specified name will be used; otherwise, a name will be automatically generated. If body is specified, the body will be pre-pended to the automatically generated notes.
  Default: `false`

- **`make_latest`** (string)
  Specifies whether this release should be set as the latest release for the repository. Drafts and prereleases cannot be set as latest. Defaults to true for newly published releases. legacy specifies that the latest release should be determined based on the release creation date and higher semantic version.
  Default: `true`
  Can be one of: `true`, `false`, `legacy`

### HTTP response status codes

- **201** - Created

- **404** - Not Found if the discussion category name is invalid

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/releases \
  -d '{
  "tag_name": "v1.0.0",
  "target_commitish": "master",
  "name": "v1.0.0",
  "body": "Description of the release",
  "draft": false,
  "prerelease": false,
  "generate_release_notes": false
}'
```

**Response schema (Status: 201):**

* `url`: required, string, format: uri
* `html_url`: required, string, format: uri
* `assets_url`: required, string, format: uri
* `upload_url`: required, string
* `tarball_url`: required, string or null, format: uri
* `zipball_url`: required, string or null, format: uri
* `id`: required, integer
* `node_id`: required, string
* `tag_name`: required, string
* `target_commitish`: required, string
* `name`: required, string or null
* `body`: string or null
* `draft`: required, boolean
* `prerelease`: required, boolean
* `immutable`: boolean
* `created_at`: required, string, format: date-time
* `published_at`: required, string or null, format: date-time
* `updated_at`: string or null, format: date-time
* `author`: required, `Simple User`:
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
* `assets`: required, array of `Release Asset`:
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
    * **Simple User** (see above)
* `body_html`: string
* `body_text`: string
* `mentions_count`: integer
* `discussion_url`: string, format: uri
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

## Generate release notes content for a release

```
POST /repos/{owner}/{repo}/releases/generate-notes
```

Generate a name and body describing a release. The body content will be markdown formatted and contain information like the changes since last release and users who contributed. The generated release notes are not saved anywhere. They are intended to be generated and used when creating a new release.

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

- **`tag_name`** (string) (required)
  The tag name for the release. This can be an existing tag or a new one.

- **`target_commitish`** (string)
  Specifies the commitish value that will be the target for the release's tag. Required if the supplied tag_name does not reference an existing tag. Ignored if the tag_name already exists.

- **`previous_tag_name`** (string)
  The name of the previous tag to use as the starting point for the release notes. Use to manually specify the range for the set of changes considered as part this release.

- **`configuration_file_path`** (string)
  Specifies a path to a file in the repository containing configuration settings used for generating the release notes. If unspecified, the configuration file located in the repository at '.github/release.yml' or '.github/release.yaml' will be used. If that is not present, the default configuration will be used.

### HTTP response status codes

- **200** - Name and body of generated release notes

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/releases/generate-notes \
  -d '{
  "tag_name": "v1.0.0",
  "target_commitish": "main",
  "previous_tag_name": "v0.9.2",
  "configuration_file_path": ".github/custom_release_config.yml"
}'
```

**Response schema (Status: 200):**

* `name`: required, string
* `body`: required, string

## Get the latest release

```
GET /repos/{owner}/{repo}/releases/latest
```

View the latest published full release for the repository.
The latest release is the most recent non-prerelease, non-draft release, sorted by the created_at attribute. The created_at attribute is the date of the commit used for the release, and not the date when the release was drafted or published.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/releases/latest
```

**Response schema (Status: 200):**

Same response schema as [Create a release](#create-a-release).

## Get a release by tag name

```
GET /repos/{owner}/{repo}/releases/tags/{tag}
```

Get a published release with the specified tag.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`tag`** (string) (required)
  tag parameter

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/releases/tags/TAG
```

**Response schema (Status: 200):**

Same response schema as [Create a release](#create-a-release).

## Get a release

```
GET /repos/{owner}/{repo}/releases/{release_id}
```

Gets a public release with the specified release ID.
Note

This returns an upload_url key corresponding to the endpoint for uploading release assets. This key is a hypermedia resource. For more information, see "Getting started with the REST API."

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

### HTTP response status codes

- **200** - Note: This returns an upload_url key corresponding to the endpoint for uploading release assets. This key is a hypermedia resource. For more information, see "Getting started with the REST API."

- **401** - Unauthorized

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/releases/RELEASE_ID
```

**Response schema (Status: 200):**

Same response schema as [Create a release](#create-a-release).

## Update a release

```
PATCH /repos/{owner}/{repo}/releases/{release_id}
```

Users with push access to the repository can edit a release.
Note

If the resolved target commit (the new value of target_commitish if you are changing it, otherwise the existing target) adds or modifies any file under .github/workflows/ relative to the repository's default branch, the authenticating token must be authorized to modify workflows. Otherwise, this endpoint returns 404 Not Found; some authentication paths surface 403 Resource not accessible by integration instead.

OAuth app tokens and personal access tokens (classic) need the workflow scope when the resolved target commit modifies workflow files. Fine-grained access tokens and GitHub App installation tokens also need the "Workflows" repository permission (write). The GITHUB_TOKEN available to GitHub Actions cannot be authorized for this; for more information, see "Automatic token authentication".

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

#### Body parameters

- **`tag_name`** (string)
  The name of the tag.

- **`target_commitish`** (string)
  Specifies the commitish value that determines where the Git tag is created from. Can be any branch or commit SHA. Unused if the Git tag already exists. Default: the repository's default branch.

- **`name`** (string)
  The name of the release.

- **`body`** (string)
  Text describing the contents of the tag.

- **`draft`** (boolean)
  true makes the release a draft, and false publishes the release.

- **`prerelease`** (boolean)
  true to identify the release as a prerelease, false to identify the release as a full release.

- **`make_latest`** (string)
  Specifies whether this release should be set as the latest release for the repository. Drafts and prereleases cannot be set as latest. Defaults to true for newly published releases. legacy specifies that the latest release should be determined based on the release creation date and higher semantic version.
  Default: `true`
  Can be one of: `true`, `false`, `legacy`

- **`discussion_category_name`** (string)
  If specified, a discussion of the specified category is created and linked to the release. The value must be a category that already exists in the repository. If there is already a discussion linked to the release, this parameter is ignored. For more information, see "Managing categories for discussions in your repository."

### HTTP response status codes

- **200** - OK

- **404** - Not Found if the discussion category name is invalid

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/releases/RELEASE_ID \
  -d '{
  "tag_name": "v1.0.0",
  "target_commitish": "master",
  "name": "v1.0.0",
  "body": "Description of the release",
  "draft": false,
  "prerelease": false
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a release](#create-a-release).

## Delete a release

```
DELETE /repos/{owner}/{repo}/releases/{release_id}
```

Users with push access to the repository can delete a release.

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

### HTTP response status codes

- **204** - No Content

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/releases/RELEASE_ID
```

**Response schema (Status: 204):**
