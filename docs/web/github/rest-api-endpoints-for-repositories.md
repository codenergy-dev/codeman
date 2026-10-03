---
title: REST API endpoints for repositories
url: https://docs.github.com/en/rest/repos/repos
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for repositories

Use the REST API to manage repositories on GitHub.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List organization repositories

```
GET /orgs/{org}/repos
```

Lists repositories for the specified organization.
Note

In order to see the security_and_analysis block for a repository you must have admin permissions for the repository or be an owner or security manager for the organization that owns the repository. For more information, see "Managing security managers in your organization."

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`org`** (string) (required)
  The organization name. The name is not case sensitive.

- **`type`** (string)
  Specifies the types of repositories you want returned.
  Default: `all`
  Can be one of: `all`, `public`, `private`, `forks`, `sources`, `member`

- **`sort`** (string)
  The property to sort the results by.
  Default: `created`
  Can be one of: `created`, `updated`, `pushed`, `full_name`

- **`direction`** (string)
  The order to sort by. Default: asc when using full_name, otherwise desc.
  Can be one of: `asc`, `desc`

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
  https://api.github.com/orgs/ORG/repos
```

**Response schema (Status: 200):**

Array of `Minimal Repository`:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `name`: required, string
  * `full_name`: required, string
  * `owner`: required, `Simple User`:
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

## Create an organization repository

```
POST /orgs/{org}/repos
```

Creates a new repository in the specified organization. The authenticated user must be a member of the organization.
OAuth app tokens and personal access tokens (classic) need the public_repo or repo scope to create a public repository, and repo scope to create a private repository.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`org`** (string) (required)
  The organization name. The name is not case sensitive.

#### Body parameters

- **`name`** (string) (required)
  The name of the repository.

- **`description`** (string)
  A short description of the repository.

- **`homepage`** (string)
  A URL with more information about the repository.

- **`private`** (boolean)
  Whether the repository is private.
  Default: `false`

- **`visibility`** (string)
  The visibility of the repository.
  Can be one of: `public`, `private`

- **`has_issues`** (boolean)
  Either true to enable issues for this repository or false to disable them.
  Default: `true`

- **`has_projects`** (boolean)
  Either true to enable projects for this repository or false to disable them. Note: If you're creating a repository in an organization that has disabled repository projects, the default is false, and if you pass true, the API returns an error.
  Default: `true`

- **`has_wiki`** (boolean)
  Either true to enable the wiki for this repository or false to disable it.
  Default: `true`

- **`has_downloads`** (boolean)
  Whether downloads are enabled.
  Default: `true`

- **`is_template`** (boolean)
  Either true to make this repo available as a template repository or false to prevent it.
  Default: `false`

- **`team_id`** (integer)
  The id of the team that will be granted access to this repository. This is only valid when creating a repository in an organization.

- **`auto_init`** (boolean)
  Pass true to create an initial commit with empty README.
  Default: `false`

- **`gitignore_template`** (string)
  Desired language or platform .gitignore template to apply. Use the name of the template without the extension. For example, "Haskell".

- **`license_template`** (string)
  Choose an open source license template that best suits your needs, and then use the license keyword as the license_template string. For example, "mit" or "mpl-2.0".

- **`allow_squash_merge`** (boolean)
  Either true to allow squash-merging pull requests, or false to prevent squash-merging.
  Default: `true`

- **`allow_merge_commit`** (boolean)
  Either true to allow merging pull requests with a merge commit, or false to prevent merging pull requests with merge commits.
  Default: `true`

- **`allow_rebase_merge`** (boolean)
  Either true to allow rebase-merging pull requests, or false to prevent rebase-merging.
  Default: `true`

- **`allow_auto_merge`** (boolean)
  Either true to allow auto-merge on pull requests, or false to disallow auto-merge.
  Default: `false`

- **`delete_branch_on_merge`** (boolean)
  Either true to allow automatically deleting head branches when pull requests are merged, or false to prevent automatic deletion. The authenticated user must be an organization owner to set this property to true.
  Default: `false`

- **`use_squash_pr_title_as_default`** (boolean)
  Either true to allow squash-merge commits to use pull request title, or false to use commit message. **This property is closing down. Please use squash_merge_commit_title instead.
  Default: `false`

- **`squash_merge_commit_title`** (string)
  Required when using squash_merge_commit_message.
The default value for a squash merge commit title:

PR_TITLE - default to the pull request's title.
COMMIT_OR_PR_TITLE - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
  Can be one of: `PR_TITLE`, `COMMIT_OR_PR_TITLE`

- **`squash_merge_commit_message`** (string)
  The default value for a squash merge commit message:

PR_BODY - default to the pull request's body.
COMMIT_MESSAGES - default to the branch's commit messages.
BLANK - default to a blank commit message.
  Can be one of: `PR_BODY`, `COMMIT_MESSAGES`, `BLANK`

- **`merge_commit_title`** (string)
  Required when using merge_commit_message.
The default value for a merge commit title.

PR_TITLE - default to the pull request's title.
MERGE_MESSAGE - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
  Can be one of: `PR_TITLE`, `MERGE_MESSAGE`

- **`merge_commit_message`** (string)
  The default value for a merge commit message.

PR_TITLE - default to the pull request's title.
PR_BODY - default to the pull request's body.
BLANK - default to a blank commit message.
  Can be one of: `PR_BODY`, `PR_TITLE`, `BLANK`

- **`custom_properties`** (object)
  The custom properties for the new repository. The keys are the custom property names, and the values are the corresponding custom property values.

### HTTP response status codes

- **201** - Created

- **403** - Forbidden

- **422** - Validation failed, or the endpoint has been spammed.

- **451** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/orgs/ORG/repos \
  -d '{
  "name": "Hello-World",
  "description": "This is your first repository",
  "homepage": "https://github.com",
  "private": false,
  "has_issues": true,
  "has_projects": true,
  "has_wiki": true
}'
```

**Response schema (Status: 201):**

* `id`: required, integer, format: int64
* `node_id`: required, string
* `name`: required, string
* `full_name`: required, string
* `owner`: required, `Simple User`:
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
* `is_template`: boolean
* `topics`: array of string
* `has_issues`: required, boolean
* `has_projects`: required, boolean
* `has_wiki`: required, boolean
* `has_pages`: required, boolean
* `has_discussions`: required, boolean
* `has_pull_requests`: boolean
* `pull_request_creation_policy`: string, enum: `all`, `collaborators_only`
* `archived`: required, boolean
* `disabled`: required, boolean
* `visibility`: string
* `pushed_at`: required, string, format: date-time
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `permissions`: object:
  * `admin`: required, boolean
  * `maintain`: boolean
  * `push`: required, boolean
  * `triage`: boolean
  * `pull`: required, boolean
* `allow_rebase_merge`: boolean
* `template_repository`: any of:
  * **null**
  * **Repository**
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
* `temp_clone_token`: string or null
* `allow_squash_merge`: boolean
* `allow_auto_merge`: boolean
* `delete_branch_on_merge`: boolean
* `allow_merge_commit`: boolean
* `allow_update_branch`: boolean
* `squash_merge_commit_title`: string, enum: `PR_TITLE`, `COMMIT_OR_PR_TITLE`
* `squash_merge_commit_message`: string, enum: `PR_BODY`, `COMMIT_MESSAGES`, `BLANK`
* `merge_commit_title`: string, enum: `PR_TITLE`, `MERGE_MESSAGE`
* `merge_commit_message`: string, enum: `PR_BODY`, `PR_TITLE`, `BLANK`
* `allow_forking`: boolean
* `web_commit_signoff_required`: boolean
* `subscribers_count`: required, integer
* `network_count`: required, integer
* `license`: required, any of:
  * **null**
  * **License Simple** (see above)
* `organization`: any of:
  * **null**
  * **Simple User** (see above)
* `parent`: `Repository` (see above)
* `source`: `Repository` (see above)
* `forks`: required, integer
* `master_branch`: string
* `open_issues`: required, integer
* `watchers`: required, integer
* `anonymous_access_enabled`: boolean, default: `true`
* `code_of_conduct`: `Code Of Conduct Simple`:
  * `url`: required, string, format: uri
  * `key`: required, string
  * `name`: required, string
  * `html_url`: required, string or null, format: uri
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

## Get a repository

```
GET /repos/{owner}/{repo}
```

The parent and source objects are present when the repository is a fork. parent is the repository this repository was forked from, source is the ultimate source for the network.
Note

In order to see the security_and_analysis block for a repository you must have admin permissions for the repository or be an owner or security manager for the organization that owns the repository. For more information, see "Managing security managers in your organization."
To view merge-related settings, you must have the contents:read and contents:write permissions.

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

- **301** - Moved permanently

- **403** - Forbidden

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO
```

**Response schema (Status: 200):**

Same response schema as [Create an organization repository](#create-an-organization-repository).

## Update a repository

```
PATCH /repos/{owner}/{repo}
```

Note: To edit a repository's topics, use the Replace all repository topics endpoint.

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

- **`name`** (string)
  The name of the repository.

- **`description`** (string)
  A short description of the repository.

- **`homepage`** (string)
  A URL with more information about the repository.

- **`private`** (boolean)
  Either true to make the repository private or false to make it public. Default: false.
Note: You will get a 422 error if the organization restricts changing repository visibility to organization owners and a non-owner tries to change the value of private.
  Default: `false`

- **`visibility`** (string)
  The visibility of the repository.
  Can be one of: `public`, `private`

- **`security_and_analysis`** (object or null)
  Specify which security and analysis features to enable or disable for the repository.
To use this parameter, you must have admin permissions for the repository or be an owner or security manager for the organization that owns the repository. For more information, see "Managing security managers in your organization."
For example, to enable GitHub Advanced Security, use this data in the body of the PATCH request:
{ "security_and_analysis": {"advanced_security": { "status": "enabled" } } }.
You can check which security and analysis features are currently enabled by using a GET /repos/{owner}/{repo} request.
  - **`advanced_security`** (object)
    Use the status property to enable or disable GitHub Advanced Security for this repository.
For more information, see "About GitHub Advanced
Security."
For standalone Code Scanning or Secret Protection products, this parameter cannot be used.
    - **`status`** (string)
      Can be enabled or disabled.
  - **`code_security`** (object)
    Use the status property to enable or disable GitHub Code Security for this repository.
    - **`status`** (string)
      Can be enabled or disabled.
  - **`secret_scanning`** (object)
    Use the status property to enable or disable secret scanning for this repository. For more information, see "About secret scanning."
    - **`status`** (string)
      Can be enabled or disabled.
  - **`secret_scanning_push_protection`** (object)
    Use the status property to enable or disable secret scanning push protection for this repository. For more information, see "Protecting pushes with secret scanning."
    - **`status`** (string)
      Can be enabled or disabled.
  - **`secret_scanning_ai_detection`** (object)
    Use the status property to enable or disable secret scanning AI detection for this repository. For more information, see "Responsible detection of generic secrets with AI."
    - **`status`** (string)
      Can be enabled or disabled.
  - **`secret_scanning_non_provider_patterns`** (object)
    Use the status property to enable or disable secret scanning non-provider patterns for this repository. For more information, see "Supported secret scanning patterns."
    - **`status`** (string)
      Can be enabled or disabled.
  - **`secret_scanning_delegated_alert_dismissal`** (object)
    Use the status property to enable or disable secret scanning delegated alert dismissal for this repository.
    - **`status`** (string)
      Can be enabled or disabled.
  - **`secret_scanning_delegated_bypass`** (object)
    Use the status property to enable or disable secret scanning delegated bypass for this repository.
    - **`status`** (string)
      Can be enabled or disabled.
  - **`secret_scanning_delegated_bypass_options`** (object)
    Feature options for secret scanning delegated bypass.
This object is only honored when security_and_analysis.secret_scanning_delegated_bypass.status is set to enabled.
You can send this object in the same request as secret_scanning_delegated_bypass, or update just the options in a separate request.
    - **`reviewers`** (array of objects)
      The bypass reviewers for secret scanning delegated bypass.
If you omit this field, the existing set of reviewers is unchanged.
      - **`reviewer_id`** (integer) (required)
        The ID of the team or role selected as a bypass reviewer
      - **`reviewer_type`** (string) (required)
        The type of the bypass reviewer
        Can be one of: `TEAM`, `ROLE`
      - **`mode`** (string)
        The bypass mode for the reviewer
        Default: `ALWAYS`
        Can be one of: `ALWAYS`, `EXEMPT`

- **`has_issues`** (boolean)
  Either true to enable issues for this repository or false to disable them.
  Default: `true`

- **`has_projects`** (boolean)
  Either true to enable projects for this repository or false to disable them. Note: If you're creating a repository in an organization that has disabled repository projects, the default is false, and if you pass true, the API returns an error.
  Default: `true`

- **`has_wiki`** (boolean)
  Either true to enable the wiki for this repository or false to disable it.
  Default: `true`

- **`has_pull_requests`** (boolean)
  Either true to allow pull requests for this repository or false to prevent pull requests.
  Default: `true`

- **`pull_request_creation_policy`** (string)
  The policy that controls who can create pull requests for this repository: all or collaborators_only.
  Can be one of: `all`, `collaborators_only`

- **`is_template`** (boolean)
  Either true to make this repo available as a template repository or false to prevent it.
  Default: `false`

- **`default_branch`** (string)
  Updates the default branch for this repository.

- **`allow_squash_merge`** (boolean)
  Either true to allow squash-merging pull requests, or false to prevent squash-merging.
  Default: `true`

- **`allow_merge_commit`** (boolean)
  Either true to allow merging pull requests with a merge commit, or false to prevent merging pull requests with merge commits.
  Default: `true`

- **`allow_rebase_merge`** (boolean)
  Either true to allow rebase-merging pull requests, or false to prevent rebase-merging.
  Default: `true`

- **`allow_auto_merge`** (boolean)
  Either true to allow auto-merge on pull requests, or false to disallow auto-merge.
  Default: `false`

- **`delete_branch_on_merge`** (boolean)
  Either true to allow automatically deleting head branches when pull requests are merged, or false to prevent automatic deletion.
  Default: `false`

- **`allow_update_branch`** (boolean)
  Either true to always allow a pull request head branch that is behind its base branch to be updated even if it is not required to be up to date before merging, or false otherwise.
  Default: `false`

- **`use_squash_pr_title_as_default`** (boolean)
  Either true to allow squash-merge commits to use pull request title, or false to use commit message. **This property is closing down. Please use squash_merge_commit_title instead.
  Default: `false`

- **`squash_merge_commit_title`** (string)
  Required when using squash_merge_commit_message.
The default value for a squash merge commit title:

PR_TITLE - default to the pull request's title.
COMMIT_OR_PR_TITLE - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
  Can be one of: `PR_TITLE`, `COMMIT_OR_PR_TITLE`

- **`squash_merge_commit_message`** (string)
  The default value for a squash merge commit message:

PR_BODY - default to the pull request's body.
COMMIT_MESSAGES - default to the branch's commit messages.
BLANK - default to a blank commit message.
  Can be one of: `PR_BODY`, `COMMIT_MESSAGES`, `BLANK`

- **`merge_commit_title`** (string)
  Required when using merge_commit_message.
The default value for a merge commit title.

PR_TITLE - default to the pull request's title.
MERGE_MESSAGE - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
  Can be one of: `PR_TITLE`, `MERGE_MESSAGE`

- **`merge_commit_message`** (string)
  The default value for a merge commit message.

PR_TITLE - default to the pull request's title.
PR_BODY - default to the pull request's body.
BLANK - default to a blank commit message.
  Can be one of: `PR_BODY`, `PR_TITLE`, `BLANK`

- **`archived`** (boolean)
  Whether to archive this repository. false will unarchive a previously archived repository.
  Default: `false`

- **`allow_forking`** (boolean)
  Either true to allow private forks, or false to prevent private forks.
  Default: `false`

- **`web_commit_signoff_required`** (boolean)
  Either true to require contributors to sign off on web-based commits, or false to not require contributors to sign off on web-based commits.
  Default: `false`

### HTTP response status codes

- **200** - OK

- **307** - Temporary Redirect

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO \
  -d '{
  "name": "Hello-World",
  "description": "This is your first repository",
  "homepage": "https://github.com",
  "private": true,
  "has_issues": true,
  "has_projects": true,
  "has_wiki": true
}'
```

**Response schema (Status: 200):**

Same response schema as [Create an organization repository](#create-an-organization-repository).

## Delete a repository

```
DELETE /repos/{owner}/{repo}
```

Deleting a repository requires admin access.
If an organization owner has configured the organization to prevent members from deleting organization-owned
repositories, you will get a 403 Forbidden response.
OAuth app tokens and personal access tokens (classic) need the delete_repo scope to use this endpoint.

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

- **204** - No Content

- **307** - Temporary Redirect

- **403** - If an organization owner has configured the organization to prevent members from deleting organization-owned repositories, a member will get this response:

- **404** - Resource not found

- **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO
```

**Response schema (Status: 204):**

## List repository activities

```
GET /repos/{owner}/{repo}/activity
```

Lists a detailed history of changes to a repository, such as pushes, merges, force pushes, and branch changes, and associates these changes with commits and users.
For more information about viewing repository activity,
see "Viewing activity and data for your repository."

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`before`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results before this cursor. For more information, see "Using pagination in the REST API."

- **`after`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results after this cursor. For more information, see "Using pagination in the REST API."

- **`ref`** (string)
  The Git reference for the activities you want to list.
The ref for a branch can be formatted either as refs/heads/BRANCH_NAME or BRANCH_NAME, where BRANCH_NAME is the name of your branch.

- **`actor`** (string)
  The GitHub username to use to filter by the actor who performed the activity.

- **`time_period`** (string)
  The time period to filter by.
For example, day will filter for activity that occurred in the past 24 hours, and week will filter for activity that occurred in the past 7 days (168 hours).
  Can be one of: `day`, `week`, `month`, `quarter`, `year`

- **`activity_type`** (string)
  The activity type to filter by.
For example, you can choose to filter by "force_push", to see all force pushes to the repository.
  Can be one of: `push`, `force_push`, `branch_creation`, `branch_deletion`, `pr_merge`, `merge_queue_merge`

### HTTP response status codes

- **200** - OK

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/activity
```

**Response schema (Status: 200):**

Array of `Activity`:
  * `id`: required, integer
  * `node_id`: required, string
  * `before`: required, string
  * `after`: required, string
  * `ref`: required, string
  * `timestamp`: required, string, format: date-time
  * `activity_type`: required, string, enum: `push`, `force_push`, `branch_deletion`, `branch_creation`, `pr_merge`, `merge_queue_merge`
  * `actor`: required, any of:
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

## Check if Dependabot security updates are enabled for a repository

```
GET /repos/{owner}/{repo}/automated-security-fixes
```

Shows whether Dependabot security updates are enabled, disabled or paused for a repository. The authenticated user must have admin read access to the repository. For more information, see "Configuring Dependabot security updates".

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

- **200** - Response if Dependabot is enabled

- **404** - Not Found if Dependabot is not enabled for the repository

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/automated-security-fixes
```

**Response schema (Status: 200):**

* `enabled`: required, boolean
* `paused`: required, boolean

## Enable Dependabot security updates

```
PUT /repos/{owner}/{repo}/automated-security-fixes
```

Enables Dependabot security updates for a repository. The authenticated user must have admin access to the repository. For more information, see "Configuring Dependabot security updates".

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

- **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/automated-security-fixes
```

**Response schema (Status: 204):**

## Disable Dependabot security updates

```
DELETE /repos/{owner}/{repo}/automated-security-fixes
```

Disables Dependabot security updates for a repository. The authenticated user must have admin access to the repository. For more information, see "Configuring Dependabot security updates".

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

- **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/automated-security-fixes
```

**Response schema (Status: 204):**

## List CODEOWNERS errors

```
GET /repos/{owner}/{repo}/codeowners/errors
```

List any syntax errors that are detected in the CODEOWNERS
file.
For more information about the correct CODEOWNERS syntax,
see "About code owners."

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ref`** (string)
  A branch, tag or commit name used to determine which version of the CODEOWNERS file to use. Default: the repository's default branch (e.g. main)

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/codeowners/errors
```

**Response schema (Status: 200):**

* `errors`: required, array of objects:
  * `line`: required, integer
  * `column`: required, integer
  * `source`: string
  * `kind`: required, string
  * `suggestion`: string or null
  * `message`: required, string
  * `path`: required, string

## List repository contributors

```
GET /repos/{owner}/{repo}/contributors
```

Lists contributors to the specified repository and sorts them by the number of commits per contributor in descending order. This endpoint may return information that is a few hours old because the GitHub REST API caches contributor data to improve performance.
GitHub identifies contributors by author email address. This endpoint groups contribution counts by GitHub user, which includes all associated email addresses. To improve performance, only the first 500 author email addresses in the repository link to GitHub users. The rest will appear as anonymous contributors without associated GitHub user information.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`anon`** (string)
  Set to 1 or true to include anonymous contributors in results.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - If repository contains content

- **204** - Response if repository is empty

- **403** - Forbidden

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/contributors
```

**Response schema (Status: 200):**

Array of `Contributor`:
  * `login`: string
  * `id`: integer
  * `node_id`: string
  * `avatar_url`: string, format: uri
  * `gravatar_id`: string or null
  * `url`: string, format: uri
  * `html_url`: string, format: uri
  * `followers_url`: string, format: uri
  * `following_url`: string
  * `gists_url`: string
  * `starred_url`: string
  * `subscriptions_url`: string, format: uri
  * `organizations_url`: string, format: uri
  * `repos_url`: string, format: uri
  * `events_url`: string
  * `received_events_url`: string, format: uri
  * `type`: required, string
  * `site_admin`: boolean
  * `contributions`: required, integer
  * `email`: string
  * `name`: string
  * `user_view_type`: string

## Create a repository dispatch event

```
POST /repos/{owner}/{repo}/dispatches
```

You can use this endpoint to trigger a webhook event called repository_dispatch when you want activity that happens outside of GitHub to trigger a GitHub Actions workflow or GitHub App webhook. You must configure your GitHub Actions workflow or GitHub App to run when the repository_dispatch event occurs. For an example repository_dispatch webhook payload, see "RepositoryDispatchEvent."
The client_payload parameter is available for any extra information that your workflow might need. This parameter is a JSON payload that will be passed on when the webhook event is dispatched. For example, the client_payload can include a message that a user would like to send using a GitHub Actions workflow. Or the client_payload can be used as a test to debug your workflow.
This input example shows how you can use the client_payload as a test to debug your workflow.
OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint.

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

- **`event_type`** (string) (required)
  A custom webhook event name. Must be 100 characters or fewer.

- **`client_payload`** (object)
  JSON payload with extra information about the webhook event that your action or workflow may use. The maximum number of top-level properties is 10. The total size of the JSON payload must be less than 64KB.

### HTTP response status codes

- **204** - No Content

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{
  "event_type": "on-demand-test",
  "client_payload": {
    "unit": false,
    "integration": true
  }
}'
```

**Response schema (Status: 204):**

## Get the hash algorithm for a repository

```
GET /repos/{owner}/{repo}/hash-algorithm
```

Returns the hash algorithm used to store repository objects.

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

- **403** - Forbidden

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/hash-algorithm
```

**Response schema (Status: 200):**

* `hash_algorithm`: required, string, enum: `sha1`, `sha256`

## Check if immutable releases are enabled for a repository

```
GET /repos/{owner}/{repo}/immutable-releases
```

Shows whether immutable releases are enabled or disabled. Also identifies whether immutability is being
enforced by the repository owner.  The authenticated user must have admin read access to the repository.

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

- **200** - Response if immutable releases are enabled

- **404** - Not Found if immutable releases are not enabled for the repository

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/immutable-releases
```

**Response schema (Status: 200):**

* `enabled`: required, boolean
* `enforced_by_owner`: required, boolean

## Enable immutable releases

```
PUT /repos/{owner}/{repo}/immutable-releases
```

Enables immutable releases for a repository. The authenticated user must have admin access to the repository.

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

- **204** - A header with no content is returned.

- **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/immutable-releases
```

**Response schema (Status: 204):**

## Disable immutable releases

```
DELETE /repos/{owner}/{repo}/immutable-releases
```

Disables immutable releases for a repository. The authenticated user must have admin access to the repository.

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

- **204** - A header with no content is returned.

- **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/immutable-releases
```

**Response schema (Status: 204):**

## List repository languages

```
GET /repos/{owner}/{repo}/languages
```

Lists languages for the specified repository. The value shown for each language is the number of bytes of code written in that language.

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

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/languages
```

**Response schema (Status: 200):**

object, additional properties: integer

## Check if private vulnerability reporting is enabled for a repository

```
GET /repos/{owner}/{repo}/private-vulnerability-reporting
```

Returns a boolean indicating whether or not private vulnerability reporting is enabled for the repository. For more information, see "Evaluating the security settings of a repository".

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

- **200** - Private vulnerability reporting status

- **422** - Bad Request

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/private-vulnerability-reporting
```

**Response schema (Status: 200):**

* `enabled`: required, boolean

## Enable private vulnerability reporting for a repository

```
PUT /repos/{owner}/{repo}/private-vulnerability-reporting
```

Enables private vulnerability reporting for a repository. The authenticated user must have admin access to the repository. For more information, see "Privately reporting a security vulnerability."

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

- **204** - A header with no content is returned.

- **422** - Bad Request

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/private-vulnerability-reporting
```

**Response schema (Status: 204):**

## Disable private vulnerability reporting for a repository

```
DELETE /repos/{owner}/{repo}/private-vulnerability-reporting
```

Disables private vulnerability reporting for a repository. The authenticated user must have admin access to the repository. For more information, see "Privately reporting a security vulnerability".

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

- **204** - A header with no content is returned.

- **422** - Bad Request

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/private-vulnerability-reporting
```

**Response schema (Status: 204):**

## List repository tags

```
GET /repos/{owner}/{repo}/tags
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
  https://api.github.com/repos/OWNER/REPO/tags
```

**Response schema (Status: 200):**

Array of `Tag`:
  * `name`: required, string
  * `commit`: required, object:
    * `sha`: required, string
    * `url`: required, string, format: uri
  * `zipball_url`: required, string, format: uri
  * `tarball_url`: required, string, format: uri
  * `node_id`: required, string

## List repository teams

```
GET /repos/{owner}/{repo}/teams
```

Lists the teams that have access to the specified repository and that are also visible to the authenticated user.
For a public repository, a team is listed only if that team added the public repository explicitly.
OAuth app tokens and personal access tokens (classic) need the public_repo or repo scope to use this endpoint with a public repository, and repo scope to use this endpoint with a private repository.

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
  https://api.github.com/repos/OWNER/REPO/teams
```

**Response schema (Status: 200):**

Array of `Team`:
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

## Get all repository topics

```
GET /repos/{owner}/{repo}/topics
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

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/topics
```

**Response schema (Status: 200):**

* `names`: required, array of string

## Replace all repository topics

```
PUT /repos/{owner}/{repo}/topics
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

#### Body parameters

- **`names`** (array of strings) (required)
  An array of topics to add to the repository. Pass one or more topics to replace the set of existing topics. Send an empty array ([]) to clear all topics from the repository. Note: Topic names will be saved as lowercase.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/topics \
  -d '{
  "names": [
    "octocat",
    "atom",
    "electron",
    "api"
  ]
}'
```

**Response schema (Status: 200):**

Same response schema as [Get all repository topics](#get-all-repository-topics).

## Transfer a repository

```
POST /repos/{owner}/{repo}/transfer
```

A transfer request will need to be accepted by the new owner when transferring a personal repository to another user. The response will contain the original owner, and the transfer will continue asynchronously. For more details on the requirements to transfer personal and organization-owned repositories, see about repository transfers.

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

- **`new_owner`** (string) (required)
  The username or organization name the repository will be transferred to.

- **`new_name`** (string)
  The new name to be given to the repository.

- **`team_ids`** (array of integers)
  ID of the team or teams to add to the repository. Teams can only be added to organization-owned repositories.

### HTTP response status codes

- **202** - Accepted

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/transfer \
  -d '{
  "new_owner": "github",
  "team_ids": [
    12,
    345
  ],
  "new_name": "octorepo"
}'
```

**Response schema (Status: 202):**

* `id`: required, integer, format: int64
* `node_id`: required, string
* `name`: required, string
* `full_name`: required, string
* `owner`: required, `Simple User`:
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

## Check if vulnerability alerts are enabled for a repository

```
GET /repos/{owner}/{repo}/vulnerability-alerts
```

Shows whether dependency alerts are enabled or disabled for a repository. The authenticated user must have admin read access to the repository. For more information, see "About security alerts for vulnerable dependencies".

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

- **204** - Response if repository is enabled with vulnerability alerts

- **404** - Not Found if repository is not enabled with vulnerability alerts

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/vulnerability-alerts
```

**Response schema (Status: 204):**

## Enable vulnerability alerts

```
PUT /repos/{owner}/{repo}/vulnerability-alerts
```

Enables dependency alerts and the dependency graph for a repository. The authenticated user must have admin access to the repository. For more information, see "About security alerts for vulnerable dependencies".

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

- **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/vulnerability-alerts
```

**Response schema (Status: 204):**

## Disable vulnerability alerts

```
DELETE /repos/{owner}/{repo}/vulnerability-alerts
```

Disables dependency alerts and the dependency graph for a repository.
The authenticated user must have admin access to the repository. For more information,
see "About security alerts for vulnerable dependencies".

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

- **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/vulnerability-alerts
```

**Response schema (Status: 204):**

## Create a repository using a template

```
POST /repos/{template_owner}/{template_repo}/generate
```

Creates a new repository using a repository template. Use the template_owner and template_repo route parameters to specify the repository to use as the template. If the repository is not public, the authenticated user must own or be a member of an organization that owns the repository. To check if a repository is available to use as a template, get the repository's information using the Get a repository endpoint and check that the is_template key is true.
OAuth app tokens and personal access tokens (classic) need the public_repo or repo scope to create a public repository, and repo scope to create a private repository.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`template_owner`** (string) (required)
  The account owner of the template repository. The name is not case sensitive.

- **`template_repo`** (string) (required)
  The name of the template repository without the .git extension. The name is not case sensitive.

#### Body parameters

- **`owner`** (string)
  The organization or person who will own the new repository. To create a new repository in an organization, the authenticated user must be a member of the specified organization.

- **`name`** (string) (required)
  The name of the new repository.

- **`description`** (string)
  A short description of the new repository.

- **`include_all_branches`** (boolean)
  Set to true to include the directory structure and files from all branches in the template repository, and not just the default branch. Default: false.
  Default: `false`

- **`private`** (boolean)
  Either true to create a new private repository or false to create a new public one.
  Default: `false`

### HTTP response status codes

- **201** - Created

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/TEMPLATE_OWNER/TEMPLATE_REPO/generate \
  -d '{
  "owner": "octocat",
  "name": "Hello-World",
  "description": "This is your first repository",
  "include_all_branches": false,
  "private": false
}'
```

**Response schema (Status: 201):**

Same response schema as [Create an organization repository](#create-an-organization-repository).

## List public repositories

```
GET /repositories
```

Lists all public repositories in the order that they were created.
Note:

For GitHub Enterprise Server, this endpoint will only list repositories available to all users on the enterprise.
Pagination is powered exclusively by the since parameter. Use the Link header to get the URL for the next page of repositories.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`since`** (integer)
  A repository ID. Only return repositories with an ID greater than this ID.

### HTTP response status codes

- **200** - OK

- **304** - Not modified

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repositories
```

**Response schema (Status: 200):**

Same response schema as [List organization repositories](#list-organization-repositories).

## List repositories for the authenticated user

```
GET /user/repos
```

Lists repositories that the authenticated user has explicit permission (:read, :write, or :admin) to access.
The authenticated user has explicit permission to access repositories they own, repositories where they are a collaborator, and repositories that they can access through an organization membership.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`visibility`** (string)
  Limit results to repositories with the specified visibility.
  Default: `all`
  Can be one of: `all`, `public`, `private`

- **`affiliation`** (string)
  Comma-separated list of values. Can include:

owner: Repositories that are owned by the authenticated user.
collaborator: Repositories that the user has been added to as a collaborator.
organization_member: Repositories that the user has access to through being a member of an organization. This includes every repository on every team that the user is on.
  Default: `owner,collaborator,organization_member`

- **`type`** (string)
  Limit results to repositories of the specified type. Will cause a 422 error if used in the same request as visibility or affiliation.
  Default: `all`
  Can be one of: `all`, `owner`, `public`, `private`, `member`

- **`sort`** (string)
  The property to sort the results by.
  Default: `full_name`
  Can be one of: `created`, `updated`, `pushed`, `full_name`

- **`direction`** (string)
  The order to sort by. Default: asc when using full_name, otherwise desc.
  Can be one of: `asc`, `desc`

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

- **`since`** (string)
  Only show repositories updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

- **`before`** (string)
  Only show repositories updated before the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

### HTTP response status codes

- **200** - OK

- **304** - Not modified

- **401** - Requires authentication

- **403** - Forbidden

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/user/repos
```

**Response schema (Status: 200):**

Array of `Repository`:
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
  * `owner`: required, `Simple User`:
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

## Create a repository for the authenticated user

```
POST /user/repos
```

Creates a new repository for the authenticated user.
OAuth app tokens and personal access tokens (classic) need the public_repo or repo scope to create a public repository, and repo scope to create a private repository.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Body parameters

- **`name`** (string) (required)
  The name of the repository.

- **`description`** (string)
  A short description of the repository.

- **`homepage`** (string)
  A URL with more information about the repository.

- **`private`** (boolean)
  Whether the repository is private.
  Default: `false`

- **`has_issues`** (boolean)
  Whether issues are enabled.
  Default: `true`

- **`has_projects`** (boolean)
  Whether projects are enabled.
  Default: `true`

- **`has_wiki`** (boolean)
  Whether the wiki is enabled.
  Default: `true`

- **`has_discussions`** (boolean)
  Whether discussions are enabled.
  Default: `false`

- **`team_id`** (integer)
  The id of the team that will be granted access to this repository. This is only valid when creating a repository in an organization.

- **`auto_init`** (boolean)
  Whether the repository is initialized with a minimal README.
  Default: `false`

- **`gitignore_template`** (string)
  The desired language or platform to apply to the .gitignore.

- **`license_template`** (string)
  The license keyword of the open source license for this repository.

- **`allow_squash_merge`** (boolean)
  Whether to allow squash merges for pull requests.
  Default: `true`

- **`allow_merge_commit`** (boolean)
  Whether to allow merge commits for pull requests.
  Default: `true`

- **`allow_rebase_merge`** (boolean)
  Whether to allow rebase merges for pull requests.
  Default: `true`

- **`allow_auto_merge`** (boolean)
  Whether to allow Auto-merge to be used on pull requests.
  Default: `false`

- **`delete_branch_on_merge`** (boolean)
  Whether to delete head branches when pull requests are merged
  Default: `false`

- **`squash_merge_commit_title`** (string)
  Required when using squash_merge_commit_message.
The default value for a squash merge commit title:

PR_TITLE - default to the pull request's title.
COMMIT_OR_PR_TITLE - default to the commit's title (if only one commit) or the pull request's title (when more than one commit).
  Can be one of: `PR_TITLE`, `COMMIT_OR_PR_TITLE`

- **`squash_merge_commit_message`** (string)
  The default value for a squash merge commit message:

PR_BODY - default to the pull request's body.
COMMIT_MESSAGES - default to the branch's commit messages.
BLANK - default to a blank commit message.
  Can be one of: `PR_BODY`, `COMMIT_MESSAGES`, `BLANK`

- **`merge_commit_title`** (string)
  Required when using merge_commit_message.
The default value for a merge commit title.

PR_TITLE - default to the pull request's title.
MERGE_MESSAGE - default to the classic title for a merge message (e.g., Merge pull request #123 from branch-name).
  Can be one of: `PR_TITLE`, `MERGE_MESSAGE`

- **`merge_commit_message`** (string)
  The default value for a merge commit message.

PR_TITLE - default to the pull request's title.
PR_BODY - default to the pull request's body.
BLANK - default to a blank commit message.
  Can be one of: `PR_BODY`, `PR_TITLE`, `BLANK`

- **`has_downloads`** (boolean)
  Whether downloads are enabled.
  Default: `true`

- **`is_template`** (boolean)
  Whether this repository acts as a template that can be used to generate new repositories.
  Default: `false`

### HTTP response status codes

- **201** - Created

- **304** - Not modified

- **400** - Bad Request

- **401** - Requires authentication

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

- **451** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/user/repos \
  -d '{
  "name": "Hello-World",
  "description": "This is your first repo!",
  "homepage": "https://github.com",
  "private": false,
  "is_template": true
}'
```

**Response schema (Status: 201):**

Same response schema as [Create an organization repository](#create-an-organization-repository).

## List repositories for a user

```
GET /users/{username}/repos
```

Lists public repositories for the specified user.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`username`** (string) (required)
  The handle for the GitHub user account.

- **`type`** (string)
  Limit results to repositories of the specified type.
  Default: `owner`
  Can be one of: `all`, `owner`, `member`

- **`sort`** (string)
  The property to sort the results by.
  Default: `full_name`
  Can be one of: `created`, `updated`, `pushed`, `full_name`

- **`direction`** (string)
  The order to sort by. Default: asc when using full_name, otherwise desc.
  Can be one of: `asc`, `desc`

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
  https://api.github.com/users/USERNAME/repos
```

**Response schema (Status: 200):**

Same response schema as [List organization repositories](#list-organization-repositories).