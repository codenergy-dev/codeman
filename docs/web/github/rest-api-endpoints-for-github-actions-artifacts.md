---
title: REST API endpoints for GitHub Actions artifacts
url: https://docs.github.com/en/rest/actions/artifacts
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for GitHub Actions artifacts

Use the REST API to interact with artifacts in GitHub Actions.

## About artifacts in GitHub Actions

You can use the REST API to download, delete, and retrieve information about workflow artifacts in GitHub Actions. Artifacts enable you to share data between jobs in a workflow and store data once that workflow has completed. For more information, see [Store and share data with workflow artifacts](/en/actions/tutorials/store-and-share-data).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List artifacts for a repository

```
GET /repos/{owner}/{repo}/actions/artifacts
```

Lists all artifacts for a repository.
Anyone with read access to the repository can use this endpoint.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint with a private repository.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

* **`name`** (string)
  The name field of an artifact. When specified, only artifacts with this name will be returned.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/artifacts
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `artifacts`: required, array of `Artifact`:
  * `id`: required, integer
  * `node_id`: required, string
  * `name`: required, string
  * `size_in_bytes`: required, integer
  * `url`: required, string
  * `archive_download_url`: required, string
  * `expired`: required, boolean
  * `created_at`: required, string or null, format: date-time
  * `expires_at`: required, string or null, format: date-time
  * `updated_at`: required, string or null, format: date-time
  * `digest`: string or null
  * `workflow_run`: object or null:
    * `id`: integer
    * `repository_id`: integer
    * `head_repository_id`: integer
    * `head_branch`: string
    * `head_sha`: string

## Get an artifact

```
GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}
```

Gets a specific artifact for a workflow run.
Anyone with read access to the repository can use this endpoint.
If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`artifact_id`** (integer) (required)
  The unique identifier of the artifact.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/artifacts/ARTIFACT_ID
```

**Response schema (Status: 200):**

* `id`: required, integer
* `node_id`: required, string
* `name`: required, string
* `size_in_bytes`: required, integer
* `url`: required, string
* `archive_download_url`: required, string
* `expired`: required, boolean
* `created_at`: required, string or null, format: date-time
* `expires_at`: required, string or null, format: date-time
* `updated_at`: required, string or null, format: date-time
* `digest`: string or null
* `workflow_run`: object or null:
  * `id`: integer
  * `repository_id`: integer
  * `head_repository_id`: integer
  * `head_branch`: string
  * `head_sha`: string

## Delete an artifact

```
DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}
```

Deletes an artifact for a workflow run.
OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`artifact_id`** (integer) (required)
  The unique identifier of the artifact.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/actions/artifacts/ARTIFACT_ID
```

**Response schema (Status: 204):**

## Download an artifact

```
GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}
```

Gets a redirect URL to download an archive for a repository. This URL expires after 1 minute. Look for Location: in
the response header to find the URL for the download. The :archive\_format must be zip.
OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`artifact_id`** (integer) (required)
  The unique identifier of the artifact.

* **`archive_format`** (string) (required)

### HTTP response status codes

* **302** - Found

* **410** - Gone

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/artifacts/ARTIFACT_ID/ARCHIVE_FORMAT
```

**Response schema (Status: 302):**

## List workflow run artifacts

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts
```

Lists artifacts for a workflow run.
Anyone with read access to the repository can use this endpoint.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint with a private repository.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

* **`name`** (string)
  The name field of an artifact. When specified, only artifacts with this name will be returned.

* **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/artifacts
```

**Response schema (Status: 200):**

Same response schema as [List artifacts for a repository](#list-artifacts-for-a-repository).