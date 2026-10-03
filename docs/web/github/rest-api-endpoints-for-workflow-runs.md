---
title: REST API endpoints for workflow runs
url: https://docs.github.com/en/rest/actions/workflow-runs
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for workflow runs

Use the REST API to interact with workflow runs in GitHub Actions.

## About workflow runs in GitHub Actions

You can use the REST API to view, re-run, cancel, and view logs for workflow runs in GitHub Actions. A workflow run is an instance of your workflow that runs when the pre-configured event occurs. For more information, see [Managing workflow runs](/en/actions/how-tos/manage-workflow-runs).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Re-run a job from a workflow run

```
POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun
```

Re-run a job and its dependent jobs in a workflow run.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint.

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

#### Body parameters

* **`enable_debug_logging`** (boolean)
  Whether to enable debug logging for the re-run.
  Default: `false`

* **`enable_debugger`** (boolean)
  Whether to enable the debugger for the re-run of this job.
  Default: `false`

### HTTP response status codes

* **201** - Created

* **403** - Forbidden

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/jobs/JOB_ID/rerun
```

**Response schema (Status: 201):**

## List workflow runs for a repository

```
GET /repos/{owner}/{repo}/actions/runs
```

Lists all workflow runs for a repository. You can use parameters to narrow the list of results. For more information about using parameters, see Parameters.
Anyone with read access to the repository can use this endpoint.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint with a private repository.
This endpoint will return up to 1,000 results for each search when using the following parameters: actor, branch, check\_suite\_id, created, event, head\_sha, status.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`actor`** (string)
  Returns someone's workflow runs. Use the login for the user who created the push associated with the check suite or workflow run.

* **`branch`** (string)
  Returns workflow runs associated with a branch. Use the name of the branch of the push.

* **`event`** (string)
  Returns workflow run triggered by the event you specify. For example, push, pull\_request or issue. For more information, see "Events that trigger workflows."

* **`status`** (string)
  Returns workflow runs with the check run status or conclusion that you specify. For example, a conclusion can be success or a status can be in\_progress. Only GitHub Actions can set a status of waiting, pending, or requested.
  Can be one of: `completed`, `action_required`, `cancelled`, `failure`, `neutral`, `skipped`, `stale`, `success`, `timed_out`, `in_progress`, `queued`, `requested`, `waiting`, `pending`

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

* **`created`** (string)
  Returns workflow runs created within the given date-time range. For more information on the syntax, see "Understanding the search syntax."

* **`exclude_pull_requests`** (boolean)
  If true pull requests are omitted from the response (empty array).
  Default: `false`

* **`check_suite_id`** (integer)
  Returns workflow runs with the check\_suite\_id that you specify.

* **`head_sha`** (string)
  Only returns workflow runs that are associated with the specified head\_sha.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `workflow_runs`: required, array of `Workflow Run`:
  * `id`: required, integer, format: int64
  * `name`: string or null
  * `node_id`: required, string
  * `check_suite_id`: integer, format: int64
  * `check_suite_node_id`: string
  * `head_branch`: required, string or null
  * `head_sha`: required, string
  * `path`: required, string
  * `run_number`: required, integer
  * `run_attempt`: integer
  * `referenced_workflows`: array of `Referenced workflow` or null:
    * `path`: required, string
    * `sha`: required, string
    * `ref`: string
  * `event`: required, string
  * `status`: required, string or null
  * `conclusion`: required, string or null
  * `workflow_id`: required, integer
  * `url`: required, string
  * `html_url`: required, string
  * `pull_requests`: required, array of `Pull Request Minimal` or null:
    * `id`: required, integer, format: int64
    * `number`: required, integer
    * `url`: required, string
    * `head`: required, object:
      * `ref`: required, string
      * `sha`: required, string
      * `repo`: required, object:
        * `id`: required, integer, format: int64
        * `url`: required, string
        * `name`: required, string
    * `base`: required, object:
      * `ref`: required, string
      * `sha`: required, string
      * `repo`: required, object:
        * `id`: required, integer, format: int64
        * `url`: required, string
        * `name`: required, string
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time
  * `actor`: `Simple User`:
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
  * `triggering_actor`: `Simple User` (see above)
  * `run_started_at`: string, format: date-time
  * `jobs_url`: required, string
  * `logs_url`: required, string
  * `check_suite_url`: required, string
  * `artifacts_url`: required, string
  * `cancel_url`: required, string
  * `rerun_url`: required, string
  * `previous_attempt_url`: string or null
  * `workflow_url`: required, string
  * `head_commit`: required, any of:
    * **null**
    * **Simple Commit**
      * `id`: required, string
      * `tree_id`: required, string
      * `message`: required, string
      * `timestamp`: required, string, format: date-time
      * `author`: required, object or null:
        * `name`: required, string
        * `email`: required, string, format: email
      * `committer`: required, object or null:
        * `name`: required, string
        * `email`: required, string, format: email
  * `repository`: required, `Minimal Repository`:
    * `id`: required, integer, format: int64
    * `node_id`: required, string
    * `name`: required, string
    * `full_name`: required, string
    * `owner`: required, `Simple User` (see above)
    * `private`: required, boolean
    * `html_url`: required, string, format: uri
    * `description`: required, string or null
    * `fork`: required, boolean
    * `url`: required, string, format: uri
    * `archive_url`: required, string
    * `assignees_url`: required, string
    * `blobs_url`: required, string
    * `branches_url`: required, string
    * `collaborators_url`: required, string
    * `comments_url`: required, string
    * `commits_url`: required, string
    * `compare_url`: required, string
    * `contents_url`: required, string
    * `contributors_url`: required, string, format: uri
    * `deployments_url`: required, string, format: uri
    * `downloads_url`: required, string, format: uri
    * `events_url`: required, string, format: uri
    * `forks_url`: required, string, format: uri
    * `git_commits_url`: required, string
    * `git_refs_url`: required, string
    * `git_tags_url`: required, string
    * `git_url`: string
    * `issue_comment_url`: required, string
    * `issue_events_url`: required, string
    * `issues_url`: required, string
    * `keys_url`: required, string
    * `labels_url`: required, string
    * `languages_url`: required, string, format: uri
    * `merges_url`: required, string, format: uri
    * `milestones_url`: required, string
    * `notifications_url`: required, string
    * `pulls_url`: required, string
    * `releases_url`: required, string
    * `ssh_url`: string
    * `stargazers_url`: required, string, format: uri
    * `statuses_url`: required, string
    * `subscribers_url`: required, string, format: uri
    * `subscription_url`: required, string, format: uri
    * `tags_url`: required, string, format: uri
    * `teams_url`: required, string, format: uri
    * `trees_url`: required, string
    * `clone_url`: string
    * `mirror_url`: string or null
    * `hooks_url`: required, string, format: uri
    * `svn_url`: string
    * `homepage`: string or null
    * `language`: string or null
    * `forks_count`: integer
    * `stargazers_count`: integer
    * `watchers_count`: integer
    * `size`: integer
    * `default_branch`: string
    * `open_issues_count`: integer
    * `is_template`: boolean
    * `topics`: array of string
    * `has_issues`: boolean
    * `has_projects`: boolean
    * `has_wiki`: boolean
    * `has_pages`: boolean
    * `has_discussions`: boolean
    * `has_pull_requests`: boolean
    * `pull_request_creation_policy`: string, enum: `all`, `collaborators_only`
    * `archived`: boolean
    * `disabled`: boolean
    * `visibility`: string
    * `pushed_at`: string or null, format: date-time
    * `created_at`: string or null, format: date-time
    * `updated_at`: string or null, format: date-time
    * `permissions`: object:
      * `admin`: boolean
      * `maintain`: boolean
      * `push`: boolean
      * `triage`: boolean
      * `pull`: boolean
    * `role_name`: string
    * `temp_clone_token`: string
    * `delete_branch_on_merge`: boolean
    * `subscribers_count`: integer
    * `network_count`: integer
    * `code_of_conduct`: `Code Of Conduct`:
      * `key`: required, string
      * `name`: required, string
      * `url`: required, string, format: uri
      * `body`: string
      * `html_url`: required, string or null, format: uri
    * `license`: object or null:
      * `key`: string
      * `name`: string
      * `spdx_id`: string
      * `url`: string or null
      * `node_id`: string
    * `forks`: integer
    * `open_issues`: integer
    * `watchers`: integer
    * `allow_forking`: boolean
    * `web_commit_signoff_required`: boolean
    * `security_and_analysis`: object or null:
      * `advanced_security`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `code_security`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `dependabot_security_updates`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `secret_scanning`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `secret_scanning_push_protection`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `secret_scanning_non_provider_patterns`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `secret_scanning_ai_detection`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `secret_scanning_delegated_alert_dismissal`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `secret_scanning_delegated_bypass`: object:
        * `status`: string, enum: `enabled`, `disabled`
      * `secret_scanning_delegated_bypass_options`: object:
        * `reviewers`: array of object
    * `custom_properties`: object, additional properties allowed
  * `head_repository`: required, `Minimal Repository` (see above)
  * `head_repository_id`: integer
  * `display_title`: required, string

## Get a workflow run

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}
```

Gets a specific workflow run.
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

* **`exclude_pull_requests`** (boolean)
  If true pull requests are omitted from the response (empty array).
  Default: `false`

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID
```

**Response schema (Status: 200):**

* `id`: required, integer, format: int64
* `name`: string or null
* `node_id`: required, string
* `check_suite_id`: integer, format: int64
* `check_suite_node_id`: string
* `head_branch`: required, string or null
* `head_sha`: required, string
* `path`: required, string
* `run_number`: required, integer
* `run_attempt`: integer
* `referenced_workflows`: array of `Referenced workflow` or null:
  * `path`: required, string
  * `sha`: required, string
  * `ref`: string
* `event`: required, string
* `status`: required, string or null
* `conclusion`: required, string or null
* `workflow_id`: required, integer
* `url`: required, string
* `html_url`: required, string
* `pull_requests`: required, array of `Pull Request Minimal` or null:
  * `id`: required, integer, format: int64
  * `number`: required, integer
  * `url`: required, string
  * `head`: required, object:
    * `ref`: required, string
    * `sha`: required, string
    * `repo`: required, object:
      * `id`: required, integer, format: int64
      * `url`: required, string
      * `name`: required, string
  * `base`: required, object:
    * `ref`: required, string
    * `sha`: required, string
    * `repo`: required, object:
      * `id`: required, integer, format: int64
      * `url`: required, string
      * `name`: required, string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `actor`: `Simple User`:
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
* `triggering_actor`: `Simple User` (see above)
* `run_started_at`: string, format: date-time
* `jobs_url`: required, string
* `logs_url`: required, string
* `check_suite_url`: required, string
* `artifacts_url`: required, string
* `cancel_url`: required, string
* `rerun_url`: required, string
* `previous_attempt_url`: string or null
* `workflow_url`: required, string
* `head_commit`: required, any of:
  * **null**
  * **Simple Commit**
    * `id`: required, string
    * `tree_id`: required, string
    * `message`: required, string
    * `timestamp`: required, string, format: date-time
    * `author`: required, object or null:
      * `name`: required, string
      * `email`: required, string, format: email
    * `committer`: required, object or null:
      * `name`: required, string
      * `email`: required, string, format: email
* `repository`: required, `Minimal Repository`:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `name`: required, string
  * `full_name`: required, string
  * `owner`: required, `Simple User` (see above)
  * `private`: required, boolean
  * `html_url`: required, string, format: uri
  * `description`: required, string or null
  * `fork`: required, boolean
  * `url`: required, string, format: uri
  * `archive_url`: required, string
  * `assignees_url`: required, string
  * `blobs_url`: required, string
  * `branches_url`: required, string
  * `collaborators_url`: required, string
  * `comments_url`: required, string
  * `commits_url`: required, string
  * `compare_url`: required, string
  * `contents_url`: required, string
  * `contributors_url`: required, string, format: uri
  * `deployments_url`: required, string, format: uri
  * `downloads_url`: required, string, format: uri
  * `events_url`: required, string, format: uri
  * `forks_url`: required, string, format: uri
  * `git_commits_url`: required, string
  * `git_refs_url`: required, string
  * `git_tags_url`: required, string
  * `git_url`: string
  * `issue_comment_url`: required, string
  * `issue_events_url`: required, string
  * `issues_url`: required, string
  * `keys_url`: required, string
  * `labels_url`: required, string
  * `languages_url`: required, string, format: uri
  * `merges_url`: required, string, format: uri
  * `milestones_url`: required, string
  * `notifications_url`: required, string
  * `pulls_url`: required, string
  * `releases_url`: required, string
  * `ssh_url`: string
  * `stargazers_url`: required, string, format: uri
  * `statuses_url`: required, string
  * `subscribers_url`: required, string, format: uri
  * `subscription_url`: required, string, format: uri
  * `tags_url`: required, string, format: uri
  * `teams_url`: required, string, format: uri
  * `trees_url`: required, string
  * `clone_url`: string
  * `mirror_url`: string or null
  * `hooks_url`: required, string, format: uri
  * `svn_url`: string
  * `homepage`: string or null
  * `language`: string or null
  * `forks_count`: integer
  * `stargazers_count`: integer
  * `watchers_count`: integer
  * `size`: integer
  * `default_branch`: string
  * `open_issues_count`: integer
  * `is_template`: boolean
  * `topics`: array of string
  * `has_issues`: boolean
  * `has_projects`: boolean
  * `has_wiki`: boolean
  * `has_pages`: boolean
  * `has_discussions`: boolean
  * `has_pull_requests`: boolean
  * `pull_request_creation_policy`: string, enum: `all`, `collaborators_only`
  * `archived`: boolean
  * `disabled`: boolean
  * `visibility`: string
  * `pushed_at`: string or null, format: date-time
  * `created_at`: string or null, format: date-time
  * `updated_at`: string or null, format: date-time
  * `permissions`: object:
    * `admin`: boolean
    * `maintain`: boolean
    * `push`: boolean
    * `triage`: boolean
    * `pull`: boolean
  * `role_name`: string
  * `temp_clone_token`: string
  * `delete_branch_on_merge`: boolean
  * `subscribers_count`: integer
  * `network_count`: integer
  * `code_of_conduct`: `Code Of Conduct`:
    * `key`: required, string
    * `name`: required, string
    * `url`: required, string, format: uri
    * `body`: string
    * `html_url`: required, string or null, format: uri
  * `license`: object or null:
    * `key`: string
    * `name`: string
    * `spdx_id`: string
    * `url`: string or null
    * `node_id`: string
  * `forks`: integer
  * `open_issues`: integer
  * `watchers`: integer
  * `allow_forking`: boolean
  * `web_commit_signoff_required`: boolean
  * `security_and_analysis`: object or null:
    * `advanced_security`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `code_security`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `dependabot_security_updates`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `secret_scanning`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `secret_scanning_push_protection`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `secret_scanning_non_provider_patterns`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `secret_scanning_ai_detection`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `secret_scanning_delegated_alert_dismissal`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `secret_scanning_delegated_bypass`: object:
      * `status`: string, enum: `enabled`, `disabled`
    * `secret_scanning_delegated_bypass_options`: object:
      * `reviewers`: array of objects:
        * `reviewer_id`: required, integer
        * `reviewer_type`: required, string, enum: `TEAM`, `ROLE`
        * `mode`: string, enum: `ALWAYS`, `EXEMPT`, default: `"ALWAYS"`
  * `custom_properties`: object, additional properties allowed
* `head_repository`: required, `Minimal Repository` (see above)
* `head_repository_id`: integer
* `display_title`: required, string

## Delete a workflow run

```
DELETE /repos/{owner}/{repo}/actions/runs/{run_id}
```

Deletes a specific workflow run.
Anyone with write access to the repository can use this endpoint.
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID
```

**Response schema (Status: 204):**

## Get the review history for a workflow run

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals
```

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

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/approvals
```

**Response schema (Status: 200):**

Array of `Environment Approval`:

* `environments`: required, array of objects:
  * `id`: integer
  * `node_id`: string
  * `name`: string
  * `url`: string
  * `html_url`: string
  * `created_at`: string, format: date-time
  * `updated_at`: string, format: date-time
* `state`: required, string, enum: `approved`, `rejected`, `pending`
* `user`: required, `Simple User`:
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
* `comment`: required, string

## Approve a workflow run for a fork pull request

```
POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve
```

Approves a workflow run for a pull request from a public fork of a first time contributor. For more information, see "Approving workflow runs from public forks."
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

### HTTP response status codes

* **201** - Created

* **403** - Forbidden

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/approve
```

**Response schema (Status: 201):**

## Get a workflow run attempt

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}
```

Gets a specific workflow run attempt.
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

* **`attempt_number`** (integer) (required)
  The attempt number of the workflow run.

* **`exclude_pull_requests`** (boolean)
  If true pull requests are omitted from the response (empty array).
  Default: `false`

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/attempts/ATTEMPT_NUMBER
```

**Response schema (Status: 200):**

Same response schema as [Get a workflow run](#get-a-workflow-run).

## Download workflow run attempt logs

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/logs
```

Gets a redirect URL to download an archive of log files for a specific workflow run attempt. This link expires after
1 minute. Look for Location: in the response header to find the URL for the download.
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

* **`attempt_number`** (integer) (required)
  The attempt number of the workflow run.

### HTTP response status codes

* **302** - Found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/attempts/ATTEMPT_NUMBER/logs
```

**Response schema (Status: 302):**

## Cancel a workflow run

```
POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel
```

Cancels a workflow run using its id.
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

### HTTP response status codes

* **202** - Accepted

* **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/cancel
```

**Response schema (Status: 202):**

## Review custom deployment protection rules for a workflow run

```
POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule
```

Approve or reject custom deployment protection rules provided by a GitHub App for a workflow run. For more information, see "Using environments for deployment."
Note

GitHub Apps can only review their own custom deployment protection rules. To approve or reject pending deployments that are waiting for review from a specific person or team, see POST /repos/{owner}/{repo}/actions/runs/{run\_id}/pending\_deployments.

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

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/deployment_protection_rule \
  -d '{
  "environment_name": "prod-eus",
  "state": "approved",
  "comment": "All health checks passed."
}'
```

**Response schema (Status: 204):**

## Force cancel a workflow run

```
POST /repos/{owner}/{repo}/actions/runs/{run_id}/force-cancel
```

Cancels a workflow run and bypasses conditions that would otherwise cause a workflow execution to continue, such as an always() condition on a job.
You should only use this endpoint to cancel a workflow run when the workflow run is not responding to POST /repos/{owner}/{repo}/actions/runs/{run\_id}/cancel.
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

### HTTP response status codes

* **202** - Accepted

* **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/force-cancel
```

**Response schema (Status: 202):**

## Download workflow run logs

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs
```

Gets a redirect URL to download an archive of log files for a workflow run. This link expires after 1 minute. Look for
Location: in the response header to find the URL for the download.
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

### HTTP response status codes

* **302** - Found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/logs
```

**Response schema (Status: 302):**

## Delete workflow run logs

```
DELETE /repos/{owner}/{repo}/actions/runs/{run_id}/logs
```

Deletes all logs for a workflow run.
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

### HTTP response status codes

* **204** - No Content

* **403** - Forbidden

* **500** - Internal Error

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/logs
```

**Response schema (Status: 204):**

## Get pending deployments for a workflow run

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments
```

Get all deployment environments for a workflow run that are waiting for protection rules to pass.
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

* **`run_id`** (integer) (required)
  The unique identifier of the workflow run.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/pending_deployments
```

**Response schema (Status: 200):**

Array of `Pending Deployment`:

* `environment`: required, object:
  * `id`: integer, format: int64
  * `node_id`: string
  * `name`: string
  * `url`: string
  * `html_url`: string
* `wait_timer`: required, integer
* `wait_timer_started_at`: required, string or null, format: date-time
* `current_user_can_approve`: required, boolean
* `reviewers`: required, array of objects:
  * `type`: string, enum: `User`, `Team`
  * `reviewer`: any of:
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
    * **Team**
      * `id`: required, integer
      * `node_id`: required, string
      * `name`: required, string
      * `slug`: required, string
      * `description`: required, string or null
      * `privacy`: string
      * `notification_setting`: string
      * `permission`: required, string
      * `permissions`: object:
        * `pull`: required, boolean
        * `triage`: required, boolean
        * `push`: required, boolean
        * `maintain`: required, boolean
        * `admin`: required, boolean
      * `url`: required, string, format: uri
      * `html_url`: required, string, format: uri
      * `members_url`: required, string
      * `repositories_url`: required, string, format: uri
      * `type`: required, string, enum: `enterprise`, `organization`
      * `access_source`: string, enum: `direct`, `organization`, `enterprise`
      * `organization_id`: integer
      * `enterprise_id`: integer
      * `parent`: required, any of:
        * **null**
        * **Team Simple**
          * `id`: required, integer
          * `node_id`: required, string
          * `url`: required, string, format: uri
          * `members_url`: required, string
          * `name`: required, string
          * `description`: required, string or null
          * `permission`: required, string
          * `privacy`: string
          * `notification_setting`: string
          * `html_url`: required, string, format: uri
          * `repositories_url`: required, string, format: uri
          * `slug`: required, string
          * `ldap_dn`: string
          * `type`: required, string, enum: `enterprise`, `organization`
          * `organization_id`: integer
          * `enterprise_id`: integer

## Review pending deployments for a workflow run

```
POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments
```

Approve or reject pending deployments that are waiting on approval by a required reviewer.
Required reviewers with read access to the repository contents and deployments can use this endpoint.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint.

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

#### Body parameters

* **`environment_ids`** (array of integers) (required)
  The list of environment ids to approve or reject

* **`state`** (string) (required)
  Whether to approve or reject deployment to the specified environments.
  Can be one of: `approved`, `rejected`

* **`comment`** (string) (required)
  A comment to accompany the deployment review

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/pending_deployments \
  -d '{
  "environment_ids": [
    161171787
  ],
  "state": "approved",
  "comment": "Ship it!"
}'
```

**Response schema (Status: 200):**

Array of `Deployment`:

* `url`: required, string, format: uri
* `id`: required, integer, format: int64
* `node_id`: required, string
* `sha`: required, string
* `ref`: required, string
* `task`: required, string
* `payload`: required, one of:
  * **object, additional properties allowed**
  * **string**
* `original_environment`: string
* `environment`: required, string
* `description`: required, string or null
* `creator`: required, any of:
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
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `statuses_url`: required, string, format: uri
* `repository_url`: required, string, format: uri
* `transient_environment`: boolean
* `production_environment`: boolean
* `performed_via_github_app`: any of:
  * **null**
  * **GitHub app**
    * `id`: required, integer
    * `slug`: string
    * `node_id`: required, string
    * `client_id`: string
    * `owner`: required, one of:
      * **Simple User** (see above)
      * **Enterprise**
        * `description`: string or null
        * `html_url`: required, string, format: uri
        * `website_url`: string or null, format: uri
        * `id`: required, integer
        * `node_id`: required, string
        * `name`: required, string
        * `slug`: required, string
        * `created_at`: required, string or null, format: date-time
        * `updated_at`: required, string or null, format: date-time
        * `avatar_url`: required, string, format: uri
    * `name`: required, string
    * `description`: required, string or null
    * `external_url`: required, string, format: uri
    * `html_url`: required, string, format: uri
    * `created_at`: required, string, format: date-time
    * `updated_at`: required, string, format: date-time
    * `permissions`: required, object, additional properties: string:
      * `issues`: string
      * `checks`: string
      * `metadata`: string
      * `contents`: string
      * `deployments`: string
    * `events`: required, array of string
    * `installations_count`: integer

## Re-run a workflow

```
POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun
```

Re-runs your workflow run using its id.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint.

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

#### Body parameters

* **`enable_debug_logging`** (boolean)
  Whether to enable debug logging for the re-run.
  Default: `false`

### HTTP response status codes

* **201** - Created

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/rerun
```

**Response schema (Status: 201):**

## Re-run failed jobs from a workflow run

```
POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs
```

Re-run all of the failed jobs and their dependent jobs in a workflow run using the id of the workflow run.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint.

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

#### Body parameters

* **`enable_debug_logging`** (boolean)
  Whether to enable debug logging for the re-run.
  Default: `false`

### HTTP response status codes

* **201** - Created

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/rerun-failed-jobs
```

**Response schema (Status: 201):**

## Get workflow run usage

```
GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing
```

Warning

This endpoint is in the process of closing down. Refer to "Actions Get workflow usage and Get workflow run usage endpoints closing down" for more information.

Gets the number of billable minutes and total run time for a specific workflow run. Billable minutes only apply to workflows in private repositories that use GitHub-hosted runners. Usage is listed for each GitHub-hosted runner operating system in milliseconds. Any job re-runs are also included in the usage. The usage does not include the multiplier for macOS and Windows runners and is not rounded up to the nearest whole minute. For more information, see "Managing billing for GitHub Actions".
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

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/runs/RUN_ID/timing
```

**Response schema (Status: 200):**

* `billable`: required, object:
  * `UBUNTU`: object:
    * `total_ms`: required, integer
    * `jobs`: required, integer
    * `job_runs`: array of objects:
      * `job_id`: required, integer
      * `duration_ms`: required, integer
  * `MACOS`: object:
    * `total_ms`: required, integer
    * `jobs`: required, integer
    * `job_runs`: array of objects:
      * `job_id`: required, integer
      * `duration_ms`: required, integer
  * `WINDOWS`: object:
    * `total_ms`: required, integer
    * `jobs`: required, integer
    * `job_runs`: array of objects:
      * `job_id`: required, integer
      * `duration_ms`: required, integer
* `run_duration_ms`: integer

## List workflow runs for a workflow

```
GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs
```

List all workflow runs for a workflow. You can replace workflow\_id with the workflow file name. For example, you could use main.yaml. You can use parameters to narrow the list of results. For more information about using parameters, see Parameters.
Anyone with read access to the repository can use this endpoint
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint with a private repository.
This endpoint will return up to 1,000 results for each search when using the following parameters: actor, branch, check\_suite\_id, created, event, head\_sha, status.

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

* **`actor`** (string)
  Returns someone's workflow runs. Use the login for the user who created the push associated with the check suite or workflow run.

* **`branch`** (string)
  Returns workflow runs associated with a branch. Use the name of the branch of the push.

* **`event`** (string)
  Returns workflow run triggered by the event you specify. For example, push, pull\_request or issue. For more information, see "Events that trigger workflows."

* **`status`** (string)
  Returns workflow runs with the check run status or conclusion that you specify. For example, a conclusion can be success or a status can be in\_progress. Only GitHub Actions can set a status of waiting, pending, or requested.
  Can be one of: `completed`, `action_required`, `cancelled`, `failure`, `neutral`, `skipped`, `stale`, `success`, `timed_out`, `in_progress`, `queued`, `requested`, `waiting`, `pending`

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

* **`created`** (string)
  Returns workflow runs created within the given date-time range. For more information on the syntax, see "Understanding the search syntax."

* **`exclude_pull_requests`** (boolean)
  If true pull requests are omitted from the response (empty array).
  Default: `false`

* **`check_suite_id`** (integer)
  Returns workflow runs with the check\_suite\_id that you specify.

* **`head_sha`** (string)
  Only returns workflow runs that are associated with the specified head\_sha.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/WORKFLOW_ID/runs
```

**Response schema (Status: 200):**

Same response schema as [List workflow runs for a repository](#list-workflow-runs-for-a-repository).