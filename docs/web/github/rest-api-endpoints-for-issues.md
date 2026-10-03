---
title: REST API endpoints for issues
url: https://docs.github.com/en/rest/issues/issues
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for issues

Use the REST API to manage issues and pull requests.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List issues assigned to the authenticated user

```
GET /issues
```

List issues assigned to the authenticated user across all visible repositories including owned repositories, member
repositories, and organization repositories. You can use the filter query parameter to fetch issues that are not
necessarily assigned to you.
Note

GitHub's REST API considers every pull request an issue, but not every issue is a pull request. For this reason, "Issues" endpoints may return both issues and pull requests in the response. You can identify pull requests by the pull_request key. Be aware that the id of a pull request returned from "Issues" endpoints will be an issue id. To find out the pull request id, use the "List pull requests" endpoint.

This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`filter`** (string)
  Indicates which sorts of issues to return. assigned means issues assigned to you. created means issues created by you. mentioned means issues mentioning you. subscribed means issues you're subscribed to updates for. all or repos means all issues you can see, regardless of participation or creation.
  Default: `assigned`
  Can be one of: `assigned`, `created`, `mentioned`, `subscribed`, `repos`, `all`

- **`state`** (string)
  Indicates the state of the issues to return.
  Default: `open`
  Can be one of: `open`, `closed`, `all`

- **`labels`** (string)
  A list of comma separated label names. Example: bug,ui,@high

- **`sort`** (string)
  What to sort results by.
  Default: `created`
  Can be one of: `created`, `updated`, `comments`

- **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

- **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

- **`collab`** (boolean)

- **`orgs`** (boolean)

- **`owned`** (boolean)

- **`pulls`** (boolean)

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

- **304** - Not modified

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/issues
```

**Response schema (Status: 200):**

Array of `Issue`:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `url`: required, string, format: uri
  * `repository_url`: required, string, format: uri
  * `labels_url`: required, string
  * `comments_url`: required, string, format: uri
  * `events_url`: required, string, format: uri
  * `html_url`: required, string, format: uri
  * `number`: required, integer
  * `state`: required, string
  * `state_reason`: string or null, enum: `completed`, `reopened`, `not_planned`, `duplicate`, `null`
  * `title`: required, string
  * `body`: string or null
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
  * `labels`: required, array of object
  * `assignees`: array of `Simple User` (see above)
  * `milestone`: required, any of:
    * **null**
    * **Milestone**
      * `url`: required, string, format: uri
      * `html_url`: required, string, format: uri
      * `labels_url`: required, string, format: uri
      * `id`: required, integer
      * `node_id`: required, string
      * `number`: required, integer
      * `state`: required, string, enum: `open`, `closed`, default: `"open"`
      * `title`: required, string
      * `description`: required, string or null
      * `creator`: required, any of:
        * **null**
        * **Simple User** (see above)
      * `open_issues`: required, integer
      * `closed_issues`: required, integer
      * `created_at`: required, string, format: date-time
      * `updated_at`: required, string, format: date-time
      * `closed_at`: required, string or null, format: date-time
      * `due_on`: required, string or null, format: date-time
  * `locked`: required, boolean
  * `active_lock_reason`: string or null
  * `comments`: required, integer
  * `pull_request`: object:
    * `merged_at`: string or null, format: date-time
    * `diff_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `patch_url`: required, string or null, format: uri
    * `url`: required, string or null, format: uri
  * `closed_at`: required, string or null, format: date-time
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time
  * `draft`: boolean
  * `closed_by`: any of:
    * **null**
    * **Simple User** (see above)
  * `body_html`: string
  * `body_text`: string
  * `timeline_url`: string, format: uri
  * `type`: `Issue Type`:
    * `id`: required, integer
    * `node_id`: required, string
    * `name`: required, string
    * `description`: required, string or null
    * `color`: string or null, enum: `gray`, `blue`, `green`, `yellow`, `orange`, `red`, `pink`, `purple`, `null`
    * `created_at`: string, format: date-time
    * `updated_at`: string, format: date-time
    * `is_enabled`: boolean
  * `repository`: `Repository`:
    * `id`: required, integer, format: int64
    * `node_id`: required, string
    * `name`: required, string
    * `full_name`: required, string
    * `license`: required, any of:
      * **null**
      * **License Simple**
        * `key`: required, string
        * `name`: required, string
        * `url`: required, string or null, format: uri
        * `spdx_id`: required, string or null
        * `node_id`: required, string
        * `html_url`: string, format: uri
    * `forks`: required, integer
    * `permissions`: object:
      * `admin`: required, boolean
      * `pull`: required, boolean
      * `triage`: boolean
      * `push`: required, boolean
      * `maintain`: boolean
    * `owner`: required, `Simple User` (see above)
    * `private`: required, boolean, default: `false`
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
    * `git_url`: required, string
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
    * `ssh_url`: required, string
    * `stargazers_url`: required, string, format: uri
    * `statuses_url`: required, string
    * `subscribers_url`: required, string, format: uri
    * `subscription_url`: required, string, format: uri
    * `tags_url`: required, string, format: uri
    * `teams_url`: required, string, format: uri
    * `trees_url`: required, string
    * `clone_url`: required, string
    * `mirror_url`: required, string or null, format: uri
    * `hooks_url`: required, string, format: uri
    * `svn_url`: required, string, format: uri
    * `homepage`: required, string or null, format: uri
    * `language`: required, string or null
    * `forks_count`: required, integer
    * `stargazers_count`: required, integer
    * `watchers_count`: required, integer
    * `size`: required, integer
    * `default_branch`: required, string
    * `open_issues_count`: required, integer
    * `is_template`: boolean, default: `false`
    * `topics`: array of string
    * `has_issues`: required, boolean, default: `true`
    * `has_projects`: required, boolean, default: `true`
    * `has_wiki`: required, boolean, default: `true`
    * `has_pages`: required, boolean
    * `has_discussions`: boolean, default: `false`
    * `has_pull_requests`: boolean, default: `true`
    * `pull_request_creation_policy`: string, enum: `all`, `collaborators_only`
    * `archived`: required, boolean, default: `false`
    * `disabled`: required, boolean
    * `visibility`: string, default: `"public"`
    * `pushed_at`: required, string or null, format: date-time
    * `created_at`: required, string or null, format: date-time
    * `updated_at`: required, string or null, format: date-time
    * `allow_rebase_merge`: boolean, default: `true`
    * `temp_clone_token`: string
    * `allow_squash_merge`: boolean, default: `true`
    * `allow_auto_merge`: boolean, default: `false`
    * `delete_branch_on_merge`: boolean, default: `false`
    * `allow_update_branch`: boolean, default: `false`
    * `squash_merge_commit_title`: string, enum: `PR_TITLE`, `COMMIT_OR_PR_TITLE`
    * `squash_merge_commit_message`: string, enum: `PR_BODY`, `COMMIT_MESSAGES`, `BLANK`
    * `merge_commit_title`: string, enum: `PR_TITLE`, `MERGE_MESSAGE`
    * `merge_commit_message`: string, enum: `PR_BODY`, `PR_TITLE`, `BLANK`
    * `allow_merge_commit`: boolean, default: `true`
    * `allow_forking`: boolean
    * `web_commit_signoff_required`: boolean, default: `false`
    * `open_issues`: required, integer
    * `watchers`: required, integer
    * `starred_at`: string
    * `anonymous_access_enabled`: boolean
    * `code_search_index_status`: object:
      * `lexical_search_ok`: boolean
      * `lexical_commit_sha`: string
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
  * `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
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
  * `sub_issues_summary`: `Sub-issues Summary`:
    * `total`: required, integer
    * `completed`: required, integer
    * `percent_completed`: required, integer
  * `parent_issue_url`: string or null, format: uri
  * `pinned_comment`: any of:
    * **null**
    * **Issue Comment**
      * `id`: required, integer, format: int64
      * `node_id`: required, string
      * `url`: required, string, format: uri
      * `body`: string
      * `body_text`: string
      * `body_html`: string
      * `html_url`: required, string, format: uri
      * `user`: required, any of:
        * **null**
        * **Simple User** (see above)
      * `created_at`: required, string, format: date-time
      * `updated_at`: required, string, format: date-time
      * `issue_url`: required, string, format: uri
      * `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
      * `performed_via_github_app`: any of:
        * **null**
        * **GitHub app** (see above)
      * `reactions`: `Reaction Rollup` (see above)
      * `pin`: any of:
        * **null**
        * **Pinned Issue Comment**
          * `pinned_at`: required, string, format: date-time
          * `pinned_by`: required, any of:
            * **null**
            * **Simple User** (see above)
      * `minimized`: any of:
        * **null**
        * **Minimized Issue Comment**
          * `reason`: required, string or null
  * `issue_dependencies_summary`: `Issue Dependencies Summary`:
    * `blocked_by`: required, integer
    * `blocking`: required, integer
    * `total_blocked_by`: required, integer
    * `total_blocking`: required, integer
  * `issue_field_values`: array of `Issue Field Value`:
    * `issue_field_id`: required, integer, format: int64
    * `issue_field_name`: string
    * `node_id`: required, string
    * `data_type`: required, string, enum: `text`, `single_select`, `multi_select`, `number`, `date`
    * `value`: required, any of:
      * **string**
      * **number**
      * **integer**
    * `single_select_option`: object or null:
      * `id`: required, integer, format: int64
      * `name`: required, string
      * `color`: required, string
    * `multi_select_options`: array of objects or null:
      * `id`: required, integer, format: int64
      * `name`: required, string
      * `color`: required, string

## List organization issues assigned to the authenticated user

```
GET /orgs/{org}/issues
```

List issues in an organization assigned to the authenticated user.
Note

GitHub's REST API considers every pull request an issue, but not every issue is a pull request. For this reason, "Issues" endpoints may return both issues and pull requests in the response. You can identify pull requests by the pull_request key. Be aware that the id of a pull request returned from "Issues" endpoints will be an issue id. To find out the pull request id, use the "List pull requests" endpoint.

This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`org`** (string) (required)
  The organization name. The name is not case sensitive.

- **`filter`** (string)
  Indicates which sorts of issues to return. assigned means issues assigned to you. created means issues created by you. mentioned means issues mentioning you. subscribed means issues you're subscribed to updates for. all or repos means all issues you can see, regardless of participation or creation.
  Default: `assigned`
  Can be one of: `assigned`, `created`, `mentioned`, `subscribed`, `repos`, `all`

- **`state`** (string)
  Indicates the state of the issues to return.
  Default: `open`
  Can be one of: `open`, `closed`, `all`

- **`labels`** (string)
  A list of comma separated label names. Example: bug,ui,@high

- **`type`** (string)
  Can be the name of an issue type.

- **`sort`** (string)
  What to sort results by.
  Default: `created`
  Can be one of: `created`, `updated`, `comments`

- **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

- **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

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
  https://api.github.com/orgs/ORG/issues
```

**Response schema (Status: 200):**

Same response schema as [List issues assigned to the authenticated user](#list-issues-assigned-to-the-authenticated-user).

## List repository issues

```
GET /repos/{owner}/{repo}/issues
```

List issues in a repository. Only open issues will be listed.
Note

GitHub's REST API considers every pull request an issue, but not every issue is a pull request. For this reason, "Issues" endpoints may return both issues and pull requests in the response. You can identify pull requests by the pull_request key. Be aware that the id of a pull request returned from "Issues" endpoints will be an issue id. To find out the pull request id, use the "List pull requests" endpoint.

This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`milestone`** (string)
  If an integer is passed, it should refer to a milestone by its number field. If the string * is passed, issues with any milestone are accepted. If the string none is passed, issues without milestones are returned.

- **`state`** (string)
  Indicates the state of the issues to return.
  Default: `open`
  Can be one of: `open`, `closed`, `all`

- **`assignee`** (string)
  Can be the name of a user. Pass in none for issues with no assigned user, and * for issues assigned to any user.

- **`type`** (string)
  Can be the name of an issue type. If the string * is passed, issues with any type are accepted. If the string none is passed, issues without type are returned.

- **`creator`** (string)
  The user that created the issue.

- **`mentioned`** (string)
  A user that's mentioned in the issue.

- **`issue_field_values`** (string)
  A comma-separated list of issue field filters in field_slug:value format.
Only issues matching all specified field values are returned.
Requires issue fields to be enabled for the repository. Issue fields are
not available for user-owned repositories, and field availability for
organization-owned public repositories depends on the organization's
visibility settings. For example, priority:Urgent,severity:High filters
issues where the priority field is Urgent AND the severity field is
High.

- **`labels`** (string)
  A list of comma separated label names. Example: bug,ui,@high

- **`sort`** (string)
  What to sort results by.
  Default: `created`
  Can be one of: `created`, `updated`, `comments`

- **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

- **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

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

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues
```

**Response schema (Status: 200):**

Same response schema as [List issues assigned to the authenticated user](#list-issues-assigned-to-the-authenticated-user).

## Create an issue

```
POST /repos/{owner}/{repo}/issues
```

Any user with pull access to a repository can create an issue. If issues are disabled in the repository, the API returns a 410 Gone status.
This endpoint triggers notifications. Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "Rate limits for the API"
and "Best practices for using the REST API."
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

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

- **`title`** (string or integer) (required)
  The title of the issue.

- **`body`** (string)
  The contents of the issue.

- **`milestone`** (null or string or integer)
  The number of the milestone to associate this issue with. NOTE: Only users with push access can set the milestone for new issues. The milestone is silently dropped otherwise.

- **`labels`** (array)
  Labels to associate with this issue. NOTE: Only users with push access can set labels for new issues. Labels are silently dropped otherwise.

- **`assignees`** (array of strings)
  Logins for Users to assign to this issue. NOTE: Only users with push access can set assignees for new issues. Assignees are silently dropped otherwise.

- **`issue_field_values`** (array of objects)
  An array of issue field values to set on this issue. Each field value must include the field ID and the value to set. Issue fields are only available for organization-owned repositories with the feature enabled. Field values are silently dropped otherwise.
  - **`field_id`** (integer) (required)
    The ID of the issue field to set
  - **`value`** (string or number or array) (required)
    The value to set for the field. For multi-select fields, provide an array of option names.

- **`type`** (string or null)
  The name of the issue type to associate with this issue. NOTE: Only users with push access can set the type for new issues. The type is silently dropped otherwise.

- **`parent_issue_id`** (integer)
  The id of the parent issue to add this issue to as a sub-issue. NOTE: Only users with triage access to both the parent issue's repository and this repository can set the parent issue.

### HTTP response status codes

- **201** - Created

- **400** - Bad Request

- **403** - Forbidden

- **404** - Resource not found

- **410** - Gone

- **422** - Validation failed, or the endpoint has been spammed.

- **503** - Service unavailable

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/issues \
  -d '{
  "title": "Found a bug",
  "body": "I'\''m having a problem with this.",
  "assignees": [
    "octocat"
  ],
  "milestone": 1,
  "labels": [
    "bug"
  ]
}'
```

**Response schema (Status: 201):**

* `id`: required, integer, format: int64
* `node_id`: required, string
* `url`: required, string, format: uri
* `repository_url`: required, string, format: uri
* `labels_url`: required, string
* `comments_url`: required, string, format: uri
* `events_url`: required, string, format: uri
* `html_url`: required, string, format: uri
* `number`: required, integer
* `state`: required, string
* `state_reason`: string or null, enum: `completed`, `reopened`, `not_planned`, `duplicate`, `null`
* `title`: required, string
* `body`: string or null
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
* `labels`: required, array of object
* `assignees`: array of `Simple User` (see above)
* `milestone`: required, any of:
  * **null**
  * **Milestone**
    * `url`: required, string, format: uri
    * `html_url`: required, string, format: uri
    * `labels_url`: required, string, format: uri
    * `id`: required, integer
    * `node_id`: required, string
    * `number`: required, integer
    * `state`: required, string, enum: `open`, `closed`, default: `"open"`
    * `title`: required, string
    * `description`: required, string or null
    * `creator`: required, any of:
      * **null**
      * **Simple User** (see above)
    * `open_issues`: required, integer
    * `closed_issues`: required, integer
    * `created_at`: required, string, format: date-time
    * `updated_at`: required, string, format: date-time
    * `closed_at`: required, string or null, format: date-time
    * `due_on`: required, string or null, format: date-time
* `locked`: required, boolean
* `active_lock_reason`: string or null
* `comments`: required, integer
* `pull_request`: object:
  * `merged_at`: string or null, format: date-time
  * `diff_url`: required, string or null, format: uri
  * `html_url`: required, string or null, format: uri
  * `patch_url`: required, string or null, format: uri
  * `url`: required, string or null, format: uri
* `closed_at`: required, string or null, format: date-time
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `draft`: boolean
* `closed_by`: any of:
  * **null**
  * **Simple User** (see above)
* `body_html`: string
* `body_text`: string
* `timeline_url`: string, format: uri
* `type`: `Issue Type`:
  * `id`: required, integer
  * `node_id`: required, string
  * `name`: required, string
  * `description`: required, string or null
  * `color`: string or null, enum: `gray`, `blue`, `green`, `yellow`, `orange`, `red`, `pink`, `purple`, `null`
  * `created_at`: string, format: date-time
  * `updated_at`: string, format: date-time
  * `is_enabled`: boolean
* `repository`: `Repository`:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `name`: required, string
  * `full_name`: required, string
  * `license`: required, any of:
    * **null**
    * **License Simple**
      * `key`: required, string
      * `name`: required, string
      * `url`: required, string or null, format: uri
      * `spdx_id`: required, string or null
      * `node_id`: required, string
      * `html_url`: string, format: uri
  * `forks`: required, integer
  * `permissions`: object:
    * `admin`: required, boolean
    * `pull`: required, boolean
    * `triage`: boolean
    * `push`: required, boolean
    * `maintain`: boolean
  * `owner`: required, `Simple User` (see above)
  * `private`: required, boolean, default: `false`
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
  * `git_url`: required, string
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
  * `ssh_url`: required, string
  * `stargazers_url`: required, string, format: uri
  * `statuses_url`: required, string
  * `subscribers_url`: required, string, format: uri
  * `subscription_url`: required, string, format: uri
  * `tags_url`: required, string, format: uri
  * `teams_url`: required, string, format: uri
  * `trees_url`: required, string
  * `clone_url`: required, string
  * `mirror_url`: required, string or null, format: uri
  * `hooks_url`: required, string, format: uri
  * `svn_url`: required, string, format: uri
  * `homepage`: required, string or null, format: uri
  * `language`: required, string or null
  * `forks_count`: required, integer
  * `stargazers_count`: required, integer
  * `watchers_count`: required, integer
  * `size`: required, integer
  * `default_branch`: required, string
  * `open_issues_count`: required, integer
  * `is_template`: boolean, default: `false`
  * `topics`: array of string
  * `has_issues`: required, boolean, default: `true`
  * `has_projects`: required, boolean, default: `true`
  * `has_wiki`: required, boolean, default: `true`
  * `has_pages`: required, boolean
  * `has_discussions`: boolean, default: `false`
  * `has_pull_requests`: boolean, default: `true`
  * `pull_request_creation_policy`: string, enum: `all`, `collaborators_only`
  * `archived`: required, boolean, default: `false`
  * `disabled`: required, boolean
  * `visibility`: string, default: `"public"`
  * `pushed_at`: required, string or null, format: date-time
  * `created_at`: required, string or null, format: date-time
  * `updated_at`: required, string or null, format: date-time
  * `allow_rebase_merge`: boolean, default: `true`
  * `temp_clone_token`: string
  * `allow_squash_merge`: boolean, default: `true`
  * `allow_auto_merge`: boolean, default: `false`
  * `delete_branch_on_merge`: boolean, default: `false`
  * `allow_update_branch`: boolean, default: `false`
  * `squash_merge_commit_title`: string, enum: `PR_TITLE`, `COMMIT_OR_PR_TITLE`
  * `squash_merge_commit_message`: string, enum: `PR_BODY`, `COMMIT_MESSAGES`, `BLANK`
  * `merge_commit_title`: string, enum: `PR_TITLE`, `MERGE_MESSAGE`
  * `merge_commit_message`: string, enum: `PR_BODY`, `PR_TITLE`, `BLANK`
  * `allow_merge_commit`: boolean, default: `true`
  * `allow_forking`: boolean
  * `web_commit_signoff_required`: boolean, default: `false`
  * `open_issues`: required, integer
  * `watchers`: required, integer
  * `starred_at`: string
  * `anonymous_access_enabled`: boolean
  * `code_search_index_status`: object:
    * `lexical_search_ok`: boolean
    * `lexical_commit_sha`: string
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
* `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
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
* `sub_issues_summary`: `Sub-issues Summary`:
  * `total`: required, integer
  * `completed`: required, integer
  * `percent_completed`: required, integer
* `parent_issue_url`: string or null, format: uri
* `pinned_comment`: any of:
  * **null**
  * **Issue Comment**
    * `id`: required, integer, format: int64
    * `node_id`: required, string
    * `url`: required, string, format: uri
    * `body`: string
    * `body_text`: string
    * `body_html`: string
    * `html_url`: required, string, format: uri
    * `user`: required, any of:
      * **null**
      * **Simple User** (see above)
    * `created_at`: required, string, format: date-time
    * `updated_at`: required, string, format: date-time
    * `issue_url`: required, string, format: uri
    * `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
    * `performed_via_github_app`: any of:
      * **null**
      * **GitHub app** (see above)
    * `reactions`: `Reaction Rollup` (see above)
    * `pin`: any of:
      * **null**
      * **Pinned Issue Comment**
        * `pinned_at`: required, string, format: date-time
        * `pinned_by`: required, any of:
          * **null**
          * **Simple User** (see above)
    * `minimized`: any of:
      * **null**
      * **Minimized Issue Comment**
        * `reason`: required, string or null
* `issue_dependencies_summary`: `Issue Dependencies Summary`:
  * `blocked_by`: required, integer
  * `blocking`: required, integer
  * `total_blocked_by`: required, integer
  * `total_blocking`: required, integer
* `issue_field_values`: array of `Issue Field Value`:
  * `issue_field_id`: required, integer, format: int64
  * `issue_field_name`: string
  * `node_id`: required, string
  * `data_type`: required, string, enum: `text`, `single_select`, `multi_select`, `number`, `date`
  * `value`: required, any of:
    * **string**
    * **number**
    * **integer**
  * `single_select_option`: object or null:
    * `id`: required, integer, format: int64
    * `name`: required, string
    * `color`: required, string
  * `multi_select_options`: array of objects or null:
    * `id`: required, integer, format: int64
    * `name`: required, string
    * `color`: required, string

## Get an issue

```
GET /repos/{owner}/{repo}/issues/{issue_number}
```

The API returns a 301 Moved Permanently status if the issue was
transferred to another repository. If
the issue was transferred to or deleted from a repository where the authenticated user lacks read access, the API
returns a 404 Not Found status. If the issue was deleted from a repository where the authenticated user has read
access, the API returns a 410 Gone status. To receive webhook events for transferred and deleted issues, subscribe
to the issues webhook.
Note

GitHub's REST API considers every pull request an issue, but not every issue is a pull request. For this reason, "Issues" endpoints may return both issues and pull requests in the response. You can identify pull requests by the pull_request key. Be aware that the id of a pull request returned from "Issues" endpoints will be an issue id. To find out the pull request id, use the "List pull requests" endpoint.

This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

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

- **200** - OK

- **301** - Moved permanently

- **304** - Not modified

- **404** - Resource not found

- **410** - Gone

### Code examples

#### Example 1: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER
```

**Response schema (Status: 200):**

Same response schema as [Create an issue](#create-an-issue).

#### Example 2: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER
```

**Response schema (Status: 200):**

Same response schema as [Create an issue](#create-an-issue).

## Update an issue

```
PATCH /repos/{owner}/{repo}/issues/{issue_number}
```

Issue owners and users with push access or Triage role can edit an issue.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

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

- **`title`** (null or string or integer)
  The title of the issue.

- **`body`** (string or null)
  The contents of the issue.

- **`state`** (string)
  The open or closed state of the issue.
  Can be one of: `open`, `closed`

- **`state_reason`** (string or null)
  The reason for the state change. Ignored unless state is changed.
  Can be one of: `completed`, `not_planned`, `duplicate`, `reopened`, `null`

- **`duplicate_issue_id`** (integer)
  The ID of the issue to mark as the canonical duplicate when state_reason is duplicate. The issue must exist and be accessible to the authenticated user. Ignored when state_reason is not duplicate.

- **`milestone`** (null or string or integer)
  The number of the milestone to associate this issue with or use null to remove the current milestone. Only users with push access can set the milestone for issues. Without push access to the repository, milestone changes are silently dropped.

- **`labels`** (array)
  Labels to associate with this issue. Pass one or more labels to replace the set of labels on this issue. Send an empty array ([]) to clear all labels from the issue. Only users with push access can set labels for issues. Without push access to the repository, label changes are silently dropped.

- **`assignees`** (array)
  Usernames to assign to this issue. Pass one or more user logins to replace the set of assignees on this issue. Send an empty array ([]) to clear all assignees from the issue. Only users with push access can set assignees for new issues. Without push access to the repository, assignee changes are silently dropped.

- **`issue_field_values`** (array of objects)
  An array of issue field values to set on this issue. Each field value must include the field ID and the value to set. Only users with push access can set field values for issues
  - **`field_id`** (integer) (required)
    The ID of the issue field to set
  - **`value`** (string or number or array) (required)
    The value to set for the field. For multi-select fields, provide an array of option names.
  - **`rationale`** (string)
    Optional reasoning for setting this field value.
  - **`suggest`** (boolean)
    If true, the change is stored as a pending suggestion for human review rather than applied directly.
  - **`confidence`** (string)
    The confidence level for this field value choice.
    Can be one of: `low`, `medium`, `high`

- **`type`** (null or string or object)
  The issue type to associate with this issue. Only users with push access can set the type for issues. Without push access to the repository, type changes are silently dropped.

### HTTP response status codes

- **200** - OK

- **301** - Moved permanently

- **403** - Forbidden

- **404** - Resource not found

- **410** - Gone

- **422** - Validation failed, or the endpoint has been spammed.

- **503** - Service unavailable

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER \
  -d '{
  "title": "Found a bug",
  "body": "I'\''m having a problem with this.",
  "assignees": [
    "octocat"
  ],
  "milestone": 1,
  "state": "open",
  "labels": [
    "bug"
  ]
}'
```

**Response schema (Status: 200):**

* all of:
  * **Issue**
    * `id`: required, integer, format: int64
    * `node_id`: required, string
    * `url`: required, string, format: uri
    * `repository_url`: required, string, format: uri
    * `labels_url`: required, string
    * `comments_url`: required, string, format: uri
    * `events_url`: required, string, format: uri
    * `html_url`: required, string, format: uri
    * `number`: required, integer
    * `state`: required, string
    * `state_reason`: string or null, enum: `completed`, `reopened`, `not_planned`, `duplicate`, `null`
    * `title`: required, string
    * `body`: string or null
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
    * `labels`: required, array of object
    * `assignees`: array of `Simple User` (see above)
    * `milestone`: required, any of:
      * **null**
      * **Milestone**
        * `url`: required, string, format: uri
        * `html_url`: required, string, format: uri
        * `labels_url`: required, string, format: uri
        * `id`: required, integer
        * `node_id`: required, string
        * `number`: required, integer
        * `state`: required, string, enum: `open`, `closed`, default: `"open"`
        * `title`: required, string
        * `description`: required, string or null
        * `creator`: required, any of:
          * **null**
          * **Simple User** (see above)
        * `open_issues`: required, integer
        * `closed_issues`: required, integer
        * `created_at`: required, string, format: date-time
        * `updated_at`: required, string, format: date-time
        * `closed_at`: required, string or null, format: date-time
        * `due_on`: required, string or null, format: date-time
    * `locked`: required, boolean
    * `active_lock_reason`: string or null
    * `comments`: required, integer
    * `pull_request`: object:
      * `merged_at`: string or null, format: date-time
      * `diff_url`: required, string or null, format: uri
      * `html_url`: required, string or null, format: uri
      * `patch_url`: required, string or null, format: uri
      * `url`: required, string or null, format: uri
    * `closed_at`: required, string or null, format: date-time
    * `created_at`: required, string, format: date-time
    * `updated_at`: required, string, format: date-time
    * `draft`: boolean
    * `closed_by`: any of:
      * **null**
      * **Simple User** (see above)
    * `body_html`: string
    * `body_text`: string
    * `timeline_url`: string, format: uri
    * `type`: `Issue Type`:
      * `id`: required, integer
      * `node_id`: required, string
      * `name`: required, string
      * `description`: required, string or null
      * `color`: string or null, enum: `gray`, `blue`, `green`, `yellow`, `orange`, `red`, `pink`, `purple`, `null`
      * `created_at`: string, format: date-time
      * `updated_at`: string, format: date-time
      * `is_enabled`: boolean
    * `repository`: `Repository`:
      * `id`: required, integer, format: int64
      * `node_id`: required, string
      * `name`: required, string
      * `full_name`: required, string
      * `license`: required, any of:
        * **null**
        * **License Simple**
          * `key`: required, string
          * `name`: required, string
          * `url`: required, string or null, format: uri
          * `spdx_id`: required, string or null
          * `node_id`: required, string
          * `html_url`: string, format: uri
      * `forks`: required, integer
      * `permissions`: object:
        * `admin`: required, boolean
        * `pull`: required, boolean
        * `triage`: boolean
        * `push`: required, boolean
        * `maintain`: boolean
      * `owner`: required, `Simple User` (see above)
      * `private`: required, boolean, default: `false`
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
      * `git_url`: required, string
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
      * `ssh_url`: required, string
      * `stargazers_url`: required, string, format: uri
      * `statuses_url`: required, string
      * `subscribers_url`: required, string, format: uri
      * `subscription_url`: required, string, format: uri
      * `tags_url`: required, string, format: uri
      * `teams_url`: required, string, format: uri
      * `trees_url`: required, string
      * `clone_url`: required, string
      * `mirror_url`: required, string or null, format: uri
      * `hooks_url`: required, string, format: uri
      * `svn_url`: required, string, format: uri
      * `homepage`: required, string or null, format: uri
      * `language`: required, string or null
      * `forks_count`: required, integer
      * `stargazers_count`: required, integer
      * `watchers_count`: required, integer
      * `size`: required, integer
      * `default_branch`: required, string
      * `open_issues_count`: required, integer
      * `is_template`: boolean, default: `false`
      * `topics`: array of string
      * `has_issues`: required, boolean, default: `true`
      * `has_projects`: required, boolean, default: `true`
      * `has_wiki`: required, boolean, default: `true`
      * `has_pages`: required, boolean
      * `has_discussions`: boolean, default: `false`
      * `has_pull_requests`: boolean, default: `true`
      * `pull_request_creation_policy`: string, enum: `all`, `collaborators_only`
      * `archived`: required, boolean, default: `false`
      * `disabled`: required, boolean
      * `visibility`: string, default: `"public"`
      * `pushed_at`: required, string or null, format: date-time
      * `created_at`: required, string or null, format: date-time
      * `updated_at`: required, string or null, format: date-time
      * `allow_rebase_merge`: boolean, default: `true`
      * `temp_clone_token`: string
      * `allow_squash_merge`: boolean, default: `true`
      * `allow_auto_merge`: boolean, default: `false`
      * `delete_branch_on_merge`: boolean, default: `false`
      * `allow_update_branch`: boolean, default: `false`
      * `squash_merge_commit_title`: string, enum: `PR_TITLE`, `COMMIT_OR_PR_TITLE`
      * `squash_merge_commit_message`: string, enum: `PR_BODY`, `COMMIT_MESSAGES`, `BLANK`
      * `merge_commit_title`: string, enum: `PR_TITLE`, `MERGE_MESSAGE`
      * `merge_commit_message`: string, enum: `PR_BODY`, `PR_TITLE`, `BLANK`
      * `allow_merge_commit`: boolean, default: `true`
      * `allow_forking`: boolean
      * `web_commit_signoff_required`: boolean, default: `false`
      * `open_issues`: required, integer
      * `watchers`: required, integer
      * `starred_at`: string
      * `anonymous_access_enabled`: boolean
      * `code_search_index_status`: object:
        * `lexical_search_ok`: boolean
        * `lexical_commit_sha`: string
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
    * `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
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
    * `sub_issues_summary`: `Sub-issues Summary`:
      * `total`: required, integer
      * `completed`: required, integer
      * `percent_completed`: required, integer
    * `parent_issue_url`: string or null, format: uri
    * `pinned_comment`: any of:
      * **null**
      * **Issue Comment**
        * `id`: required, integer, format: int64
        * `node_id`: required, string
        * `url`: required, string, format: uri
        * `body`: string
        * `body_text`: string
        * `body_html`: string
        * `html_url`: required, string, format: uri
        * `user`: required, any of:
          * **null**
          * **Simple User** (see above)
        * `created_at`: required, string, format: date-time
        * `updated_at`: required, string, format: date-time
        * `issue_url`: required, string, format: uri
        * `author_association`: string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
        * `performed_via_github_app`: any of:
          * **null**
          * **GitHub app** (see above)
        * `reactions`: `Reaction Rollup` (see above)
        * `pin`: any of:
          * **null**
          * **Pinned Issue Comment**
            * `pinned_at`: required, string, format: date-time
            * `pinned_by`: required, any of:
              * **null**
              * **Simple User** (see above)
        * `minimized`: any of:
          * **null**
          * **Minimized Issue Comment**
            * `reason`: required, string or null
    * `issue_dependencies_summary`: `Issue Dependencies Summary`:
      * `blocked_by`: required, integer
      * `blocking`: required, integer
      * `total_blocked_by`: required, integer
      * `total_blocking`: required, integer
    * `issue_field_values`: array of `Issue Field Value`:
      * `issue_field_id`: required, integer, format: int64
      * `issue_field_name`: string
      * `node_id`: required, string
      * `data_type`: required, string, enum: `text`, `single_select`, `multi_select`, `number`, `date`
      * `value`: required, any of:
        * **string**
        * **number**
        * **integer**
      * `single_select_option`: object or null:
        * `id`: required, integer, format: int64
        * `name`: required, string
        * `color`: required, string
      * `multi_select_options`: array of objects or null:
        * `id`: required, integer, format: int64
        * `name`: required, string
        * `color`: required, string
  * **object**
    * `suggestions`: object:
      * `type`: array of objects:
        * `value`: string
        * `rationale`: string
        * `suggest`: boolean
        * `confidence`: string, enum: `low`, `medium`, `high`
        * `ignored`: boolean
        * `ignored_reason`: string, enum: `already_applied`, `issue_already_closed`
      * `issue_field_values`: array of objects:
        * `field_id`: integer
        * `value`: one of:
          * **string**
          * **number**
          * **array**
        * `rationale`: string
        * `suggest`: boolean
        * `confidence`: string, enum: `low`, `medium`, `high`
        * `ignored`: boolean
        * `ignored_reason`: string, enum: `already_applied`, `issue_already_closed`
      * `labels`: array of objects:
        * `name`: string
        * `rationale`: string
        * `suggest`: boolean
        * `confidence`: string, enum: `low`, `medium`, `high`
        * `ignored`: boolean
        * `ignored_reason`: string, enum: `already_applied`, `issue_already_closed`
      * `assignees`: array of objects:
        * `login`: string
        * `rationale`: string
        * `suggest`: boolean
        * `confidence`: string, enum: `low`, `medium`, `high`
        * `ignored`: boolean
        * `ignored_reason`: string, enum: `already_applied`, `issue_already_closed`
      * `state`: array of objects:
        * `value`: string
        * `state_reason`: string
        * `duplicate_issue_id`: integer
        * `rationale`: string
        * `suggest`: boolean
        * `confidence`: string, enum: `low`, `medium`, `high`
        * `ignored`: boolean
        * `ignored_reason`: string, enum: `already_applied`, `issue_already_closed`

## Lock an issue

```
PUT /repos/{owner}/{repo}/issues/{issue_number}/lock
```

Users with push access can lock an issue or pull request's conversation.
Note that, if you choose not to pass any parameters, you'll need to set Content-Length to zero when calling out to this endpoint. For more information, see "HTTP method."

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

- **`lock_reason`** (string)
  The reason for locking the issue or pull request conversation. Lock will fail if you don't use one of these reasons:

off-topic
too heated
resolved
spam
  Can be one of: `off-topic`, `too heated`, `resolved`, `spam`

### HTTP response status codes

- **204** - No Content

- **403** - Forbidden

- **404** - Resource not found

- **410** - Gone

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example of locking an issue as off-topic

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/lock \
  -d '{
  "lock_reason": "off-topic"
}'
```

**Response schema (Status: 204):**

## Unlock an issue

```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock
```

Users with push access can unlock an issue's conversation.

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

- **403** - Forbidden

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/lock
```

**Response schema (Status: 204):**

## List issues related to an issue

```
GET /repos/{owner}/{repo}/issues/{issue_number}/relates_to
```

You can use the REST API to list the issues that are related to an issue.
This endpoint supports the following custom media types. For more information, see Media types.

application/vnd.github.raw+json: Returns the raw Markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the Markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's Markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

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
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/relates_to
```

**Response schema (Status: 200):**

Same response schema as [List issues assigned to the authenticated user](#list-issues-assigned-to-the-authenticated-user).

## Add a related issue

```
POST /repos/{owner}/{repo}/issues/{issue_number}/relates_to
```

You can use the REST API to mark an issue as related to another issue.
Creating content too quickly using this endpoint may result in secondary rate limiting.
For more information, see Rate limits for the API
and Best practices for using the REST API.
This endpoint supports the following custom media types. For more information, see Media types.

application/vnd.github.raw+json: Returns the raw Markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the Markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's Markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

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

- **`issue_id`** (integer) (required)
  The id of the issue to mark as related to the current issue

### HTTP response status codes

- **201** - Created

- **301** - Moved permanently

- **403** - Forbidden

- **404** - Resource not found

- **410** - Gone

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/relates_to \
  -d '{
  "issue_id": 1
}'
```

**Response schema (Status: 201):**

Same response schema as [Create an issue](#create-an-issue).

## Remove a related issue

```
DELETE /repos/{owner}/{repo}/issues/{issue_number}/relates_to/{issue_id}
```

You can use the REST API to remove a 'relates to' relationship between two issues.
Removing content too quickly using this endpoint may result in secondary rate limiting.
For more information, see Rate limits for the API
and Best practices for using the REST API.
This endpoint supports the following custom media types. For more information, see Media types.

application/vnd.github.raw+json: Returns the raw Markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the Markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's Markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

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

- **`issue_id`** (integer) (required)
  The id of the related issue to remove

### HTTP response status codes

- **200** - OK

- **301** - Moved permanently

- **400** - Bad Request

- **403** - Forbidden

- **404** - Resource not found

- **410** - Gone

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/relates_to/ISSUE_ID
```

**Response schema (Status: 200):**

Same response schema as [Create an issue](#create-an-issue).

## List issue suggestions

```
GET /repos/{owner}/{repo}/issues/{issue_number}/suggestions
```

Lists the suggestions on an issue. A suggestion is an agent-proposed change to an issue's type, labels, fields, assignees, or closed state that a maintainer can approve or dismiss.
By default only pending suggestions are returned. Use state=all to return suggestions in every state, or state=<state> to filter to a single state. Use action=<action> to return only suggestions for a specific change.
This endpoint is only available while the issue suggestions feature is enabled for the repository, and only supports issues, not pull requests.
Requires triage access to the repository.

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

- **`state`** (string)
  Filter suggestions by their state.
  Default: `pending`
  Can be one of: `pending`, `applied`, `approved`, `dismissed`, `replaced`, `invalidated`, `all`

- **`action`** (string)
  Filter suggestions by the change they propose.
  Can be one of: `set_type`, `add_label`, `add_field`, `add_assignee`, `close_issue`

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/suggestions
```

**Response schema (Status: 200):**

Array of `Issue Suggestion`:
  * `id`: required, integer
  * `issue_id`: required, integer
  * `action`: required, string, enum: `set_type`, `add_label`, `add_field`, `add_assignee`, `close_issue`
  * `state`: required, string, enum: `pending`, `applied`, `approved`, `dismissed`, `replaced`, `invalidated`
  * `target_id`: required, integer or null
  * `target_value`: required, one of:
    * **string**
    * **number**
    * **boolean**
    * **array**
  * `rationale`: required, string or null
  * `confidence`: required, string or null, enum: `LOW`, `MEDIUM`, `HIGH`, `null`
  * `actor_id`: required, integer or null
  * `issue_event_id`: required, integer or null
  * `resolved_by`: required, integer or null
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time

## Approve an issue suggestion

```
POST /repos/{owner}/{repo}/issues/{issue_number}/suggestions/{suggestion_id}/approve
```

Approves a pending suggestion on an issue. Applies the proposed change (creating the corresponding timeline event), transitions the suggestion to approved, and dismisses any competing pending suggestions for the same change.
Requires triage access to the repository. Approving a suggestion also requires permission to perform the change it applies (for example, setting the issue type, adding a label or assignee, or closing the issue); this only affects fine-grained access tokens and GitHub Apps whose permissions are narrower than the triage role. This endpoint only supports issues, not pull requests.

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

- **`suggestion_id`** (integer) (required)
  The unique identifier of the suggestion.

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
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/suggestions/SUGGESTION_ID/approve
```

**Response schema (Status: 200):**

* `id`: required, integer
* `issue_id`: required, integer
* `action`: required, string, enum: `set_type`, `add_label`, `add_field`, `add_assignee`, `close_issue`
* `state`: required, string, enum: `pending`, `applied`, `approved`, `dismissed`, `replaced`, `invalidated`
* `target_id`: required, integer or null
* `target_value`: required, one of:
  * **string**
  * **number**
  * **boolean**
  * **array**
* `rationale`: required, string or null
* `confidence`: required, string or null, enum: `LOW`, `MEDIUM`, `HIGH`, `null`
* `actor_id`: required, integer or null
* `issue_event_id`: required, integer or null
* `resolved_by`: required, integer or null
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time

## Dismiss an issue suggestion

```
POST /repos/{owner}/{repo}/issues/{issue_number}/suggestions/{suggestion_id}/dismiss
```

Dismisses a pending suggestion on an issue. Transitions the suggestion to dismissed without applying any change or creating a timeline event.
Requires triage access to the repository. This endpoint only supports issues, not pull requests.

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

- **`suggestion_id`** (integer) (required)
  The unique identifier of the suggestion.

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
  https://api.github.com/repos/OWNER/REPO/issues/ISSUE_NUMBER/suggestions/SUGGESTION_ID/dismiss
```

**Response schema (Status: 200):**

Same response schema as [Approve an issue suggestion](#approve-an-issue-suggestion).

## List user account issues assigned to the authenticated user

```
GET /user/issues
```

List issues across owned and member repositories assigned to the authenticated user.
Note

GitHub's REST API considers every pull request an issue, but not every issue is a pull request. For this reason, "Issues" endpoints may return both issues and pull requests in the response. You can identify pull requests by the pull_request key. Be aware that the id of a pull request returned from "Issues" endpoints will be an issue id. To find out the pull request id, use the "List pull requests" endpoint.

This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body_text, and body_html.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`filter`** (string)
  Indicates which sorts of issues to return. assigned means issues assigned to you. created means issues created by you. mentioned means issues mentioning you. subscribed means issues you're subscribed to updates for. all or repos means all issues you can see, regardless of participation or creation.
  Default: `assigned`
  Can be one of: `assigned`, `created`, `mentioned`, `subscribed`, `repos`, `all`

- **`state`** (string)
  Indicates the state of the issues to return.
  Default: `open`
  Can be one of: `open`, `closed`, `all`

- **`labels`** (string)
  A list of comma separated label names. Example: bug,ui,@high

- **`sort`** (string)
  What to sort results by.
  Default: `created`
  Can be one of: `created`, `updated`, `comments`

- **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

- **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

- **304** - Not modified

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/user/issues
```

**Response schema (Status: 200):**

Same response schema as [List issues assigned to the authenticated user](#list-issues-assigned-to-the-authenticated-user).