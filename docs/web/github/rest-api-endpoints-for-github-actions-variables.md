---
title: REST API endpoints for GitHub Actions variables
url: https://docs.github.com/en/rest/actions/variables
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for GitHub Actions variables

Use the REST API to interact with variables in GitHub Actions.

## About variables in GitHub Actions

You can use the REST API to create, update, delete, and retrieve information about variables that can be used in workflows in GitHub Actions. Variables allow you to store non-sensitive information, such as a username, in your repository, repository environments, or organization. For more information, see [Store information in variables](/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables) in the GitHub Actions documentation.

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List organization variables

```
GET /orgs/{org}/actions/variables
```

Lists all organization variables.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`per_page`** (integer)
  The number of results per page (max 30). For more information, see "Using pagination in the REST API."
  Default: `10`

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
  https://api.github.com/orgs/ORG/actions/variables
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `variables`: required, array of `Actions Variable for an Organization`:
  * `name`: required, string
  * `value`: required, string
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time
  * `visibility`: required, string, enum: `all`, `private`, `selected`
  * `selected_repositories_url`: string, format: uri

## Create an organization variable

```
POST /orgs/{org}/actions/variables
```

Creates an organization variable that you can reference in a GitHub Actions workflow.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
OAuth tokens and personal access tokens (classic) need theadmin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

#### Body parameters

* **`name`** (string) (required)
  The name of the variable.

* **`value`** (string) (required)
  The value of the variable.

* **`visibility`** (string) (required)
  The type of repositories in the organization that can access the variable. selected means only the repositories specified by selected\_repository\_ids can access the variable.
  Can be one of: `all`, `private`, `selected`

* **`selected_repository_ids`** (array of integers)
  An array of repository ids that can access the organization variable. You can only provide a list of repository ids when the visibility is set to selected.

### HTTP response status codes

* **201** - Response when creating a variable

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/orgs/ORG/actions/variables \
  -d '{
  "name": "USERNAME",
  "value": "octocat",
  "visibility": "selected",
  "selected_repository_ids": [
    1296269,
    1296280
  ]
}'
```

**Response schema (Status: 201):**

## Get an organization variable

```
GET /orgs/{org}/actions/variables/{name}
```

Gets a specific variable in an organization.
The authenticated user must have collaborator access to a repository to create, update, or read variables.
OAuth tokens and personal access tokens (classic) need theadmin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`name`** (string) (required)
  The name of the variable.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/orgs/ORG/actions/variables/NAME
```

**Response schema (Status: 200):**

* `name`: required, string
* `value`: required, string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `visibility`: required, string, enum: `all`, `private`, `selected`
* `selected_repositories_url`: string, format: uri

## Update an organization variable

```
PATCH /orgs/{org}/actions/variables/{name}
```

Updates an organization variable that you can reference in a GitHub Actions workflow.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`name`** (string) (required)
  The name of the variable.

#### Body parameters

* **`name`** (string)
  The name of the variable.

* **`value`** (string)
  The value of the variable.

* **`visibility`** (string)
  The type of repositories in the organization that can access the variable. selected means only the repositories specified by selected\_repository\_ids can access the variable.
  Can be one of: `all`, `private`, `selected`

* **`selected_repository_ids`** (array of integers)
  An array of repository ids that can access the organization variable. You can only provide a list of repository ids when the visibility is set to selected.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/orgs/ORG/actions/variables/NAME \
  -d '{
  "name": "USERNAME",
  "value": "octocat",
  "visibility": "selected",
  "selected_repository_ids": [
    1296269,
    1296280
  ]
}'
```

**Response schema (Status: 204):**

## Delete an organization variable

```
DELETE /orgs/{org}/actions/variables/{name}
```

Deletes an organization variable using the variable name.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
OAuth tokens and personal access tokens (classic) need theadmin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`name`** (string) (required)
  The name of the variable.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/orgs/ORG/actions/variables/NAME
```

**Response schema (Status: 204):**

## List selected repositories for an organization variable

```
GET /orgs/{org}/actions/variables/{name}/repositories
```

Lists all repositories that can access an organization variable
that is available to selected repositories.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`name`** (string) (required)
  The name of the variable.

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

### HTTP response status codes

* **200** - OK

* **409** - Response when the visibility of the variable is not set to selected

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/orgs/ORG/actions/variables/NAME/repositories
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `repositories`: required, array of `Minimal Repository`:
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

## Set selected repositories for an organization variable

```
PUT /orgs/{org}/actions/variables/{name}/repositories
```

Replaces all repositories for an organization variable that is available
to selected repositories. Organization variables that are available to selected
repositories have their visibility field set to selected.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`name`** (string) (required)
  The name of the variable.

#### Body parameters

* **`selected_repository_ids`** (array of integers) (required)
  The IDs of the repositories that can access the organization variable.

### HTTP response status codes

* **204** - No Content

* **409** - Response when the visibility of the variable is not set to selected

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/orgs/ORG/actions/variables/NAME/repositories \
  -d '{
  "selected_repository_ids": [
    64780797
  ]
}'
```

**Response schema (Status: 204):**

## Add selected repository to an organization variable

```
PUT /orgs/{org}/actions/variables/{name}/repositories/{repository_id}
```

Adds a repository to an organization variable that is available to selected repositories.
Organization variables that are available to selected repositories have their visibility field set to selected.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`name`** (string) (required)
  The name of the variable.

* **`repository_id`** (integer) (required)

### HTTP response status codes

* **204** - No Content

* **409** - Response when the visibility of the variable is not set to selected

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/orgs/ORG/actions/variables/NAME/repositories/REPOSITORY_ID
```

**Response schema (Status: 204):**

## Remove selected repository from an organization variable

```
DELETE /orgs/{org}/actions/variables/{name}/repositories/{repository_id}
```

Removes a repository from an organization variable that is
available to selected repositories. Organization variables that are available to
selected repositories have their visibility field set to selected.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`name`** (string) (required)
  The name of the variable.

* **`repository_id`** (integer) (required)

### HTTP response status codes

* **204** - No Content

* **409** - Response when the visibility of the variable is not set to selected

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/orgs/ORG/actions/variables/NAME/repositories/REPOSITORY_ID
```

**Response schema (Status: 204):**

## List repository organization variables

```
GET /repos/{owner}/{repo}/actions/organization-variables
```

Lists all organization variables shared with a repository.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`per_page`** (integer)
  The number of results per page (max 30). For more information, see "Using pagination in the REST API."
  Default: `10`

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
  https://api.github.com/repos/OWNER/REPO/actions/organization-variables
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `variables`: required, array of `Actions Variable`:
  * `name`: required, string
  * `value`: required, string
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time

## List repository variables

```
GET /repos/{owner}/{repo}/actions/variables
```

Lists all repository variables.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`per_page`** (integer)
  The number of results per page (max 30). For more information, see "Using pagination in the REST API."
  Default: `10`

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
  https://api.github.com/repos/OWNER/REPO/actions/variables
```

**Response schema (Status: 200):**

Same response schema as [List repository organization variables](#list-repository-organization-variables).

## Create a repository variable

```
POST /repos/{owner}/{repo}/actions/variables
```

Creates a repository variable that you can reference in a GitHub Actions workflow.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

#### Body parameters

* **`name`** (string) (required)
  The name of the variable.

* **`value`** (string) (required)
  The value of the variable.

### HTTP response status codes

* **201** - Created

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/actions/variables \
  -d '{
  "name": "USERNAME",
  "value": "octocat"
}'
```

**Response schema (Status: 201):**

## Get a repository variable

```
GET /repos/{owner}/{repo}/actions/variables/{name}
```

Gets a specific variable in a repository.
The authenticated user must have collaborator access to the repository to use this endpoint.
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

* **`name`** (string) (required)
  The name of the variable.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/variables/NAME
```

**Response schema (Status: 200):**

* `name`: required, string
* `value`: required, string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time

## Update a repository variable

```
PATCH /repos/{owner}/{repo}/actions/variables/{name}
```

Updates a repository variable that you can reference in a GitHub Actions workflow.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`name`** (string) (required)
  The name of the variable.

#### Body parameters

* **`name`** (string)
  The name of the variable.

* **`value`** (string)
  The value of the variable.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/actions/variables/NAME \
  -d '{
  "name": "USERNAME",
  "value": "octocat"
}'
```

**Response schema (Status: 204):**

## Delete a repository variable

```
DELETE /repos/{owner}/{repo}/actions/variables/{name}
```

Deletes a repository variable using the variable name.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`name`** (string) (required)
  The name of the variable.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/actions/variables/NAME
```

**Response schema (Status: 204):**

## List environment variables

```
GET /repos/{owner}/{repo}/environments/{environment_name}/variables
```

Lists all environment variables.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`environment_name`** (string) (required)
  The name of the environment. The name must be URL encoded. For example, any slashes in the name must be replaced with %2F.

* **`per_page`** (integer)
  The number of results per page (max 30). For more information, see "Using pagination in the REST API."
  Default: `10`

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
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/variables
```

**Response schema (Status: 200):**

Same response schema as [List repository organization variables](#list-repository-organization-variables).

## Create an environment variable

```
POST /repos/{owner}/{repo}/environments/{environment_name}/variables
```

Create an environment variable that you can reference in a GitHub Actions workflow.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`environment_name`** (string) (required)
  The name of the environment. The name must be URL encoded. For example, any slashes in the name must be replaced with %2F.

#### Body parameters

* **`name`** (string) (required)
  The name of the variable.

* **`value`** (string) (required)
  The value of the variable.

### HTTP response status codes

* **201** - Created

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/variables \
  -d '{
  "name": "USERNAME",
  "value": "octocat"
}'
```

**Response schema (Status: 201):**

## Get an environment variable

```
GET /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}
```

Gets a specific variable in an environment.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`environment_name`** (string) (required)
  The name of the environment. The name must be URL encoded. For example, any slashes in the name must be replaced with %2F.

* **`name`** (string) (required)
  The name of the variable.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/variables/NAME
```

**Response schema (Status: 200):**

Same response schema as [Get a repository variable](#get-a-repository-variable).

## Update an environment variable

```
PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}
```

Updates an environment variable that you can reference in a GitHub Actions workflow.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`name`** (string) (required)
  The name of the variable.

* **`environment_name`** (string) (required)
  The name of the environment. The name must be URL encoded. For example, any slashes in the name must be replaced with %2F.

#### Body parameters

* **`name`** (string)
  The name of the variable.

* **`value`** (string)
  The value of the variable.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/variables/NAME \
  -d '{
  "name": "USERNAME",
  "value": "octocat"
}'
```

**Response schema (Status: 204):**

## Delete an environment variable

```
DELETE /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}
```

Deletes an environment variable using the variable name.
Authenticated users must have collaborator access to a repository to create, update, or read variables.
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

* **`name`** (string) (required)
  The name of the variable.

* **`environment_name`** (string) (required)
  The name of the environment. The name must be URL encoded. For example, any slashes in the name must be replaced with %2F.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/variables/NAME
```

**Response schema (Status: 204):**