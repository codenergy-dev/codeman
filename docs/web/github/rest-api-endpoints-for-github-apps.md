---
title: REST API endpoints for GitHub Apps
url: https://docs.github.com/en/rest/apps/apps
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for GitHub Apps

Use the REST API to interact with GitHub Apps

## About GitHub Apps

If you are using your app with GitHub Actions and want to modify workflow files, you must authenticate on behalf of the user with an OAuth token that includes the `workflow` scope. The user must have admin or write permission to the repository that contains the workflow file. For more information, see [Scopes for OAuth apps](/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes).

This page lists endpoints that you can access while authenticated as a GitHub App. For more information, see [Authenticating as a GitHub App](/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app).

See [REST API endpoints for GitHub App installations](/en/rest/apps/installations) for a list of endpoints that require authentication as a GitHub App installation.

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Get the authenticated app

```
GET /app
```

Returns the GitHub App associated with the authentication credentials used. To see how many app installations are associated with this GitHub App, see the installations\_count in the response. For more details about your app's installations, see the "List installations for the authenticated app" endpoint.
You must use a JWT to access this endpoint.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/app
```

**Response schema (Status: 200):**

* `id`: required, integer
* `slug`: string
* `node_id`: required, string
* `client_id`: string
* `owner`: required, one of:
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

## Create a GitHub App from a manifest

```
POST /app-manifests/{code}/conversions
```

Use this endpoint to complete the handshake necessary when implementing the GitHub App Manifest flow. When you create a GitHub App with the manifest flow, you receive a temporary code used to retrieve the GitHub App's id, pem (private key), and webhook\_secret.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`code`** (string) (required)

### HTTP response status codes

* **201** - Created

* **404** - Resource not found

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/app-manifests/CODE/conversions
```

**Response schema (Status: 201):**

* all of:
  * **GitHub app**
    * `id`: required, integer
    * `slug`: string
    * `node_id`: required, string
    * `client_id`: string
    * `owner`: required, one of:
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
  * **object, additional properties allowed**
    * `client_id`: required, string
    * `client_secret`: required, string
    * `webhook_secret`: required, string or null
    * `pem`: required, string

## List installation requests for the authenticated app

```
GET /app/installation-requests
```

Lists all the pending installation requests for the authenticated GitHub App.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

* **200** - List of integration installation requests

* **304** - Not modified

* **401** - Requires authentication

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/app/installation-requests
```

**Response schema (Status: 200):**

Array of `Integration Installation Request`:

* `id`: required, integer
* `node_id`: string
* `account`: required, any of:
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
* `requester`: required, `Simple User` (see above)
* `created_at`: required, string, format: date-time

## List installations for the authenticated app

```
GET /app/installations
```

The permissions the installation has are included under the permissions key.
You must use a JWT to access this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

* **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

* **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

* **`outdated`** (string)

### HTTP response status codes

* **200** - The permissions the installation has are included under the permissions key.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/app/installations
```

**Response schema (Status: 200):**

Array of `Installation`:

* `id`: required, integer
* `account`: required, any of:
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
* `repository_selection`: required, string, enum: `all`, `selected`
* `access_tokens_url`: required, string, format: uri
* `repositories_url`: required, string, format: uri
* `html_url`: required, string, format: uri
* `app_id`: required, integer
* `client_id`: string
* `target_id`: required, integer
* `target_type`: required, string
* `permissions`: required, `App Permissions`:
  * `actions`: string, enum: `read`, `write`
  * `administration`: string, enum: `read`, `write`
  * `artifact_metadata`: string, enum: `read`, `write`
  * `attestations`: string, enum: `read`, `write`
  * `checks`: string, enum: `read`, `write`
  * `code_quality`: string, enum: `read`, `write`
  * `codespaces`: string, enum: `read`, `write`
  * `contents`: string, enum: `read`, `write`
  * `dependabot_secrets`: string, enum: `read`, `write`
  * `deployments`: string, enum: `read`, `write`
  * `discussions`: string, enum: `read`, `write`
  * `environments`: string, enum: `read`, `write`
  * `issues`: string, enum: `read`, `write`
  * `merge_queues`: string, enum: `read`, `write`
  * `metadata`: string, enum: `read`, `write`
  * `packages`: string, enum: `read`, `write`
  * `pages`: string, enum: `read`, `write`
  * `pull_requests`: string, enum: `read`, `write`
  * `repository_custom_properties`: string, enum: `read`, `write`
  * `repository_hooks`: string, enum: `read`, `write`
  * `repository_projects`: string, enum: `read`, `write`, `admin`
  * `secret_scanning_alerts`: string, enum: `read`, `write`
  * `secrets`: string, enum: `read`, `write`
  * `security_events`: string, enum: `read`, `write`
  * `single_file`: string, enum: `read`, `write`
  * `statuses`: string, enum: `read`, `write`
  * `vulnerability_alerts`: string, enum: `read`, `write`
  * `workflows`: string, enum: `write`
  * `custom_properties_for_organizations`: string, enum: `read`, `write`
  * `members`: string, enum: `read`, `write`
  * `organization_administration`: string, enum: `read`, `write`
  * `organization_custom_roles`: string, enum: `read`, `write`
  * `organization_custom_org_roles`: string, enum: `read`, `write`
  * `organization_custom_properties`: string, enum: `read`, `write`, `admin`
  * `organization_copilot_seat_management`: string, enum: `read`, `write`
  * `organization_copilot_agent_settings`: string, enum: `read`, `write`
  * `organization_external_properties_for_repos`: string, enum: `read`, `write`, `admin`
  * `organization_announcement_banners`: string, enum: `read`, `write`
  * `organization_events`: string, enum: `read`
  * `organization_hooks`: string, enum: `read`, `write`
  * `organization_personal_access_tokens`: string, enum: `read`, `write`
  * `organization_personal_access_token_requests`: string, enum: `read`, `write`
  * `organization_plan`: string, enum: `read`
  * `organization_projects`: string, enum: `read`, `write`, `admin`
  * `organization_packages`: string, enum: `read`, `write`
  * `organization_secrets`: string, enum: `read`, `write`
  * `organization_self_hosted_runners`: string, enum: `read`, `write`
  * `organization_user_blocking`: string, enum: `read`, `write`
  * `email_addresses`: string, enum: `read`, `write`
  * `followers`: string, enum: `read`, `write`
  * `git_ssh_keys`: string, enum: `read`, `write`
  * `gpg_keys`: string, enum: `read`, `write`
  * `interaction_limits`: string, enum: `read`, `write`
  * `profile`: string, enum: `write`
  * `starring`: string, enum: `read`, `write`
  * `enterprise_custom_properties_for_organizations`: string, enum: `read`, `write`, `admin`
* `events`: required, array of string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `single_file_name`: required, string or null
* `has_multiple_single_files`: boolean
* `single_file_paths`: array of string
* `app_slug`: required, string
* `suspended_by`: required, any of:
  * **null**
  * **Simple User** (see above)
* `suspended_at`: required, string or null, format: date-time
* `contact_email`: string or null

## Get an installation for the authenticated app

```
GET /app/installations/{installation_id}
```

Enables an authenticated GitHub App to find an installation's information using the installation id.
You must use a JWT to access this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`installation_id`** (integer) (required)
  The unique identifier of the installation.

### HTTP response status codes

* **200** - OK

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/app/installations/1
```

**Response schema (Status: 200):**

* `id`: required, integer
* `account`: required, any of:
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
* `repository_selection`: required, string, enum: `all`, `selected`
* `access_tokens_url`: required, string, format: uri
* `repositories_url`: required, string, format: uri
* `html_url`: required, string, format: uri
* `app_id`: required, integer
* `client_id`: string
* `target_id`: required, integer
* `target_type`: required, string
* `permissions`: required, `App Permissions`:
  * `actions`: string, enum: `read`, `write`
  * `administration`: string, enum: `read`, `write`
  * `artifact_metadata`: string, enum: `read`, `write`
  * `attestations`: string, enum: `read`, `write`
  * `checks`: string, enum: `read`, `write`
  * `code_quality`: string, enum: `read`, `write`
  * `codespaces`: string, enum: `read`, `write`
  * `contents`: string, enum: `read`, `write`
  * `dependabot_secrets`: string, enum: `read`, `write`
  * `deployments`: string, enum: `read`, `write`
  * `discussions`: string, enum: `read`, `write`
  * `environments`: string, enum: `read`, `write`
  * `issues`: string, enum: `read`, `write`
  * `merge_queues`: string, enum: `read`, `write`
  * `metadata`: string, enum: `read`, `write`
  * `packages`: string, enum: `read`, `write`
  * `pages`: string, enum: `read`, `write`
  * `pull_requests`: string, enum: `read`, `write`
  * `repository_custom_properties`: string, enum: `read`, `write`
  * `repository_hooks`: string, enum: `read`, `write`
  * `repository_projects`: string, enum: `read`, `write`, `admin`
  * `secret_scanning_alerts`: string, enum: `read`, `write`
  * `secrets`: string, enum: `read`, `write`
  * `security_events`: string, enum: `read`, `write`
  * `single_file`: string, enum: `read`, `write`
  * `statuses`: string, enum: `read`, `write`
  * `vulnerability_alerts`: string, enum: `read`, `write`
  * `workflows`: string, enum: `write`
  * `custom_properties_for_organizations`: string, enum: `read`, `write`
  * `members`: string, enum: `read`, `write`
  * `organization_administration`: string, enum: `read`, `write`
  * `organization_custom_roles`: string, enum: `read`, `write`
  * `organization_custom_org_roles`: string, enum: `read`, `write`
  * `organization_custom_properties`: string, enum: `read`, `write`, `admin`
  * `organization_copilot_seat_management`: string, enum: `read`, `write`
  * `organization_copilot_agent_settings`: string, enum: `read`, `write`
  * `organization_external_properties_for_repos`: string, enum: `read`, `write`, `admin`
  * `organization_announcement_banners`: string, enum: `read`, `write`
  * `organization_events`: string, enum: `read`
  * `organization_hooks`: string, enum: `read`, `write`
  * `organization_personal_access_tokens`: string, enum: `read`, `write`
  * `organization_personal_access_token_requests`: string, enum: `read`, `write`
  * `organization_plan`: string, enum: `read`
  * `organization_projects`: string, enum: `read`, `write`, `admin`
  * `organization_packages`: string, enum: `read`, `write`
  * `organization_secrets`: string, enum: `read`, `write`
  * `organization_self_hosted_runners`: string, enum: `read`, `write`
  * `organization_user_blocking`: string, enum: `read`, `write`
  * `email_addresses`: string, enum: `read`, `write`
  * `followers`: string, enum: `read`, `write`
  * `git_ssh_keys`: string, enum: `read`, `write`
  * `gpg_keys`: string, enum: `read`, `write`
  * `interaction_limits`: string, enum: `read`, `write`
  * `profile`: string, enum: `write`
  * `starring`: string, enum: `read`, `write`
  * `enterprise_custom_properties_for_organizations`: string, enum: `read`, `write`, `admin`
* `events`: required, array of string
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `single_file_name`: required, string or null
* `has_multiple_single_files`: boolean
* `single_file_paths`: array of string
* `app_slug`: required, string
* `suspended_by`: required, any of:
  * **null**
  * **Simple User** (see above)
* `suspended_at`: required, string or null, format: date-time
* `contact_email`: string or null

## Delete an installation for the authenticated app

```
DELETE /app/installations/{installation_id}
```

Uninstalls a GitHub App on a user, organization, or enterprise account. If you prefer to temporarily suspend an app's access to your account's resources, then we recommend the "Suspend an app installation" endpoint.
You must use a JWT to access this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`installation_id`** (integer) (required)
  The unique identifier of the installation.

### HTTP response status codes

* **202** - Accepted

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/app/installations/1
```

**Response schema (Status: 202):**

## Create an installation access token for an app

```
POST /app/installations/{installation_id}/access_tokens
```

Creates an installation access token that enables a GitHub App to make authenticated API requests for the app's installation on an organization or individual account. Installation tokens expire one hour from the time you create them. Using an expired token produces a status code of 401 - Unauthorized, and requires creating a new installation token. By default the installation token has access to all repositories that the installation can access.
Note

Starting April 27, 2026, GitHub began a staged rollout of a stateless format (ghs\_APPID\_JWT) to all newly minted GitHub App installation tokens, making them more performant and improving the reliability of our API surface. If your application expects or relies on installation tokens being exactly 40 characters long, it may not handle this new token format correctly. You can now validate your apps and workflows using a temporary request header that lets you enable the token format on demand. For more information about the temporary header, see the GitHub blog.

Optionally, you can use the repositories or repository\_ids body parameters to specify individual repositories that the installation access token can access. If you don't use repositories or repository\_ids to grant access to specific repositories, the installation access token will have access to all repositories that the installation was granted access to. The installation access token cannot be granted access to repositories that the installation was not granted access to. Up to 500 repositories can be listed in this manner.
Optionally, use the permissions body parameter to specify the permissions that the installation access token should have. If permissions is not specified, the installation access token will have all of the permissions that were granted to the app. The installation access token cannot be granted permissions that the app was not granted.
You must use a JWT to access this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`installation_id`** (integer) (required)
  The unique identifier of the installation.

#### Body parameters

* **`repositories`** (array of strings)
  List of repository names that the token should have access to

* **`repository_ids`** (array of integers)
  List of repository IDs that the token should have access to

* **`permissions`** (object)
  The permissions granted to the fine-grained access token.
  * **`actions`** (string)
    The level of permission to grant the access token for GitHub Actions workflows, workflow runs, and artifacts.
    Can be one of: `read`, `write`
  * **`administration`** (string)
    The level of permission to grant the access token for repository creation, deletion, settings, teams, and collaborators creation.
    Can be one of: `read`, `write`
  * **`artifact_metadata`** (string)
    The level of permission to grant the access token to create and retrieve build artifact metadata records.
    Can be one of: `read`, `write`
  * **`attestations`** (string)
    The level of permission to create and retrieve the access token for repository attestations.
    Can be one of: `read`, `write`
  * **`checks`** (string)
    The level of permission to grant the access token for checks on code.
    Can be one of: `read`, `write`
  * **`code_quality`** (string)
    The level of permission to grant the access token to view and manage code quality data.
    Can be one of: `read`, `write`
  * **`codespaces`** (string)
    The level of permission to grant the access token to create, edit, delete, and list Codespaces.
    Can be one of: `read`, `write`
  * **`contents`** (string)
    The level of permission to grant the access token for repository contents, commits, branches, downloads, releases, and merges.
    Can be one of: `read`, `write`
  * **`dependabot_secrets`** (string)
    The level of permission to grant the access token to manage Dependabot secrets.
    Can be one of: `read`, `write`
  * **`deployments`** (string)
    The level of permission to grant the access token for deployments and deployment statuses.
    Can be one of: `read`, `write`
  * **`discussions`** (string)
    The level of permission to grant the access token for discussions and related comments and labels.
    Can be one of: `read`, `write`
  * **`environments`** (string)
    The level of permission to grant the access token for managing repository environments.
    Can be one of: `read`, `write`
  * **`issues`** (string)
    The level of permission to grant the access token for issues and related comments, assignees, labels, and milestones.
    Can be one of: `read`, `write`
  * **`merge_queues`** (string)
    The level of permission to grant the access token to manage the merge queues for a repository.
    Can be one of: `read`, `write`
  * **`metadata`** (string)
    The level of permission to grant the access token to search repositories, list collaborators, and access repository metadata.
    Can be one of: `read`, `write`
  * **`packages`** (string)
    The level of permission to grant the access token for packages published to GitHub Packages.
    Can be one of: `read`, `write`
  * **`pages`** (string)
    The level of permission to grant the access token to retrieve Pages statuses, configuration, and builds, as well as create new builds.
    Can be one of: `read`, `write`
  * **`pull_requests`** (string)
    The level of permission to grant the access token for pull requests and related comments, assignees, labels, milestones, and merges.
    Can be one of: `read`, `write`
  * **`repository_custom_properties`** (string)
    The level of permission to grant the access token to view and edit custom properties for a repository, when allowed by the property.
    Can be one of: `read`, `write`
  * **`repository_hooks`** (string)
    The level of permission to grant the access token to manage the post-receive hooks for a repository.
    Can be one of: `read`, `write`
  * **`repository_projects`** (string)
    The level of permission to grant the access token to manage repository projects, columns, and cards.
    Can be one of: `read`, `write`, `admin`
  * **`secret_scanning_alerts`** (string)
    The level of permission to grant the access token to view and manage secret scanning alerts.
    Can be one of: `read`, `write`
  * **`secrets`** (string)
    The level of permission to grant the access token to manage repository secrets.
    Can be one of: `read`, `write`
  * **`security_events`** (string)
    The level of permission to grant the access token to view and manage security events like code scanning alerts.
    Can be one of: `read`, `write`
  * **`single_file`** (string)
    The level of permission to grant the access token to manage just a single file.
    Can be one of: `read`, `write`
  * **`statuses`** (string)
    The level of permission to grant the access token for commit statuses.
    Can be one of: `read`, `write`
  * **`vulnerability_alerts`** (string)
    The level of permission to grant the access token to manage Dependabot alerts.
    Can be one of: `read`, `write`
  * **`workflows`** (string)
    The level of permission to grant the access token to update GitHub Actions workflow files.
    Can be one of: `write`
  * **`custom_properties_for_organizations`** (string)
    The level of permission to grant the access token to view and edit custom properties for an organization, when allowed by the property.
    Can be one of: `read`, `write`
  * **`members`** (string)
    The level of permission to grant the access token for organization teams and members.
    Can be one of: `read`, `write`
  * **`organization_administration`** (string)
    The level of permission to grant the access token to manage access to an organization.
    Can be one of: `read`, `write`
  * **`organization_custom_roles`** (string)
    The level of permission to grant the access token for custom repository roles management.
    Can be one of: `read`, `write`
  * **`organization_custom_org_roles`** (string)
    The level of permission to grant the access token for custom organization roles management.
    Can be one of: `read`, `write`
  * **`organization_custom_properties`** (string)
    The level of permission to grant the access token for repository custom properties management at the organization level.
    Can be one of: `read`, `write`, `admin`
  * **`organization_copilot_seat_management`** (string)
    The level of permission to grant the access token for managing access to GitHub Copilot for members of an organization with a Copilot Business subscription. This property is in public preview and is subject to change.
    Can be one of: `read`, `write`
  * **`organization_copilot_agent_settings`** (string)
    The level of permission to grant the access token to view and manage Copilot cloud agent settings for an organization.
    Can be one of: `read`, `write`
  * **`organization_external_properties_for_repos`** (string)
    The level of permission to grant the access token for managing external custom properties for repositories in an organization.
    Can be one of: `read`, `write`, `admin`
  * **`organization_announcement_banners`** (string)
    The level of permission to grant the access token to view and manage announcement banners for an organization.
    Can be one of: `read`, `write`
  * **`organization_events`** (string)
    The level of permission to grant the access token to view events triggered by an activity in an organization.
    Can be one of: `read`
  * **`organization_hooks`** (string)
    The level of permission to grant the access token to manage the post-receive hooks for an organization.
    Can be one of: `read`, `write`
  * **`organization_personal_access_tokens`** (string)
    The level of permission to grant the access token for viewing and managing fine-grained personal access token requests to an organization.
    Can be one of: `read`, `write`
  * **`organization_personal_access_token_requests`** (string)
    The level of permission to grant the access token for viewing and managing fine-grained personal access tokens that have been approved by an organization.
    Can be one of: `read`, `write`
  * **`organization_plan`** (string)
    The level of permission to grant the access token for viewing an organization's plan.
    Can be one of: `read`
  * **`organization_projects`** (string)
    The level of permission to grant the access token to manage organization projects and projects public preview (where available).
    Can be one of: `read`, `write`, `admin`
  * **`organization_packages`** (string)
    The level of permission to grant the access token for organization packages published to GitHub Packages.
    Can be one of: `read`, `write`
  * **`organization_secrets`** (string)
    The level of permission to grant the access token to manage organization secrets.
    Can be one of: `read`, `write`
  * **`organization_self_hosted_runners`** (string)
    The level of permission to grant the access token to view and manage GitHub Actions self-hosted runners available to an organization.
    Can be one of: `read`, `write`
  * **`organization_user_blocking`** (string)
    The level of permission to grant the access token to view and manage users blocked by the organization.
    Can be one of: `read`, `write`
  * **`email_addresses`** (string)
    The level of permission to grant the access token to manage the email addresses belonging to a user.
    Can be one of: `read`, `write`
  * **`followers`** (string)
    The level of permission to grant the access token to manage the followers belonging to a user.
    Can be one of: `read`, `write`
  * **`git_ssh_keys`** (string)
    The level of permission to grant the access token to manage git SSH keys.
    Can be one of: `read`, `write`
  * **`gpg_keys`** (string)
    The level of permission to grant the access token to view and manage GPG keys belonging to a user.
    Can be one of: `read`, `write`
  * **`interaction_limits`** (string)
    The level of permission to grant the access token to view and manage interaction limits on a repository.
    Can be one of: `read`, `write`
  * **`profile`** (string)
    The level of permission to grant the access token to manage the profile settings belonging to a user.
    Can be one of: `write`
  * **`starring`** (string)
    The level of permission to grant the access token to list and manage repositories a user is starring.
    Can be one of: `read`, `write`
  * **`enterprise_custom_properties_for_organizations`** (string)
    The level of permission to grant the access token for organization custom properties management at the enterprise level.
    Can be one of: `read`, `write`, `admin`

### HTTP response status codes

* **201** - Created

* **401** - Requires authentication

* **403** - Forbidden

* **404** - Resource not found

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/app/installations/1/access_tokens \
  -d '{
  "repositories": [
    "Hello-World"
  ],
  "permissions": {
    "issues": "write",
    "contents": "read"
  }
}'
```

**Response schema (Status: 201):**

* `token`: required, string
* `expires_at`: required, string
* `permissions`: `App Permissions`:
  * `actions`: string, enum: `read`, `write`
  * `administration`: string, enum: `read`, `write`
  * `artifact_metadata`: string, enum: `read`, `write`
  * `attestations`: string, enum: `read`, `write`
  * `checks`: string, enum: `read`, `write`
  * `code_quality`: string, enum: `read`, `write`
  * `codespaces`: string, enum: `read`, `write`
  * `contents`: string, enum: `read`, `write`
  * `dependabot_secrets`: string, enum: `read`, `write`
  * `deployments`: string, enum: `read`, `write`
  * `discussions`: string, enum: `read`, `write`
  * `environments`: string, enum: `read`, `write`
  * `issues`: string, enum: `read`, `write`
  * `merge_queues`: string, enum: `read`, `write`
  * `metadata`: string, enum: `read`, `write`
  * `packages`: string, enum: `read`, `write`
  * `pages`: string, enum: `read`, `write`
  * `pull_requests`: string, enum: `read`, `write`
  * `repository_custom_properties`: string, enum: `read`, `write`
  * `repository_hooks`: string, enum: `read`, `write`
  * `repository_projects`: string, enum: `read`, `write`, `admin`
  * `secret_scanning_alerts`: string, enum: `read`, `write`
  * `secrets`: string, enum: `read`, `write`
  * `security_events`: string, enum: `read`, `write`
  * `single_file`: string, enum: `read`, `write`
  * `statuses`: string, enum: `read`, `write`
  * `vulnerability_alerts`: string, enum: `read`, `write`
  * `workflows`: string, enum: `write`
  * `custom_properties_for_organizations`: string, enum: `read`, `write`
  * `members`: string, enum: `read`, `write`
  * `organization_administration`: string, enum: `read`, `write`
  * `organization_custom_roles`: string, enum: `read`, `write`
  * `organization_custom_org_roles`: string, enum: `read`, `write`
  * `organization_custom_properties`: string, enum: `read`, `write`, `admin`
  * `organization_copilot_seat_management`: string, enum: `read`, `write`
  * `organization_copilot_agent_settings`: string, enum: `read`, `write`
  * `organization_external_properties_for_repos`: string, enum: `read`, `write`, `admin`
  * `organization_announcement_banners`: string, enum: `read`, `write`
  * `organization_events`: string, enum: `read`
  * `organization_hooks`: string, enum: `read`, `write`
  * `organization_personal_access_tokens`: string, enum: `read`, `write`
  * `organization_personal_access_token_requests`: string, enum: `read`, `write`
  * `organization_plan`: string, enum: `read`
  * `organization_projects`: string, enum: `read`, `write`, `admin`
  * `organization_packages`: string, enum: `read`, `write`
  * `organization_secrets`: string, enum: `read`, `write`
  * `organization_self_hosted_runners`: string, enum: `read`, `write`
  * `organization_user_blocking`: string, enum: `read`, `write`
  * `email_addresses`: string, enum: `read`, `write`
  * `followers`: string, enum: `read`, `write`
  * `git_ssh_keys`: string, enum: `read`, `write`
  * `gpg_keys`: string, enum: `read`, `write`
  * `interaction_limits`: string, enum: `read`, `write`
  * `profile`: string, enum: `write`
  * `starring`: string, enum: `read`, `write`
  * `enterprise_custom_properties_for_organizations`: string, enum: `read`, `write`, `admin`
* `repository_selection`: string, enum: `all`, `selected`
* `repositories`: array of `Repository`:
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
* `single_file`: string
* `has_multiple_single_files`: boolean
* `single_file_paths`: array of string

## Suspend an app installation

```
PUT /app/installations/{installation_id}/suspended
```

Suspends a GitHub App on a user, organization, or enterprise account, which blocks the app from accessing the account's resources. When a GitHub App is suspended, the app's access to the GitHub API or webhook events is blocked for that account.
You must use a JWT to access this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`installation_id`** (integer) (required)
  The unique identifier of the installation.

### HTTP response status codes

* **204** - No Content

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/app/installations/1/suspended
```

**Response schema (Status: 204):**

## Unsuspend an app installation

```
DELETE /app/installations/{installation_id}/suspended
```

Removes a GitHub App installation suspension.
You must use a JWT to access this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`installation_id`** (integer) (required)
  The unique identifier of the installation.

### HTTP response status codes

* **204** - No Content

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/app/installations/1/suspended
```

**Response schema (Status: 204):**

## Create a scoped access token

```
POST /applications/{client_id}/token/scoped
```

Use a non-scoped user access token to create a repository-scoped and/or permission-scoped user access token. You can specify
which repositories the token can access and which permissions are granted to the
token.
Invalid tokens will return 404 NOT FOUND.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`client_id`** (string) (required)
  The client ID of the GitHub app.

#### Body parameters

* **`access_token`** (string) (required)
  The access token used to authenticate to the GitHub API.

* **`target`** (string)
  The name of the user or organization to scope the user access token to. Required unless target\_id is specified.

* **`target_id`** (integer)
  The ID of the user or organization to scope the user access token to. Required unless target is specified.

* **`repositories`** (array of strings)
  The list of repository names to scope the user access token to. repositories may not be specified if repository\_ids is specified.

* **`repository_ids`** (array of integers)
  The list of repository IDs to scope the user access token to. repository\_ids may not be specified if repositories is specified.

* **`permissions`** (object)
  The permissions granted to the fine-grained access token.
  * **`actions`** (string)
    The level of permission to grant the access token for GitHub Actions workflows, workflow runs, and artifacts.
    Can be one of: `read`, `write`
  * **`administration`** (string)
    The level of permission to grant the access token for repository creation, deletion, settings, teams, and collaborators creation.
    Can be one of: `read`, `write`
  * **`artifact_metadata`** (string)
    The level of permission to grant the access token to create and retrieve build artifact metadata records.
    Can be one of: `read`, `write`
  * **`attestations`** (string)
    The level of permission to create and retrieve the access token for repository attestations.
    Can be one of: `read`, `write`
  * **`checks`** (string)
    The level of permission to grant the access token for checks on code.
    Can be one of: `read`, `write`
  * **`code_quality`** (string)
    The level of permission to grant the access token to view and manage code quality data.
    Can be one of: `read`, `write`
  * **`codespaces`** (string)
    The level of permission to grant the access token to create, edit, delete, and list Codespaces.
    Can be one of: `read`, `write`
  * **`contents`** (string)
    The level of permission to grant the access token for repository contents, commits, branches, downloads, releases, and merges.
    Can be one of: `read`, `write`
  * **`dependabot_secrets`** (string)
    The level of permission to grant the access token to manage Dependabot secrets.
    Can be one of: `read`, `write`
  * **`deployments`** (string)
    The level of permission to grant the access token for deployments and deployment statuses.
    Can be one of: `read`, `write`
  * **`discussions`** (string)
    The level of permission to grant the access token for discussions and related comments and labels.
    Can be one of: `read`, `write`
  * **`environments`** (string)
    The level of permission to grant the access token for managing repository environments.
    Can be one of: `read`, `write`
  * **`issues`** (string)
    The level of permission to grant the access token for issues and related comments, assignees, labels, and milestones.
    Can be one of: `read`, `write`
  * **`merge_queues`** (string)
    The level of permission to grant the access token to manage the merge queues for a repository.
    Can be one of: `read`, `write`
  * **`metadata`** (string)
    The level of permission to grant the access token to search repositories, list collaborators, and access repository metadata.
    Can be one of: `read`, `write`
  * **`packages`** (string)
    The level of permission to grant the access token for packages published to GitHub Packages.
    Can be one of: `read`, `write`
  * **`pages`** (string)
    The level of permission to grant the access token to retrieve Pages statuses, configuration, and builds, as well as create new builds.
    Can be one of: `read`, `write`
  * **`pull_requests`** (string)
    The level of permission to grant the access token for pull requests and related comments, assignees, labels, milestones, and merges.
    Can be one of: `read`, `write`
  * **`repository_custom_properties`** (string)
    The level of permission to grant the access token to view and edit custom properties for a repository, when allowed by the property.
    Can be one of: `read`, `write`
  * **`repository_hooks`** (string)
    The level of permission to grant the access token to manage the post-receive hooks for a repository.
    Can be one of: `read`, `write`
  * **`repository_projects`** (string)
    The level of permission to grant the access token to manage repository projects, columns, and cards.
    Can be one of: `read`, `write`, `admin`
  * **`secret_scanning_alerts`** (string)
    The level of permission to grant the access token to view and manage secret scanning alerts.
    Can be one of: `read`, `write`
  * **`secrets`** (string)
    The level of permission to grant the access token to manage repository secrets.
    Can be one of: `read`, `write`
  * **`security_events`** (string)
    The level of permission to grant the access token to view and manage security events like code scanning alerts.
    Can be one of: `read`, `write`
  * **`single_file`** (string)
    The level of permission to grant the access token to manage just a single file.
    Can be one of: `read`, `write`
  * **`statuses`** (string)
    The level of permission to grant the access token for commit statuses.
    Can be one of: `read`, `write`
  * **`vulnerability_alerts`** (string)
    The level of permission to grant the access token to manage Dependabot alerts.
    Can be one of: `read`, `write`
  * **`workflows`** (string)
    The level of permission to grant the access token to update GitHub Actions workflow files.
    Can be one of: `write`
  * **`custom_properties_for_organizations`** (string)
    The level of permission to grant the access token to view and edit custom properties for an organization, when allowed by the property.
    Can be one of: `read`, `write`
  * **`members`** (string)
    The level of permission to grant the access token for organization teams and members.
    Can be one of: `read`, `write`
  * **`organization_administration`** (string)
    The level of permission to grant the access token to manage access to an organization.
    Can be one of: `read`, `write`
  * **`organization_custom_roles`** (string)
    The level of permission to grant the access token for custom repository roles management.
    Can be one of: `read`, `write`
  * **`organization_custom_org_roles`** (string)
    The level of permission to grant the access token for custom organization roles management.
    Can be one of: `read`, `write`
  * **`organization_custom_properties`** (string)
    The level of permission to grant the access token for repository custom properties management at the organization level.
    Can be one of: `read`, `write`, `admin`
  * **`organization_copilot_seat_management`** (string)
    The level of permission to grant the access token for managing access to GitHub Copilot for members of an organization with a Copilot Business subscription. This property is in public preview and is subject to change.
    Can be one of: `read`, `write`
  * **`organization_copilot_agent_settings`** (string)
    The level of permission to grant the access token to view and manage Copilot cloud agent settings for an organization.
    Can be one of: `read`, `write`
  * **`organization_external_properties_for_repos`** (string)
    The level of permission to grant the access token for managing external custom properties for repositories in an organization.
    Can be one of: `read`, `write`, `admin`
  * **`organization_announcement_banners`** (string)
    The level of permission to grant the access token to view and manage announcement banners for an organization.
    Can be one of: `read`, `write`
  * **`organization_events`** (string)
    The level of permission to grant the access token to view events triggered by an activity in an organization.
    Can be one of: `read`
  * **`organization_hooks`** (string)
    The level of permission to grant the access token to manage the post-receive hooks for an organization.
    Can be one of: `read`, `write`
  * **`organization_personal_access_tokens`** (string)
    The level of permission to grant the access token for viewing and managing fine-grained personal access token requests to an organization.
    Can be one of: `read`, `write`
  * **`organization_personal_access_token_requests`** (string)
    The level of permission to grant the access token for viewing and managing fine-grained personal access tokens that have been approved by an organization.
    Can be one of: `read`, `write`
  * **`organization_plan`** (string)
    The level of permission to grant the access token for viewing an organization's plan.
    Can be one of: `read`
  * **`organization_projects`** (string)
    The level of permission to grant the access token to manage organization projects and projects public preview (where available).
    Can be one of: `read`, `write`, `admin`
  * **`organization_packages`** (string)
    The level of permission to grant the access token for organization packages published to GitHub Packages.
    Can be one of: `read`, `write`
  * **`organization_secrets`** (string)
    The level of permission to grant the access token to manage organization secrets.
    Can be one of: `read`, `write`
  * **`organization_self_hosted_runners`** (string)
    The level of permission to grant the access token to view and manage GitHub Actions self-hosted runners available to an organization.
    Can be one of: `read`, `write`
  * **`organization_user_blocking`** (string)
    The level of permission to grant the access token to view and manage users blocked by the organization.
    Can be one of: `read`, `write`
  * **`email_addresses`** (string)
    The level of permission to grant the access token to manage the email addresses belonging to a user.
    Can be one of: `read`, `write`
  * **`followers`** (string)
    The level of permission to grant the access token to manage the followers belonging to a user.
    Can be one of: `read`, `write`
  * **`git_ssh_keys`** (string)
    The level of permission to grant the access token to manage git SSH keys.
    Can be one of: `read`, `write`
  * **`gpg_keys`** (string)
    The level of permission to grant the access token to view and manage GPG keys belonging to a user.
    Can be one of: `read`, `write`
  * **`interaction_limits`** (string)
    The level of permission to grant the access token to view and manage interaction limits on a repository.
    Can be one of: `read`, `write`
  * **`profile`** (string)
    The level of permission to grant the access token to manage the profile settings belonging to a user.
    Can be one of: `write`
  * **`starring`** (string)
    The level of permission to grant the access token to list and manage repositories a user is starring.
    Can be one of: `read`, `write`
  * **`enterprise_custom_properties_for_organizations`** (string)
    The level of permission to grant the access token for organization custom properties management at the enterprise level.
    Can be one of: `read`, `write`, `admin`

### HTTP response status codes

* **200** - OK

* **401** - Requires authentication

* **403** - Forbidden

* **404** - Resource not found

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/applications/Iv1.8a61f9b3a7aba766/token/scoped \
  -d '{
  "access_token": "e72e16c7e42f292c6912e7710c838347ae178b4a",
  "target": "octocat",
  "permissions": {
    "metadata": "read",
    "issues": "write",
    "contents": "read"
  }
}'
```

**Response schema (Status: 200):**

* `id`: required, integer, format: int64
* `url`: required, string, format: uri
* `scopes`: required, array of string or null
* `token`: required, string
* `token_last_eight`: required, string or null
* `hashed_token`: required, string or null
* `app`: required, object:
  * `client_id`: required, string
  * `name`: required, string
  * `url`: required, string, format: uri
* `note`: required, string or null
* `note_url`: required, string or null, format: uri
* `updated_at`: required, string, format: date-time
* `created_at`: required, string, format: date-time
* `fingerprint`: required, string or null
* `user`: any of:
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
* `installation`: any of:
  * **null**
  * **Scoped Installation**
    * `permissions`: required, `App Permissions`:
      * `actions`: string, enum: `read`, `write`
      * `administration`: string, enum: `read`, `write`
      * `artifact_metadata`: string, enum: `read`, `write`
      * `attestations`: string, enum: `read`, `write`
      * `checks`: string, enum: `read`, `write`
      * `code_quality`: string, enum: `read`, `write`
      * `codespaces`: string, enum: `read`, `write`
      * `contents`: string, enum: `read`, `write`
      * `dependabot_secrets`: string, enum: `read`, `write`
      * `deployments`: string, enum: `read`, `write`
      * `discussions`: string, enum: `read`, `write`
      * `environments`: string, enum: `read`, `write`
      * `issues`: string, enum: `read`, `write`
      * `merge_queues`: string, enum: `read`, `write`
      * `metadata`: string, enum: `read`, `write`
      * `packages`: string, enum: `read`, `write`
      * `pages`: string, enum: `read`, `write`
      * `pull_requests`: string, enum: `read`, `write`
      * `repository_custom_properties`: string, enum: `read`, `write`
      * `repository_hooks`: string, enum: `read`, `write`
      * `repository_projects`: string, enum: `read`, `write`, `admin`
      * `secret_scanning_alerts`: string, enum: `read`, `write`
      * `secrets`: string, enum: `read`, `write`
      * `security_events`: string, enum: `read`, `write`
      * `single_file`: string, enum: `read`, `write`
      * `statuses`: string, enum: `read`, `write`
      * `vulnerability_alerts`: string, enum: `read`, `write`
      * `workflows`: string, enum: `write`
      * `custom_properties_for_organizations`: string, enum: `read`, `write`
      * `members`: string, enum: `read`, `write`
      * `organization_administration`: string, enum: `read`, `write`
      * `organization_custom_roles`: string, enum: `read`, `write`
      * `organization_custom_org_roles`: string, enum: `read`, `write`
      * `organization_custom_properties`: string, enum: `read`, `write`, `admin`
      * `organization_copilot_seat_management`: string, enum: `read`, `write`
      * `organization_copilot_agent_settings`: string, enum: `read`, `write`
      * `organization_external_properties_for_repos`: string, enum: `read`, `write`, `admin`
      * `organization_announcement_banners`: string, enum: `read`, `write`
      * `organization_events`: string, enum: `read`
      * `organization_hooks`: string, enum: `read`, `write`
      * `organization_personal_access_tokens`: string, enum: `read`, `write`
      * `organization_personal_access_token_requests`: string, enum: `read`, `write`
      * `organization_plan`: string, enum: `read`
      * `organization_projects`: string, enum: `read`, `write`, `admin`
      * `organization_packages`: string, enum: `read`, `write`
      * `organization_secrets`: string, enum: `read`, `write`
      * `organization_self_hosted_runners`: string, enum: `read`, `write`
      * `organization_user_blocking`: string, enum: `read`, `write`
      * `email_addresses`: string, enum: `read`, `write`
      * `followers`: string, enum: `read`, `write`
      * `git_ssh_keys`: string, enum: `read`, `write`
      * `gpg_keys`: string, enum: `read`, `write`
      * `interaction_limits`: string, enum: `read`, `write`
      * `profile`: string, enum: `write`
      * `starring`: string, enum: `read`, `write`
      * `enterprise_custom_properties_for_organizations`: string, enum: `read`, `write`, `admin`
    * `repository_selection`: required, string, enum: `all`, `selected`
    * `single_file_name`: required, string or null
    * `has_multiple_single_files`: boolean
    * `single_file_paths`: array of string
    * `repositories_url`: required, string, format: uri
    * `account`: required, `Simple User` (see above)
* `expires_at`: required, string or null, format: date-time

## Get an app

```
GET /apps/{app_slug}
```

Note

The :app\_slug is just the URL-friendly name of your GitHub App. You can find this on the settings page for your GitHub App (e.g., <https://github.com/settings/apps/:app_slug>).

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`app_slug`** (string) (required)

### HTTP response status codes

* **200** - OK

* **403** - Forbidden

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/apps/APP_SLUG
```

**Response schema (Status: 200):**

Same response schema as [Get the authenticated app](#get-the-authenticated-app).

## Get an organization installation for the authenticated app

```
GET /orgs/{org}/installation
```

Enables an authenticated GitHub App to find the organization's installation information.
You must use a JWT to access this endpoint.

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
  https://api.github.com/orgs/ORG/installation
```

**Response schema (Status: 200):**

Same response schema as [Get an installation for the authenticated app](#get-an-installation-for-the-authenticated-app).

## Get a repository installation for the authenticated app

```
GET /repos/{owner}/{repo}/installation
```

Enables an authenticated GitHub App to find the repository's installation information. The installation's account type will be either an organization or a user account, depending which account the repository belongs to.
You must use a JWT to access this endpoint.

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

* **301** - Moved permanently

* **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/installation
```

**Response schema (Status: 200):**

Same response schema as [Get an installation for the authenticated app](#get-an-installation-for-the-authenticated-app).

## Get a user installation for the authenticated app

```
GET /users/{username}/installation
```

Enables an authenticated GitHub App to find the user’s installation information.
You must use a JWT to access this endpoint.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`username`** (string) (required)
  The handle for the GitHub user account.

### HTTP response status codes

* **200** - OK

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/users/USERNAME/installation
```

**Response schema (Status: 200):**

Same response schema as [Get an installation for the authenticated app](#get-an-installation-for-the-authenticated-app).