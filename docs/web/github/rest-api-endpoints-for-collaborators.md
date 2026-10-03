---
title: REST API endpoints for collaborators
url: https://docs.github.com/en/rest/collaborators/collaborators
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for collaborators

Use the REST API to manage collaborators for a repository.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List repository collaborators

```
GET /repos/{owner}/{repo}/collaborators
```

For organization-owned repositories, the list of collaborators includes outside collaborators, organization members that are direct collaborators, organization members with access through team memberships, organization members with access through default organization permissions, and organization owners.
The permissions hash returned in the response contains the base role permissions of the collaborator. The role_name is the highest role assigned to the collaborator after considering all sources of grants, including: repo, teams, organization, and enterprise.
There is presently not a way to differentiate between an organization level grant and a repository level grant from this endpoint response.
Team members will include the members of child teams.
The authenticated user must have write, maintain, or admin privileges on the repository to use this endpoint. For organization-owned repositories, the authenticated user needs to be a member of the organization.
OAuth app tokens and personal access tokens (classic) need the read:org and repo scopes to use this endpoint.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`affiliation`** (string)
  Filter collaborators returned by their affiliation. outside means all outside collaborators of an organization-owned repository. direct means all collaborators with permissions to an organization-owned repository, regardless of organization membership status. all means all collaborators the authenticated user can see.
  Default: `all`
  Can be one of: `outside`, `direct`, `all`

- **`permission`** (string)
  Filter collaborators by the permissions they have on the repository. If not specified, all collaborators will be returned.
  Can be one of: `pull`, `triage`, `triage_plus`, `push`, `maintain`, `admin`

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
  https://api.github.com/repos/OWNER/REPO/collaborators
```

**Response schema (Status: 200):**

Array of `Collaborator`:
  * `login`: required, string
  * `id`: required, integer, format: int64
  * `email`: string or null
  * `name`: string or null
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
  * `permissions`: object:
    * `pull`: required, boolean
    * `triage`: boolean
    * `push`: required, boolean
    * `maintain`: boolean
    * `admin`: required, boolean
  * `role_name`: required, string
  * `user_view_type`: string

## Check if a user is a repository collaborator

```
GET /repos/{owner}/{repo}/collaborators/{username}
```

For organization-owned repositories, the list of collaborators includes outside collaborators, organization members that are direct collaborators, organization members with access through team memberships, organization members with access through default organization permissions, and organization owners.
Team members will include the members of child teams.
The authenticated user must have push access to the repository to use this endpoint.
OAuth app tokens and personal access tokens (classic) need the read:org and repo scopes to use this endpoint.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`username`** (string) (required)
  The handle for the GitHub user account.

### HTTP response status codes

- **204** - Response if user is a collaborator

- **404** - Not Found if user is not a collaborator

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/collaborators/USERNAME
```

**Response schema (Status: 204):**

## Add a repository collaborator

```
PUT /repos/{owner}/{repo}/collaborators/{username}
```

Add a user to a repository with a specified level of access. If the repository is owned by an organization, this API does not add the user to the organization - a user that has repository access without being an organization member is called an "outside collaborator" (if they are not an Enterprise Managed User) or a "repository collaborator" if they are an Enterprise Managed User. These users are exempt from some organization policies - see "Adding outside collaborators to repositories" to learn more about these collaborator types.
This endpoint triggers notifications.
Adding an outside collaborator may be restricted by enterprise and organization administrators. For more information, see "Enforcing repository management policies in your enterprise" and "Setting permissions for adding outside collaborators" for organization settings.
For more information on permission levels, see "Repository permission levels for an organization". There are restrictions on which permissions can be granted to organization members when an organization base role is in place. In this case, the role being given must be equal to or higher than the org base permission. Otherwise, the request will fail with:
Cannot assign {member} permission of {role name}

Note that, if you choose not to pass any parameters, you'll need to set Content-Length to zero when calling out to this endpoint. For more information, see "HTTP method."
The invitee will receive a notification that they have been invited to the repository, which they must accept or decline. They may do this via the notifications page, the email they receive, or by using the API.
For Enterprise Managed Users, this endpoint does not send invitations - these users are automatically added to organizations and repositories. Enterprise Managed Users can only be added to organizations and repositories within their enterprise.
Updating an existing collaborator's permission level
The endpoint can also be used to change the permissions of an existing collaborator without first removing and re-adding the collaborator. To change the permissions, use the same endpoint and pass a different permission parameter. The response will be a 204, with no other indication that the permission level changed.
Rate limits
You are limited to sending 50 invitations to a repository per 24 hour period. Note there is no limit if you are inviting organization members to an organization repository.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`username`** (string) (required)
  The handle for the GitHub user account.

#### Body parameters

- **`permission`** (string)
  The permission to grant the collaborator. Only valid on organization-owned repositories. We accept the following permissions to be set: pull, triage, triage_plus, push, maintain, admin and you can also specify a custom repository role name, if the owning organization has defined any.
  Default: `push`

### HTTP response status codes

- **201** - Response when a new invitation is created

- **204** - Response when:

an existing collaborator is added as a collaborator
an organization member is added as an individual collaborator
an existing team member (whose team is also a repository collaborator) is added as an individual collaborator

- **403** - Forbidden

- **422** - Response when:

validation failed, or the endpoint has been spammed
an Enterprise Managed User (EMU) account was invited to a repository in an enterprise with personal user accounts

### Code examples

#### Add a collaborator with triage permissions

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/collaborators/USERNAME \
  -d '{
  "permission": "triage"
}'
```

**Response schema (Status: 201):**

* `id`: required, integer, format: int64
* `repository`: required, `Minimal Repository`:
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
* `invitee`: required, any of:
  * **null**
  * **Simple User** (see above)
* `inviter`: required, any of:
  * **null**
  * **Simple User** (see above)
* `permissions`: required, string, enum: `read`, `write`, `admin`, `triage`, `triage_plus`, `maintain`
* `created_at`: required, string, format: date-time
* `expired`: boolean
* `url`: required, string
* `html_url`: required, string
* `node_id`: required, string

## Remove a repository collaborator

```
DELETE /repos/{owner}/{repo}/collaborators/{username}
```

Removes a collaborator from a repository.
To use this endpoint, the authenticated user must either be an administrator of the repository or target themselves for removal.
This endpoint also:

Cancels any outstanding invitations sent by the collaborator
Unassigns the user from any issues
Removes access to organization projects if the user is not an organization member and is not a collaborator on any other organization repositories.
Unstars the repository
Updates access permissions to packages

Removing a user as a collaborator has the following effects on forks:

If the user had access to a fork through their membership to this repository, the user will also be removed from the fork.
If the user had their own fork of the repository, the fork will be deleted.
If the user still has read access to the repository, open pull requests by this user from a fork will be denied.

Note

A user can still have access to the repository through organization permissions like base repository permissions.

Although the API responds immediately, the additional permission updates might take some extra time to complete in the background.
For more information on fork permissions, see "About permissions and visibility of forks".

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`username`** (string) (required)
  The handle for the GitHub user account.

### HTTP response status codes

- **204** - No Content when collaborator was removed from the repository.

- **403** - Forbidden

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/collaborators/USERNAME
```

**Response schema (Status: 204):**

## Get repository permissions for a user

```
GET /repos/{owner}/{repo}/collaborators/{username}/permission
```

Checks the repository permission and role of a collaborator.
The permission attribute provides the legacy base roles of admin, write, read, and none, where the
maintain role is mapped to write and the triage role is mapped to read.
The role_name attribute provides the name of the assigned role, including custom roles. The
permission can also be used to determine which base level of access the collaborator has to the repository.
The calculated permissions are the highest role assigned to the collaborator after considering all sources of grants, including: repo, teams, organization, and enterprise.
There is presently not a way to differentiate between an organization level grant and a repository level grant from this endpoint response.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`username`** (string) (required)
  The handle for the GitHub user account.

### HTTP response status codes

- **200** - if user has admin permissions

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/collaborators/USERNAME/permission
```

**Response schema (Status: 200):**

* `permission`: required, string
* `role_name`: required, string
* `user`: required, any of:
  * **null**
  * **Collaborator**
    * `login`: required, string
    * `id`: required, integer, format: int64
    * `email`: string or null
    * `name`: string or null
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
    * `permissions`: object:
      * `pull`: required, boolean
      * `triage`: boolean
      * `push`: required, boolean
      * `maintain`: boolean
      * `admin`: required, boolean
    * `role_name`: required, string
    * `user_view_type`: string