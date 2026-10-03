---
title: REST API endpoints for pull requests
url: https://docs.github.com/en/rest/pulls/pulls
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for pull requests

Use the REST API to interact with pull requests.

## About pull requests

You can list, view, edit, create, and merge pull requests using the REST API. For information about how to interact with comments on a pull request, see [REST API endpoints for issue comments](/en/rest/issues/comments).

Pull requests are a type of issue. Any actions that are available in both pull requests and issues, like managing assignees, labels, and milestones, are handled by the REST API to manage issues. To perform these actions on pull requests, you must use the issues API endpoints (for example, `/repos/{owner}/{repo}/issues/{issue_number}`), not the pull requests endpoints. For more information, see [REST API endpoints for issues](/en/rest/issues).

### Link Relations

Pull requests have these possible link relations:

* `self`: The API location of this pull request
* `html`: The HTML location of this pull request
* `issue`: The API location of this pull request's [issue](/en/rest/issues)
* `comments`: The API location of this pull request's [issue comments](/en/rest/issues/comments)
* `review_comments`: The API location of this pull request's [review comments](/en/rest/pulls/comments)
* `review_comment`: The [URL template](/en/rest/using-the-rest-api/getting-started-with-the-rest-api#hypermedia) to construct the API location for a [review comment](/en/rest/pulls/comments) in this pull request's repository
* `commits`: The API location of this pull request's [commits](#list-commits-on-a-pull-request)
* `statuses`: The API location of this pull request's [commit statuses](/en/rest/commits#commit-statuses), which are the statuses of its `head` branch

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List pull requests

```
GET /repos/{owner}/{repo}/pulls
```

Lists pull requests in a specified repository.
Draft pull requests are available in public repositories with GitHub
Free and GitHub Free for organizations, GitHub Pro, and legacy per-repository billing
plans, and in public and private repositories with GitHub Team and GitHub Enterprise
Cloud. For more information, see GitHub's products
in the GitHub Help documentation.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`state`** (string)
  Either open, closed, or all to filter by state.
  Default: `open`
  Can be one of: `open`, `closed`, `all`

* **`head`** (string)
  Filter pulls by head user or head organization and branch name in the format of user:ref-name or organization:ref-name. For example: github:new-script-format or octocat:test-branch.

* **`base`** (string)
  Filter pulls by base branch name. Example: gh-pages.

* **`sort`** (string)
  What to sort results by. popularity will sort by the number of comments. long-running will sort by date created and will limit the results to pull requests that have been open for more than a month and have had activity within the past month.
  Default: `created`
  Can be one of: `created`, `updated`, `popularity`, `long-running`

* **`direction`** (string)
  The direction of the sort. Default: desc when sort is created or sort is not specified, otherwise asc.
  Can be one of: `asc`, `desc`

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

* **200** - OK

* **304** - Not modified

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls
```

**Response schema (Status: 200):**

Array of `Pull Request Simple`:

* `url`: required, string, format: uri
* `id`: required, integer, format: int64
* `node_id`: required, string
* `html_url`: required, string, format: uri
* `diff_url`: required, string, format: uri
* `patch_url`: required, string, format: uri
* `issue_url`: required, string, format: uri
* `commits_url`: required, string, format: uri
* `review_comments_url`: required, string, format: uri
* `review_comment_url`: required, string
* `comments_url`: required, string, format: uri
* `statuses_url`: required, string, format: uri
* `number`: required, integer
* `state`: required, string
* `locked`: required, boolean
* `title`: required, string
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
* `body`: required, string or null
* `labels`: required, array of objects:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `url`: required, string
  * `name`: required, string
  * `description`: required, string
  * `color`: required, string
  * `default`: required, boolean
  * `archived_by`: required, all of:
    * **Simple User** (see above)
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
* `active_lock_reason`: string or null
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `closed_at`: required, string or null, format: date-time
* `merged_at`: required, string or null, format: date-time
* `assignees`: array of `Simple User` (see above)
* `requested_reviewers`: array of `Simple User` (see above)
* `requested_teams`: array of `Team`:
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
* `head`: required, object:
  * `label`: required, string
  * `ref`: required, string
  * `repo`: required, `Repository`:
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
  * `sha`: required, string
  * `user`: required, any of:
    * **null**
    * **Simple User** (see above)
* `base`: required, object:
  * `label`: required, string
  * `ref`: required, string
  * `repo`: required, `Repository` (see above)
  * `sha`: required, string
  * `user`: required, any of:
    * **null**
    * **Simple User** (see above)
* `_links`: required, object:
  * `comments`: required, `Link`:
    * `href`: required, string
  * `commits`: required, `Link` (see above)
  * `statuses`: required, `Link` (see above)
  * `html`: required, `Link` (see above)
  * `issue`: required, `Link` (see above)
  * `review_comments`: required, `Link` (see above)
  * `review_comment`: required, `Link` (see above)
  * `self`: required, `Link` (see above)
* `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
* `auto_merge`: required, `Auto merge`:
  * `enabled_by`: required, `Simple User` (see above)
  * `merge_method`: required, string, enum: `merge`, `squash`, `rebase`
  * `commit_title`: required, string
  * `commit_message`: required, string
* `stack`: `Pull Request Stack`:
  * `base`: required, object:
    * `ref`: required, string
    * `sha`: required, string
  * `size`: integer
  * `position`: integer
  * `id`: integer
  * `number`: integer
* `draft`: boolean

## Create a pull request

```
POST /repos/{owner}/{repo}/pulls
```

Draft pull requests are available in public repositories with GitHub Free and GitHub Free for organizations, GitHub Pro, and legacy per-repository billing plans, and in public and private repositories with GitHub Team and GitHub Enterprise Cloud. For more information, see GitHub's products in the GitHub Help documentation.
To open or update a pull request in a public repository, you must have write access to the head or the source branch. For organization-owned repositories, you must be a member of the organization that owns the repository to open or update a pull request.
This endpoint triggers notifications. Creating content too quickly using this endpoint may result in secondary rate limiting. For more information, see "Rate limits for the API" and "Best practices for using the REST API."
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

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

* **`title`** (string)
  The title of the new pull request. Required unless issue is specified.

* **`head`** (string) (required)
  The name of the branch where your changes are implemented. For cross-repository pull requests in the same network, namespace head with a user like this: username:branch.

* **`head_repo`** (string)
  The name of the repository where the changes in the pull request were made. This field is required for cross-repository pull requests if both repositories are owned by the same organization.

* **`base`** (string) (required)
  The name of the branch you want the changes pulled into. This should be an existing branch on the current repository. You cannot submit a pull request to one repository that requests a merge to a base of another repository.

* **`body`** (string)
  The contents of the pull request.

* **`maintainer_can_modify`** (boolean)
  Indicates whether maintainers can modify the pull request.

* **`draft`** (boolean)
  Indicates whether the pull request is a draft. See "Draft Pull Requests" in the GitHub Help documentation to learn more.

* **`issue`** (integer)
  An issue in the repository to convert to a pull request. The issue title, body, and comments will become the title, body, and comments on the new pull request. Required unless title is specified.

### HTTP response status codes

* **201** - Created

* **403** - Forbidden

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/pulls \
  -d '{
  "title": "Amazing new feature",
  "body": "Please pull these awesome changes in!",
  "head": "octocat:new-feature",
  "base": "master"
}'
```

**Response schema (Status: 201):**

* `url`: required, string, format: uri
* `id`: required, integer, format: int64
* `node_id`: required, string
* `html_url`: required, string, format: uri
* `diff_url`: required, string, format: uri
* `patch_url`: required, string, format: uri
* `issue_url`: required, string, format: uri
* `commits_url`: required, string, format: uri
* `review_comments_url`: required, string, format: uri
* `review_comment_url`: required, string
* `comments_url`: required, string, format: uri
* `statuses_url`: required, string, format: uri
* `number`: required, integer
* `state`: required, string, enum: `open`, `closed`
* `locked`: required, boolean
* `title`: required, string
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
* `body`: required, string or null
* `labels`: required, array of objects:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `url`: required, string
  * `name`: required, string
  * `description`: required, string or null
  * `color`: required, string
  * `default`: required, boolean
  * `archived_by`: required, all of:
    * **Simple User** (see above)
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
* `active_lock_reason`: string or null
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `closed_at`: required, string or null, format: date-time
* `merged_at`: required, string or null, format: date-time
* `assignees`: array of `Simple User` (see above)
* `requested_reviewers`: array of `Simple User` (see above)
* `requested_teams`: array of `Team Simple`:
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
* `head`: required, object:
  * `label`: required, string
  * `ref`: required, string
  * `repo`: required, `Repository`:
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
  * `sha`: required, string
  * `user`: required, `Simple User` (see above)
* `base`: required, object:
  * `label`: required, string
  * `ref`: required, string
  * `repo`: required, `Repository` (see above)
  * `sha`: required, string
  * `user`: required, `Simple User` (see above)
* `_links`: required, object:
  * `comments`: required, `Link`:
    * `href`: required, string
  * `commits`: required, `Link` (see above)
  * `statuses`: required, `Link` (see above)
  * `html`: required, `Link` (see above)
  * `issue`: required, `Link` (see above)
  * `review_comments`: required, `Link` (see above)
  * `review_comment`: required, `Link` (see above)
  * `self`: required, `Link` (see above)
* `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`
* `auto_merge`: required, `Auto merge`:
  * `enabled_by`: required, `Simple User` (see above)
  * `merge_method`: required, string, enum: `merge`, `squash`, `rebase`
  * `commit_title`: required, string
  * `commit_message`: required, string
* `stack`: `Pull Request Stack`:
  * `base`: required, object:
    * `ref`: required, string
    * `sha`: required, string
  * `size`: integer
  * `position`: integer
  * `id`: integer
  * `number`: integer
* `draft`: boolean
* `merged`: required, boolean
* `mergeable`: required, boolean or null
* `rebaseable`: boolean or null
* `mergeable_state`: required, string
* `merged_by`: required, any of:
  * **null**
  * **Simple User** (see above)
* `comments`: required, integer
* `review_comments`: required, integer
* `maintainer_can_modify`: required, boolean
* `commits`: required, integer
* `additions`: required, integer
* `deletions`: required, integer
* `changed_files`: required, integer

## Get a pull request

```
GET /repos/{owner}/{repo}/pulls/{pull_number}
```

Draft pull requests are available in public repositories with GitHub Free and GitHub Free for organizations, GitHub Pro, and legacy per-repository billing plans, and in public and private repositories with GitHub Team and GitHub Enterprise Cloud. For more information, see GitHub's products in the GitHub Help documentation.
Lists details of a pull request by providing its number.
When you get, create, or edit a pull request, GitHub creates a merge commit to test whether the pull request can be automatically merged into the base branch. This test commit is not added to the base branch or the head branch. You can review the status of the test commit using the mergeable key. For more information, see "Checking mergeability of pull requests".
The value of the mergeable attribute can be true, false, or null. If the value is null, then GitHub has started a background job to compute the mergeability. After giving the job time to complete, resubmit the request. When the job finishes, you will see a non-null value for the mergeable attribute in the response. If mergeable is true, then merge\_commit\_sha will be the SHA of the test merge commit.
The value of the merge\_commit\_sha attribute changes depending on the state of the pull request. Before merging a pull request, the merge\_commit\_sha attribute holds the SHA of the test merge commit. After merging a pull request, the merge\_commit\_sha attribute changes depending on how you merged the pull request:

If merged as a merge commit, merge\_commit\_sha represents the SHA of the merge commit.
If merged via a squash, merge\_commit\_sha represents the SHA of the squashed commit on the base branch.
If rebased, merge\_commit\_sha represents the commit that the base branch was updated to.

Pass the appropriate media type to fetch diff and patch formats.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.
application/vnd.github.diff: For more information, see "git-diff" in the Git documentation. If a diff is corrupt, contact us through the GitHub Support portal. Include the repository name and pull request ID in your message.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

### HTTP response status codes

* **200** - Pass the appropriate media type to fetch diff and patch formats.

* **304** - Not modified

* **404** - Resource not found

* **406** - Unacceptable

* **422** - Validation failed, or the endpoint has been spammed.

* **500** - Internal Error

* **503** - Service unavailable

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER
```

**Response schema (Status: 200):**

Same response schema as [Create a pull request](#create-a-pull-request).

## Update a pull request

```
PATCH /repos/{owner}/{repo}/pulls/{pull_number}
```

Draft pull requests are available in public repositories with GitHub Free and GitHub Free for organizations, GitHub Pro, and legacy per-repository billing plans, and in public and private repositories with GitHub Team and GitHub Enterprise Cloud. For more information, see GitHub's products in the GitHub Help documentation.
To open or update a pull request in a public repository, you must have write access to the head or the source branch. For organization-owned repositories, you must be a member of the organization that owns the repository to open or update a pull request.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

#### Body parameters

* **`title`** (string)
  The title of the pull request.

* **`body`** (string)
  The contents of the pull request.

* **`state`** (string)
  State of this Pull Request. Either open or closed.
  Can be one of: `open`, `closed`

* **`base`** (string)
  The name of the branch you want your changes pulled into. This should be an existing branch on the current repository. You cannot update the base branch on a pull request to point to another repository.

* **`maintainer_can_modify`** (boolean)
  Indicates whether maintainers can modify the pull request.

### HTTP response status codes

* **200** - OK

* **403** - Forbidden

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER \
  -d '{
  "title": "new title",
  "body": "updated body",
  "state": "open",
  "base": "master"
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a pull request](#create-a-pull-request).

## List commits on a pull request

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/commits
```

Lists a maximum of 250 commits for a pull request. To receive a complete
commit list for pull requests with more than 250 commits, use the List commits
endpoint.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

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
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/commits
```

**Response schema (Status: 200):**

Array of `Commit`:

* `url`: required, string, format: uri
* `sha`: required, string
* `node_id`: required, string
* `html_url`: required, string, format: uri
* `comments_url`: required, string, format: uri
* `commit`: required, object:
  * `url`: required, string, format: uri
  * `author`: required, any of:
    * **null**
    * **Git User**
      * `name`: string
      * `email`: string
      * `date`: string, format: date-time
  * `committer`: required, any of:
    * **null**
    * **Git User** (see above)
  * `message`: required, string
  * `comment_count`: required, integer
  * `tree`: required, object:
    * `sha`: required, string
    * `url`: required, string, format: uri
  * `verification`: `Verification`:
    * `verified`: required, boolean
    * `reason`: required, string
    * `payload`: required, string or null
    * `signature`: required, string or null
    * `verified_at`: required, string or null
* `author`: required, one of:
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
  * **Empty Object**
* `committer`: required, one of:
  * **Simple User** (see above)
  * **Empty Object** (see above)
* `parents`: required, array of objects:
  * `sha`: required, string
  * `url`: required, string, format: uri
  * `html_url`: string, format: uri
* `stats`: object:
  * `additions`: integer
  * `deletions`: integer
  * `total`: integer
* `files`: array of `Diff Entry`:
  * `sha`: required, string or null
  * `filename`: required, string
  * `status`: required, string, enum: `added`, `removed`, `modified`, `renamed`, `copied`, `changed`, `unchanged`
  * `additions`: required, integer
  * `deletions`: required, integer
  * `changes`: required, integer
  * `blob_url`: required, string, format: uri
  * `raw_url`: required, string, format: uri
  * `contents_url`: required, string, format: uri
  * `patch`: string
  * `previous_filename`: string

## List pull requests files

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/files
```

Lists the files in a specified pull request.
Note

Responses include a maximum of 3000 files. The paginated response returns 30 files per page by default.

This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw markdown body. Response will include body. This is the default if you do not pass any specific media type.
application/vnd.github.text+json: Returns a text only representation of the markdown body. Response will include body\_text.
application/vnd.github.html+json: Returns HTML rendered from the body's markdown. Response will include body\_html.
application/vnd.github.full+json: Returns raw, text, and HTML representations. Response will include body, body\_text, and body\_html.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

* **200** - OK

* **422** - Validation failed, or the endpoint has been spammed.

* **500** - Internal Error

* **503** - Service unavailable

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/files
```

**Response schema (Status: 200):**

Array of `Diff Entry`:

* `sha`: required, string or null
* `filename`: required, string
* `status`: required, string, enum: `added`, `removed`, `modified`, `renamed`, `copied`, `changed`, `unchanged`
* `additions`: required, integer
* `deletions`: required, integer
* `changes`: required, integer
* `blob_url`: required, string, format: uri
* `raw_url`: required, string, format: uri
* `contents_url`: required, string, format: uri
* `patch`: string
* `previous_filename`: string

## Check if a pull request has been merged

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/merge
```

Checks if a pull request has been merged into the base branch. The HTTP status of the response indicates whether or not the pull request has been merged; the response body is empty.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

### HTTP response status codes

* **204** - Response if pull request has been merged

* **404** - Not Found if pull request has not been merged

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge
```

**Response schema (Status: 204):**

## Merge a pull request

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge
```

Note

We recommend using the asynchronous merge API instead. This endpoint does not support stacked pull requests or merging with a merge queue.

Merges a pull request into the base branch.
This endpoint triggers notifications.
Creating content too quickly using this endpoint may result in secondary rate limiting.
For more information, see "Rate limits for the API" and "Best practices for using the REST API."

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

#### Body parameters

* **`commit_title`** (string)
  Title for the automatic commit message.

* **`commit_message`** (string)
  Extra detail to append to automatic commit message.

* **`sha`** (string)
  SHA that pull request head must match to allow merge.

* **`merge_method`** (string)
  The merge method to use.
  Can be one of: `merge`, `squash`, `rebase`

### HTTP response status codes

* **200** - if merge was successful

* **403** - Forbidden

* **404** - Resource not found

* **405** - Method Not Allowed if merge cannot be performed

* **409** - Conflict if sha was provided and pull request head did not match

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge \
  -d '{
  "commit_title": "Expand enum",
  "commit_message": "Add a new value to the merge_method enum"
}'
```

**Response schema (Status: 200):**

* `sha`: required, string
* `merged`: required, boolean
* `message`: required, string

## Merge a pull request asynchronously

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async
```

Merges a pull request into the base branch in the background or adds it to a merge queue. Background processing allows certain types of errors to be retried and reduces the risk of timeouts for complex merges.
This is the required API for merging stacked pull requests. For a stacked pull request, the operation includes all open downstack pull requests.
A new asynchronous merge request returns a 202 response with a UUID that can be used to fetch the result of the merge. If another asynchronous merge request is already pending for this pull request, a 409 response returns that request's UUID and merge options instead.
If the pull request is already merged or already in a merge queue, a 200 response is returned immediately. A merged result includes the merge commit OID. An enqueued result means the pull request was added to the merge queue, not that it has merged.
If the pull request cannot be merged (e.g. because it is closed, or still a draft) this result will be returned immediately with a 400 response status. Branch protection rules and repository rules are not run at this stage, only basic pull request state checks are performed.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

#### Body parameters

* **`commit_title`** (string)
  Title for the automatic commit message. Only supported for direct merges.

* **`commit_message`** (string)
  Extra detail to append to automatic commit message. Only supported for direct merges.

* **`sha`** (string)
  SHA that pull request head must match to allow merge. If not provided, the current head of the PR at the time of the request will be used; if the PR is pushed in between the merge being requested and being executed, the merge will be cancelled.

* **`merge_method`** (string)
  The merge method to use for a direct merge. Only supported for direct merges.
  Can be one of: `merge`, `squash`, `rebase`

* **`merge_action`** (string)
  The action that will be taken to merge the pull request. direct\_merge merges the pull request directly without using a merge queue; merge\_queue adds the pull request to a merge queue; default uses a merge queue if one is configured for the target branch, or merges directly otherwise. If omitted, defaults to default.
  Can be one of: `default`, `direct_merge`, `merge_queue`

* **`bypass_rules`** (boolean)
  Whether to bypass repository rules that the authenticated actor is permitted to bypass.
  Default: `false`

### HTTP response status codes

* **200** - if the pull request was already merged, or is already in a merge queue

* **202** - if the merge request was accepted and will run in the background

* **400** - if the pull request is not ready to be merged, e.g. because it is closed

* **403** - Forbidden

* **404** - Resource not found

* **409** - if there is an existing merge request already enqueued for this pull request

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Direct merge example 1: Status Code 200

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async \
  -d '{
  "commit_title": "Fix race condition",
  "commit_message": "Avoids a race by trying to read the file and handling the exception if it does not exist.",
  "sha": "6358cd125586d9def8c3e5943f23506202da81cc",
  "merge_method": "squash",
  "merge_action": "direct_merge"
}'
```

**Response schema (Status: 200):**

* `status`: required, string, enum: `pending`, `merged`, `enqueued`, `failed`
* `details`: required, any of:
  * **object**
    * `message`: required, string
    * `uuid`: required, string
    * `merge_method`: required, string, enum: `default`, `merge`, `squash`, `rebase`
    * `merge_action`: required, string, enum: `default`, `merge_queue`, `direct_merge`
    * `expected_head_sha`: required, string
    * `bypass_rules`: boolean, default: `false`
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
    * `sha`: required, string

#### Merge queue example 2: Status Code 200

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async \
  -d '{
  "sha": "6358cd125586d9def8c3e5943f23506202da81cc",
  "merge_action": "merge_queue"
}'
```

**Response schema (Status: 200):**

* `status`: required, string, enum: `pending`, `merged`, `enqueued`, `failed`
* `details`: required, any of:
  * **object**
    * `message`: required, string
    * `uuid`: required, string
    * `merge_method`: required, string, enum: `default`, `merge`, `squash`, `rebase`
    * `merge_action`: required, string, enum: `default`, `merge_queue`, `direct_merge`
    * `expected_head_sha`: required, string
    * `bypass_rules`: boolean, default: `false`
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
    * `sha`: required, string

#### Direct merge example 3: Status Code 202

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async \
  -d '{
  "commit_title": "Fix race condition",
  "commit_message": "Avoids a race by trying to read the file and handling the exception if it does not exist.",
  "sha": "6358cd125586d9def8c3e5943f23506202da81cc",
  "merge_method": "squash",
  "merge_action": "direct_merge"
}'
```

**Response schema (Status: 202):**

* `status`: required, string, enum: `pending`, `merged`, `enqueued`, `failed`
* `details`: required, any of:
  * **object**
    * `message`: required, string
    * `uuid`: required, string
    * `merge_method`: required, string, enum: `default`, `merge`, `squash`, `rebase`
    * `merge_action`: required, string, enum: `default`, `merge_queue`, `direct_merge`
    * `expected_head_sha`: required, string
    * `bypass_rules`: boolean, default: `false`
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
    * `sha`: required, string

#### Merge queue example 4: Status Code 202

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async \
  -d '{
  "sha": "6358cd125586d9def8c3e5943f23506202da81cc",
  "merge_action": "merge_queue"
}'
```

**Response schema (Status: 202):**

* `status`: required, string, enum: `pending`, `merged`, `enqueued`, `failed`
* `details`: required, any of:
  * **object**
    * `message`: required, string
    * `uuid`: required, string
    * `merge_method`: required, string, enum: `default`, `merge`, `squash`, `rebase`
    * `merge_action`: required, string, enum: `default`, `merge_queue`, `direct_merge`
    * `expected_head_sha`: required, string
    * `bypass_rules`: boolean, default: `false`
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
  * **object**
    * `message`: required, string
    * `sha`: required, string

## Get the result of an asynchronous merge

```
GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}
```

Fetches the current result of an asynchronous merge request, identified by the UUID that was returned when the merge was requested.
While the request's status is pending, the response includes the UUID, merge method, merge action, and expected head SHA of the request. Once the asynchronous request completes, its status is one of:

merged: The pull request was merged into the base branch. The response includes the merge commit OID.
enqueued: The pull request was added to a merge queue.
failed: The request failed. The response includes a message describing the failure.

An enqueued result is final for the merge queue requests and does not mean the pull request has merged. This result does not change when the merge queue later merges the pull request. To get the eventual merge status, check if a pull request has been merged.
The result of an asynchronous merge request is retained for 24 hours after its most recent update. After this window the request expires and this endpoint returns a 404 response for its UUID.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

* **`uuid`** (string) (required)
  The UUID of the asynchronous merge request, as returned when the merge was requested.

### HTTP response status codes

* **200** - the current result of the asynchronous merge request

* **403** - Forbidden

* **404** - Resource not found

### Code examples

#### Example 1: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async/UUID
```

**Response schema (Status: 200):**

Same response schema as [Merge a pull request asynchronously](#merge-a-pull-request-asynchronously).

#### Example 2: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async/UUID
```

**Response schema (Status: 200):**

Same response schema as [Merge a pull request asynchronously](#merge-a-pull-request-asynchronously).

#### Example 3: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async/UUID
```

**Response schema (Status: 200):**

Same response schema as [Merge a pull request asynchronously](#merge-a-pull-request-asynchronously).

#### Example 4: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/merge-async/UUID
```

**Response schema (Status: 200):**

Same response schema as [Merge a pull request asynchronously](#merge-a-pull-request-asynchronously).

## Update a pull request branch

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch
```

Updates the pull request branch with the latest upstream changes by merging HEAD from the base branch into the pull request branch.
Note: If making a request on behalf of a GitHub App you must also have permissions to write the contents of the head repository.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`pull_number`** (integer) (required)
  The number that identifies the pull request.

#### Body parameters

* **`expected_head_sha`** (string)
  The expected SHA of the pull request's HEAD ref. This is the most recent commit on the pull request's branch. If the expected SHA does not match the pull request's HEAD, you will receive a 422 Unprocessable Entity status. You can use the "List commits" endpoint to find the most recent commit SHA. Default: SHA of the pull request's current HEAD ref.

### HTTP response status codes

* **202** - Accepted

* **403** - Forbidden

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER/update-branch \
  -d '{
  "expected_head_sha": "6dcb09b5b57875f334f61aebed695e2e4193db5e"
}'
```

**Response schema (Status: 202):**

* `message`: string
* `url`: string