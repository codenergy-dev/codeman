---
title: REST API endpoints for workflow jobs
url: https://docs.github.com/en/rest/actions/workflow-jobs
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for workflow jobs

Use the REST API to interact with workflow jobs in GitHub Actions.

## About workflow jobs in GitHub Actions

You can use the REST API to view logs and workflow jobs in GitHub Actions. A workflow job is a set of steps that execute on the same runner. For more information, see [Workflow syntax for GitHub Actions](/en/actions/reference/workflows-and-actions/workflow-syntax).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Get a job for a workflow run

```
GET /repos/{owner}/{repo}/actions/jobs/{job_id}
```

Gets a specific job in a workflow run.
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

* **`job_id`** (integer) (required)
  The unique identifier of the job.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/jobs/JOB_ID
```

**Response schema (Status: 200):**

* `id`: required, integer, format: int64
* `run_id`: required, integer, format: int64
* `run_url`: required, string
* `run_attempt`: integer
* `node_id`: required, string
* `head_sha`: required, string
* `url`: required, string
* `html_url`: required, string or null
* `status`: required, string, enum: `queued`, `in_progress`, `completed`, `waiting`, `requested`, `pending`
* `conclusion`: required, string or null, enum: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`, `null`
* `created_at`: required, string, format: date-time
* `started_at`: required, string, format: date-time
* `completed_at`: required, string or null, format: date-time
* `name`: required, string
* `steps`: array of objects:
  * `status`: required, string, enum: `queued`, `in_progress`, `completed`
  * `conclusion`: required, string or null
  * `name`: required, string
  * `number`: required, integer
  * `started_at`: string or null, format: date-time
  * `completed_at`: string or null, format: date-time
* `check_run_url`: required, string
* `labels`: required, array of string
* `runner_id`: required, integer or null
* `runner_name`: required, string or null
* `runner_group_id`: required, integer or null
* `runner_group_name`: required, string or null
* `workflow_name`: required, string or null
* `head_branch`: required, string or null

## Download job logs for a workflow run

```
GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs
```

Gets a redirect URL to download a plain text file of logs for a workflow job. This link expires after 1 minute. Look
for Location: in the response header to find the URL for the download.
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

* **`job_id`** (integer) (required)
  The unique identifier of the job.

### HTTP response status codes

* **302** - Found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/jobs/JOB_ID/logs
```

**Response schema (Status: 302):**

## Download step logs for a workflow run job

```
GET /repos/{owner}/{repo}/actions/jobs/{job_id}/steps/{step_number}/logs
```

Gets a redirect URL to download a plain text file of logs for a specific step of a workflow job. This link expires after
1 minute. Look for Location: in the response header to find the URL for the download.
This endpoint is intended for selective retrieval of one step. To download complete job logs, use the
job logs endpoint.
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

* **`job_id`** (integer) (required)
  The unique identifier of the job.

* **`step_number`** (integer) (required)
  The zero-based position number of the step in the job.

### HTTP response status codes

* **302** - Found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/jobs/JOB_ID/steps/STEP_NUMBER/logs
```

**Response schema (Status: 302):**

## List jobs for a workflow run attempt

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs
```

Lists jobs for a specific workflow run attempt. You can use parameters to narrow the list of results. For more information
about using parameters, see Parameters.
Anyone with read access to the repository can use this endpoint.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint  with a private repository.

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

* **`attempt_number`** (integer) (required)
  The attempt number of the workflow run.

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

* **200** - OK

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/attempts/ATTEMPT_NUMBER/jobs
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `jobs`: required, array of `Job`:
  * `id`: required, integer, format: int64
  * `run_id`: required, integer, format: int64
  * `run_url`: required, string
  * `run_attempt`: integer
  * `node_id`: required, string
  * `head_sha`: required, string
  * `url`: required, string
  * `html_url`: required, string or null
  * `status`: required, string, enum: `queued`, `in_progress`, `completed`, `waiting`, `requested`, `pending`
  * `conclusion`: required, string or null, enum: `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`, `null`
  * `created_at`: required, string, format: date-time
  * `started_at`: required, string, format: date-time
  * `completed_at`: required, string or null, format: date-time
  * `name`: required, string
  * `steps`: array of objects:
    * `status`: required, string, enum: `queued`, `in_progress`, `completed`
    * `conclusion`: required, string or null
    * `name`: required, string
    * `number`: required, integer
    * `started_at`: string or null, format: date-time
    * `completed_at`: string or null, format: date-time
  * `check_run_url`: required, string
  * `labels`: required, array of string
  * `runner_id`: required, integer or null
  * `runner_name`: required, string or null
  * `runner_group_id`: required, integer or null
  * `runner_group_name`: required, string or null
  * `workflow_name`: required, string or null
  * `head_branch`: required, string or null

## List jobs for a workflow run

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
```

Lists jobs for a workflow run. You can use parameters to narrow the list of results. For more information
about using parameters, see Parameters.
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

* **`filter`** (string)
  Filters jobs by their completed\_at timestamp. latest returns jobs from the most recent execution of the workflow run. all returns all jobs for a workflow run, including from old executions of the workflow run.
  Default: `latest`
  Can be one of: `latest`, `all`

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
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/jobs
```

**Response schema (Status: 200):**

Same response schema as [List jobs for a workflow run attempt](#list-jobs-for-a-workflow-run-attempt).