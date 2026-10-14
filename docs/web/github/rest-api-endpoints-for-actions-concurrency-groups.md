---
title: REST API endpoints for Actions concurrency groups
url: https://docs.github.com/en/rest/actions/concurrency-groups
created_at: 2026-10-13T20:46:57-03:00
updated_at: 2026-10-13T20:46:57-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for Actions concurrency groups

Use the REST API to view and manage concurrency groups for GitHub Actions workflows.

## About concurrency groups in GitHub Actions

You can use the REST API to read the state of GitHub Actions concurrency groups, which ensure that only a single job or workflow using the same group will run at a time while additional runs are pending or canceled depending on configuration. For more information, see [Control the concurrency of workflows and jobs](/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List concurrency groups for a repository

```
GET /repos/{owner}/{repo}/actions/concurrency_groups
```

Lists the active concurrency groups for a repository.
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

* **`after`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results after this cursor. For more information, see "Using pagination in the REST API."

### HTTP response status codes

* **200** - OK

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/concurrency_groups
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `concurrency_groups`: required, array of objects:
  * `group_name`: required, string
  * `group_url`: required, string, format: uri
  * `last_acquired_at`: required, string or null, format: date-time

## Get a concurrency group for a repository

```
GET /repos/{owner}/{repo}/actions/concurrency_groups/{concurrency_group_name}
```

Gets a specific concurrency group for a repository, including all instances in the group's queue.
Returns 404 if the group is inactive or does not exist.
Optionally, pass ahead\_of\_run or ahead\_of\_job to filter the results to only the items
ahead of the specified workflow run or job in the queue, plus the specified item itself
(returned as the last element). This is useful for determining what is blocking a particular
run or job. Returns 422 if the specified run or job is not in this concurrency group.
When using ahead\_of\_run, this matches workflow-level concurrency and any reusable-workflow
leases held on behalf of that run. Job-level leases within the run are not considered to
block the run as a whole. Use ahead\_of\_job to match job-level concurrency and reusable-workflow
leases on the job's ancestor paths.
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

* **`concurrency_group_name`** (string) (required)
  The name of the concurrency group.

* **`ahead_of_run`** (integer)
  Filter to items ahead of this workflow run ID in the queue, plus the run itself.
  Matches workflow-level concurrency and reusable-workflow leases held on behalf of
  the run. Mutually exclusive with ahead\_of\_job.

* **`ahead_of_job`** (integer)
  Filter to items ahead of this job ID in the queue, plus the job itself.
  Matches job-level concurrency and reusable-workflow leases on the job's
  ancestor paths. Mutually exclusive with ahead\_of\_run.

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
  https://api.github.com/repos/OWNER/REPO/actions/concurrency_groups/CONCURRENCY_GROUP_NAME
```

**Response schema (Status: 200):**

* `group_name`: required, string
* `group_url`: required, string, format: uri
* `total_count`: required, integer
* `group_members`: required, array of objects:
  * `run_id`: required, integer
  * `run_name`: required, string
  * `run_url`: required, string or null, format: uri
  * `run_html_url`: required, string or null, format: uri
  * `job_id`: integer
  * `job_name`: string
  * `job_url`: string or null, format: uri
  * `job_html_url`: string or null, format: uri
  * `status`: required, string, enum: `in_progress`, `pending`

## List concurrency groups for a workflow run

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/concurrency_groups
```

Lists all concurrency groups associated with a workflow run or its jobs.
The set of groups is derived from the run's configuration, so a group is
included even when the run no longer has any items currently holding or
waiting in it. In that case the group\_members array will be empty.
total\_count reflects the number of groups the run participates in by
configuration, not the number with active items.
This differs from GET /repos/{owner}/{repo}/actions/concurrency\_groups/{group\_name},
which returns 404 when a group has no active items. That endpoint reports
the live state of a group repo-wide, while this endpoint reports the
groups associated with a specific run by configuration.
Results are sorted by group name and support cursor-based pagination via
before and after. The after cursor paginates forward only and does
not emit a rel="prev" Link; use before to page backward from a
forward page's next cursor.
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

* **`before`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results before this cursor. For more information, see "Using pagination in the REST API."

* **`after`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results after this cursor. For more information, see "Using pagination in the REST API."

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
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/concurrency_groups
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `concurrency_groups`: required, array of objects:
  * `group_name`: required, string
  * `group_url`: required, string, format: uri
  * `group_members`: required, array of objects:
    * `run_id`: required, integer
    * `run_name`: required, string
    * `run_url`: required, string or null, format: uri
    * `run_html_url`: required, string or null, format: uri
    * `position`: required, integer
    * `position_url`: required, string, format: uri
    * `job_id`: integer or null
    * `job_name`: string or null
    * `job_url`: string or null, format: uri
    * `job_html_url`: string or null, format: uri
    * `status`: required, string, enum: `in_progress`, `pending`
