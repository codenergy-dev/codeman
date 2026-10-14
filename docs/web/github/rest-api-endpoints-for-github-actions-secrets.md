---
title: REST API endpoints for GitHub Actions Secrets
url: https://docs.github.com/en/rest/actions/secrets
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for GitHub Actions Secrets

Use the REST API to interact with secrets in GitHub Actions.

## About secrets in GitHub Actions

You can use the REST API to create, update, delete, and retrieve information about secrets that can be used in workflows in GitHub Actions. Secrets allow you to store sensitive information, such as access tokens, in your repository, repository environments, or organization. For more information, see [Secrets](/en/actions/concepts/security/secrets).

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List organization secrets

```
GET /orgs/{org}/actions/secrets
```

Lists all secrets available in an organization without revealing their
encrypted values.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

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
  https://api.github.com/orgs/ORG/actions/secrets
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `secrets`: required, array of `Actions Secret for an Organization`:
  * `name`: required, string
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time
  * `visibility`: required, string, enum: `all`, `private`, `selected`
  * `selected_repositories_url`: string, format: uri

## Get an organization public key

```
GET /orgs/{org}/actions/secrets/public-key
```

Gets your public key, which you need to encrypt secrets. You need to
encrypt a secret before you can create or update secrets.
The authenticated user must have collaborator access to a repository to create, update, or read secrets.
OAuth tokens and personal access tokens (classic) need theadmin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/orgs/ORG/actions/secrets/public-key
```

**Response schema (Status: 200):**

* `key_id`: required, string
* `key`: required, string
* `id`: integer
* `url`: string
* `title`: string
* `created_at`: string

## Get an organization secret

```
GET /orgs/{org}/actions/secrets/{secret_name}
```

Gets a single organization secret without revealing its encrypted value.
The authenticated user must have collaborator access to a repository to create, update, or read secrets
OAuth tokens and personal access tokens (classic) need theadmin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`secret_name`** (string) (required)
  The name of the secret.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME
```

**Response schema (Status: 200):**

* `name`: required, string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `visibility`: required, string, enum: `all`, `private`, `selected`
* `selected_repositories_url`: string, format: uri

## Create or update an organization secret

```
PUT /orgs/{org}/actions/secrets/{secret_name}
```

Creates or updates an organization secret with an encrypted value. Encrypt your secret using
LibSodium. For more information, see "Encrypting secrets for the REST API."
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth tokens and personal access tokens (classic) need theadmin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`secret_name`** (string) (required)
  The name of the secret.

#### Body parameters

* **`encrypted_value`** (string) (required)
  Value for your secret, encrypted with LibSodium using the public key retrieved from the Get an organization public key endpoint.

* **`key_id`** (string) (required)
  ID of the key you used to encrypt the secret.

* **`visibility`** (string) (required)
  Which type of organization repositories have access to the organization secret. selected means only the repositories specified by selected\_repository\_ids can access the secret.
  Can be one of: `all`, `private`, `selected`

* **`selected_repository_ids`** (array of integers)
  An array of repository ids that can access the organization secret. You can only provide a list of repository ids when the visibility is set to selected. You can manage the list of selected repositories using the List selected repositories for an organization secret, Set selected repositories for an organization secret, and Remove selected repository from an organization secret endpoints.

### HTTP response status codes

* **201** - Response when creating a secret

* **204** - Response when updating a secret

### Code examples

#### Example 1: Status Code 201

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME \
  -d '{
  "encrypted_value": "c2VjcmV0",
  "key_id": "012345678912345678",
  "visibility": "selected",
  "selected_repository_ids": [
    1296269,
    1296280
  ]
}'
```

**Response schema (Status: 201):**

#### Example 2: Status Code 204

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME \
  -d '{
  "encrypted_value": "c2VjcmV0",
  "key_id": "012345678912345678",
  "visibility": "selected",
  "selected_repository_ids": [
    1296269,
    1296280
  ]
}'
```

**Response schema (Status: 204):**

## Delete an organization secret

```
DELETE /orgs/{org}/actions/secrets/{secret_name}
```

Deletes a secret in an organization using the secret name.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth tokens and personal access tokens (classic) need theadmin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`secret_name`** (string) (required)
  The name of the secret.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME
```

**Response schema (Status: 204):**

## List selected repositories for an organization secret

```
GET /orgs/{org}/actions/secrets/{secret_name}/repositories
```

Lists all repositories that have been selected when the visibility
for repository access to a secret is set to selected.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`secret_name`** (string) (required)
  The name of the secret.

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME/repositories
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

## Set selected repositories for an organization secret

```
PUT /orgs/{org}/actions/secrets/{secret_name}/repositories
```

Replaces all repositories for an organization secret when the visibility
for repository access is set to selected. The visibility is set when you Create
or update an organization secret.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`secret_name`** (string) (required)
  The name of the secret.

#### Body parameters

* **`selected_repository_ids`** (array of integers) (required)
  An array of repository ids that can access the organization secret. You can only provide a list of repository ids when the visibility is set to selected. You can add and remove individual repositories using the Add selected repository to an organization secret and Remove selected repository from an organization secret endpoints.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME/repositories \
  -d '{
  "selected_repository_ids": [
    64780797
  ]
}'
```

**Response schema (Status: 204):**

## Add selected repository to an organization secret

```
PUT /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}
```

Adds a repository to an organization secret when the visibility for
repository access is set to selected. For more information about setting the visibility, see Create or
update an organization secret.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, OAuth tokens and personal access tokens (classic) need the repo scope to use this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`secret_name`** (string) (required)
  The name of the secret.

* **`repository_id`** (integer) (required)

### HTTP response status codes

* **204** - No Content when repository was added to the selected list

* **409** - Conflict when visibility type is not set to selected

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME/repositories/REPOSITORY_ID
```

**Response schema (Status: 204):**

## Remove selected repository from an organization secret

```
DELETE /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}
```

Removes a repository from an organization secret when the visibility
for repository access is set to selected. The visibility is set when you Create
or update an organization secret.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
OAuth app tokens and personal access tokens (classic) need the admin:org scope to use this endpoint. If the repository is private, the repo scope is also required.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`org`** (string) (required)
  The organization name. The name is not case sensitive.

* **`secret_name`** (string) (required)
  The name of the secret.

* **`repository_id`** (integer) (required)

### HTTP response status codes

* **204** - Response when repository was removed from the selected list

* **409** - Conflict when visibility type not set to selected

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/orgs/ORG/actions/secrets/SECRET_NAME/repositories/REPOSITORY_ID
```

**Response schema (Status: 204):**

## List repository organization secrets

```
GET /repos/{owner}/{repo}/actions/organization-secrets
```

Lists all organization secrets shared with a repository without revealing their encrypted
values.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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
  https://api.github.com/repos/OWNER/REPO/actions/organization-secrets
```

**Response schema (Status: 200):**

* `total_count`: required, integer
* `secrets`: required, array of `Actions Secret`:
  * `name`: required, string
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time

## List repository secrets

```
GET /repos/{owner}/{repo}/actions/secrets
```

Lists all secrets available in a repository without revealing their encrypted
values.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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
  https://api.github.com/repos/OWNER/REPO/actions/secrets
```

**Response schema (Status: 200):**

Same response schema as [List repository organization secrets](#list-repository-organization-secrets).

## Get a repository public key

```
GET /repos/{owner}/{repo}/actions/secrets/public-key
```

Gets your public key, which you need to encrypt secrets. You need to
encrypt a secret before you can create or update secrets.
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

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/secrets/public-key
```

**Response schema (Status: 200):**

Same response schema as [Get an organization public key](#get-an-organization-public-key).

## Get a repository secret

```
GET /repos/{owner}/{repo}/actions/secrets/{secret_name}
```

Gets a single repository secret without revealing its encrypted value.
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

* **`secret_name`** (string) (required)
  The name of the secret.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/actions/secrets/SECRET_NAME
```

**Response schema (Status: 200):**

* `name`: required, string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time

## Create or update a repository secret

```
PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}
```

Creates or updates a repository secret with an encrypted value. Encrypt your secret using
LibSodium. For more information, see "Encrypting secrets for the REST API."
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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

* **`secret_name`** (string) (required)
  The name of the secret.

#### Body parameters

* **`encrypted_value`** (string) (required)
  Value for your secret, encrypted with LibSodium using the public key retrieved from the Get a repository public key endpoint.

* **`key_id`** (string) (required)
  ID of the key you used to encrypt the secret.

### HTTP response status codes

* **201** - Response when creating a secret

* **204** - Response when updating a secret

### Code examples

#### Example 1: Status Code 201

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/actions/secrets/SECRET_NAME \
  -d '{
  "encrypted_value": "c2VjcmV0",
  "key_id": "012345678912345678"
}'
```

**Response schema (Status: 201):**

#### Example 2: Status Code 204

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/actions/secrets/SECRET_NAME \
  -d '{
  "encrypted_value": "c2VjcmV0",
  "key_id": "012345678912345678"
}'
```

**Response schema (Status: 204):**

## Delete a repository secret

```
DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}
```

Deletes a secret in a repository using the secret name.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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

* **`secret_name`** (string) (required)
  The name of the secret.

### HTTP response status codes

* **204** - No Content

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/actions/secrets/SECRET_NAME
```

**Response schema (Status: 204):**

## List environment secrets

```
GET /repos/{owner}/{repo}/environments/{environment_name}/secrets
```

Lists all secrets available in an environment without revealing their
encrypted values.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/secrets
```

**Response schema (Status: 200):**

Same response schema as [List repository organization secrets](#list-repository-organization-secrets).

## Get an environment public key

```
GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/public-key
```

Get the public key for an environment, which you need to encrypt environment
secrets. You need to encrypt a secret before you can create or update secrets.
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

* **`environment_name`** (string) (required)
  The name of the environment. The name must be URL encoded. For example, any slashes in the name must be replaced with %2F.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/secrets/public-key
```

**Response schema (Status: 200):**

Same response schema as [Get an organization public key](#get-an-organization-public-key).

## Get an environment secret

```
GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}
```

Gets a single environment secret without revealing its encrypted value.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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

* **`secret_name`** (string) (required)
  The name of the secret.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/secrets/SECRET_NAME
```

**Response schema (Status: 200):**

Same response schema as [Get a repository secret](#get-a-repository-secret).

## Create or update an environment secret

```
PUT /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}
```

Creates or updates an environment secret with an encrypted value. Encrypt your secret using
LibSodium. For more information, see "Encrypting secrets for the REST API."
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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

* **`secret_name`** (string) (required)
  The name of the secret.

#### Body parameters

* **`encrypted_value`** (string) (required)
  Value for your secret, encrypted with LibSodium using the public key retrieved from the Get an environment public key endpoint.

* **`key_id`** (string) (required)
  ID of the key you used to encrypt the secret.

### HTTP response status codes

* **201** - Response when creating a secret

* **204** - Response when updating a secret

### Code examples

#### Example 1: Status Code 201

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/secrets/SECRET_NAME \
  -d '{
  "encrypted_value": "c2VjcmV0",
  "key_id": "012345678912345678"
}'
```

**Response schema (Status: 201):**

#### Example 2: Status Code 204

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/secrets/SECRET_NAME \
  -d '{
  "encrypted_value": "c2VjcmV0",
  "key_id": "012345678912345678"
}'
```

**Response schema (Status: 204):**

## Delete an environment secret

```
DELETE /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}
```

Deletes a secret in an environment using the secret name.
Authenticated users must have collaborator access to a repository to create, update, or read secrets.
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

* **`secret_name`** (string) (required)
  The name of the secret.

### HTTP response status codes

* **204** - Default response

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/environments/ENVIRONMENT_NAME/secrets/SECRET_NAME
```

**Response schema (Status: 204):**