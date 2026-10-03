---
title: REST API endpoints for workflows
url: https://docs.github.com/en/rest/actions/workflows
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for workflows

Use the REST API to interact with workflows in GitHub Actions.

## About workflows in GitHub Actions

You can use the REST API to view workflows for a repository in GitHub Actions. Workflows automate your software development life cycle with a wide range of tools and services. For more information, see [Workflows](/en/actions/concepts/workflows-and-actions/workflows) in the GitHub Actions documentation.

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List repository workflows

```
GET /repos/{owner}/{repo}/actions/workflows
```

Lists the workflows in a repository.
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

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/workflows
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `workflows`: required, array of `Workflow`:
  * `id`: required, integer
  * `node_id`: required, string
  * `name`: required, string
  * `path`: required, string
  * `state`: required, string, enum: `active`, `deleted`, `disabled_fork`, `disabled_inactivity`, `disabled_manually`
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time
  * `url`: required, string
  * `html_url`: required, string
  * `badge_url`: required, string
  * `deleted_at`: string, format: date-time

## Get a workflow

```
GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}
```

Gets a specific workflow. You can replace workflow\_id with the workflow
file name. For example, you could use main.yaml.
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

* **`workflow_id`** (string) (required)
  The ID of the workflow. You can also pass the workflow file name as a string.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/WORKFLOW_ID
```

**Response schema (Status: 200):**

* `id`: required, integer
* `node_id`: required, string
* `name`: required, string
* `path`: required, string
* `state`: required, string, enum: `active`, `deleted`, `disabled_fork`, `disabled_inactivity`, `disabled_manually`
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `url`: required, string
* `html_url`: required, string
* `badge_url`: required, string
* `deleted_at`: string, format: date-time

## Disable a workflow

```
PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/disable
```

Disables a workflow and sets the state of the workflow to disabled\_manually. You can replace workflow\_id with the workflow file name. For example, you could use main.yaml.
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

* **`workflow_id`** (string) (required)
  The ID of the workflow. You can also pass the workflow file name as a string.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/WORKFLOW_ID/disable
```

**Response schema (Status: 204):**

## Create a workflow dispatch event

```
POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
```

You can use this endpoint to manually trigger a GitHub Actions workflow run. You can replace workflow\_id with the workflow file name. For example, you could use main.yaml.
You must configure your GitHub Actions workflow to run when the workflow\_dispatch webhook event occurs. The inputs are configured in the workflow file. For more information about how to configure the workflow\_dispatch event in the workflow file, see "Events that trigger workflows."
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

* **`workflow_id`** (string) (required)
  The ID of the workflow. You can also pass the workflow file name as a string.

#### Body parameters

* **`ref`** (string) (required)
  The git reference for the workflow. The reference can be a branch or tag name.

* **`inputs`** (object)
  Input keys and values configured in the workflow file. The maximum number of properties is 25. Any default properties configured in the workflow file will be used when inputs are omitted.

### HTTP response status codes

* **200** - Response including the workflow run ID and URLs.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/WORKFLOW_ID/dispatches \
  -d '{
  "ref": "topic-branch",
  "inputs": {
    "name": "Mona the Octocat",
    "home": "San Francisco, CA"
  }
}'
```

**Response schema (Status: 200):**

* `workflow_run_id`: required, integer, format: int64
* `run_url`: required, string, format: uri
* `html_url`: required, string, format: uri

## Enable a workflow

```
PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable
```

Enables a workflow and sets the state of the workflow to active. You can replace workflow\_id with the workflow file name. For example, you could use main.yaml.
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

* **`workflow_id`** (string) (required)
  The ID of the workflow. You can also pass the workflow file name as a string.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/WORKFLOW_ID/enable
```

**Response schema (Status: 204):**

## Get workflow usage

```
GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/timing
```

Warning

This endpoint is in the process of closing down. Refer to "Actions Get workflow usage and Get workflow run usage endpoints closing down" for more information.

Gets the number of billable minutes used by a specific workflow during the current billing cycle. Billable minutes only apply to workflows in private repositories that use GitHub-hosted runners. Usage is listed for each GitHub-hosted runner operating system in milliseconds. Any job re-runs are also included in the usage. The usage does not include the multiplier for macOS and Windows runners and is not rounded up to the nearest whole minute. For more information, see "Managing billing for GitHub Actions".
You can replace workflow\_id with the workflow file name. For example, you could use main.yaml.
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

* **`workflow_id`** (string) (required)
  The ID of the workflow. You can also pass the workflow file name as a string.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/WORKFLOW_ID/timing
```

**Response schema (Status: 200):**

* `billable`: required, object:
  * `UBUNTU`: object:
    * `total_ms`: integer
  * `MACOS`: object:
    * `total_ms`: integer
  * `WINDOWS`: object:
    * `total_ms`: integer