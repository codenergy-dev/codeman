---
title: "REST API endpoints for repository security advisories"
url: https://docs.github.com/en/rest/security-advisories/repository-advisories
created_at: 2026-10-30T11:47:44-03:00
updated_at: 2026-10-30T11:47:44-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for repository security advisories

Use the REST API to view and manage repository security advisories.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List repository security advisories for an organization

```
GET /orgs/{org}/security-advisories
```

Lists repository security advisories for an organization.
The authenticated user must be an owner or security manager for the organization to use this endpoint.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:write scope to use this endpoint.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`org`** (string) (required)
  The organization name. The name is not case sensitive.

- **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

- **`sort`** (string)
  The property to sort the results by.
  Default: `created`
  Can be one of: `created`, `updated`, `published`

- **`before`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results before this cursor. For more information, see "Using pagination in the REST API."

- **`after`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results after this cursor. For more information, see "Using pagination in the REST API."

- **`per_page`** (integer)
  The number of advisories to return per page. For more information, see "Using pagination in the REST API."
  Default: `30`

- **`state`** (string)
  Filter by the state of the repository advisories. Only advisories of this state will be returned.
  Can be one of: `triage`, `draft`, `published`, `closed`

### HTTP response status codes

- **200** - OK

- **400** - Bad Request

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/orgs/ORG/security-advisories
```

**Response schema (Status: 200):**

Array of objects:
  * `ghsa_id`: required, string, read-only
  * `cve_id`: required, string or null
  * `url`: required, string, format: uri, read-only
  * `html_url`: required, string, format: uri, read-only
  * `summary`: required, string, maxLength: 1024
  * `description`: required, string or null, maxLength: 65535
  * `severity`: required, string or null, enum: `critical`, `high`, `medium`, `low`, `null`
  * `author`: required, all of:
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
  * `publisher`: required, all of:
    * **Simple User** (see above)
  * `identifiers`: required, array of objects:
    * `type`: required, string, enum: `CVE`, `GHSA`
    * `value`: required, string
  * `state`: required, string, enum: `published`, `closed`, `withdrawn`, `draft`, `triage`
  * `created_at`: required, string or null, format: date-time, read-only
  * `updated_at`: required, string or null, format: date-time, read-only
  * `published_at`: required, string or null, format: date-time, read-only
  * `closed_at`: required, string or null, format: date-time, read-only
  * `withdrawn_at`: required, string or null, format: date-time, read-only
  * `submission`: required, object or null, read-only:
    * `accepted`: required, boolean, read-only
  * `vulnerabilities`: required, array of objects or null:
    * `package`: required, object or null:
      * `ecosystem`: required, string, enum: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`
      * `name`: required, string or null
    * `vulnerable_version_range`: required, string or null
    * `patched_versions`: required, string or null
    * `vulnerable_functions`: required, array of string or null
  * `cvss_severities`: object or null:
    * `cvss_v3`: object or null:
      * `vector_string`: required, string or null
      * `score`: required, number or null, read-only, minimum: 0, maximum: 10
    * `cvss_v4`: object or null:
      * `vector_string`: required, string or null
      * `score`: required, number or null, read-only, minimum: 0, maximum: 10
  * `cwes`: required, array of objects or null:
    * `cwe_id`: required, string
    * `name`: required, string, read-only
  * `cwe_ids`: required, array of string or null
  * `credits`: required, array of objects or null:
    * `login`: string
    * `type`: string, enum: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`
  * `credits_detailed`: required, array of objects or null:
    * `user`: required, `Simple User` (see above)
    * `type`: required, string, enum: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`
    * `state`: required, string, enum: `accepted`, `declined`, `pending`
  * `collaborating_users`: required, array of `Simple User` or null (see above)
  * `collaborating_teams`: required, array of `Team` or null:
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
  * `private_fork`: required, all of:
    * **Simple Repository**
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
      * `stargazers_url`: required, string, format: uri
      * `statuses_url`: required, string
      * `subscribers_url`: required, string, format: uri
      * `subscription_url`: required, string, format: uri
      * `tags_url`: required, string, format: uri
      * `teams_url`: required, string, format: uri
      * `trees_url`: required, string
      * `hooks_url`: required, string, format: uri

## List repository security advisories

```
GET /repos/{owner}/{repo}/security-advisories
```

Lists security advisories in a repository.
The authenticated user can access unpublished security advisories from a repository if they are a security manager or administrator of that repository, or if they are a collaborator on any security advisory.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:read scope to to get a published security advisory in a private repository, or any unpublished security advisory that the authenticated user has access to.

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

- **`sort`** (string)
  The property to sort the results by.
  Default: `created`
  Can be one of: `created`, `updated`, `published`

- **`before`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results before this cursor. For more information, see "Using pagination in the REST API."

- **`after`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results after this cursor. For more information, see "Using pagination in the REST API."

- **`per_page`** (integer)
  The number of advisories to return per page. For more information, see "Using pagination in the REST API."
  Default: `30`

- **`state`** (string)
  Filter by state of the repository advisories. Only advisories of this state will be returned.
  Can be one of: `triage`, `draft`, `published`, `closed`

### HTTP response status codes

- **200** - OK

- **400** - Bad Request

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/security-advisories
```

**Response schema (Status: 200):**

Same response schema as [List repository security advisories for an organization](#list-repository-security-advisories-for-an-organization).

## Create a repository security advisory

```
POST /repos/{owner}/{repo}/security-advisories
```

Creates a new repository security advisory.
In order to create a draft repository security advisory, the authenticated user must be a security manager or administrator of that repository.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:write scope to use this endpoint.

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

- **`summary`** (string) (required)
  A short summary of the advisory.

- **`description`** (string) (required)
  A detailed description of what the advisory impacts.

- **`cve_id`** (string or null)
  The Common Vulnerabilities and Exposures (CVE) ID.

- **`vulnerabilities`** (array of objects) (required)
  A product affected by the vulnerability detailed in a repository security advisory.
  - **`package`** (object) (required)
    The name of the package affected by the vulnerability.
    - **`ecosystem`** (string) (required)
      The package's language or package management ecosystem.
      Can be one of: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`
    - **`name`** (string or null)
      The unique package name within its ecosystem.
  - **`vulnerable_version_range`** (string or null)
    The range of the package versions affected by the vulnerability.
  - **`patched_versions`** (string or null)
    The package version(s) that resolve the vulnerability.
  - **`vulnerable_functions`** (array of strings or null)
    The functions in the package that are affected.

- **`cwe_ids`** (array of strings or null)
  A list of Common Weakness Enumeration (CWE) IDs.

- **`credits`** (array of objects or null)
  A list of users receiving credit for their participation in the security advisory.
  - **`login`** (string) (required)
    The username of the user credited.
  - **`type`** (string) (required)
    The type of credit the user is receiving.
    Can be one of: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`

- **`severity`** (string or null)
  The severity of the advisory. You must choose between setting this field or cvss_vector_string.
  Can be one of: `critical`, `high`, `medium`, `low`, `null`

- **`cvss_vector_string`** (string or null)
  The CVSS vector that calculates the severity of the advisory. You must choose between setting this field or severity.

- **`start_private_fork`** (boolean)
  Whether to create a temporary private fork of the repository to collaborate on a fix.
  Default: `false`

### HTTP response status codes

- **201** - Created

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/security-advisories \
  -d '{
  "summary": "A new important advisory",
  "description": "A more in-depth description of what the problem is.",
  "severity": "high",
  "cve_id": null,
  "vulnerabilities": [
    {
      "package": {
        "name": "a-package",
        "ecosystem": "npm"
      },
      "vulnerable_version_range": "< 1.0.0",
      "patched_versions": "1.0.0",
      "vulnerable_functions": [
        "important_function"
      ]
    }
  ],
  "cwe_ids": [
    "CWE-1101",
    "CWE-20"
  ],
  "credits": [
    {
      "login": "monalisa",
      "type": "reporter"
    },
    {
      "login": "octocat",
      "type": "analyst"
    }
  ]
}'
```

**Response schema (Status: 201):**

* `ghsa_id`: required, string, read-only
* `cve_id`: required, string or null
* `url`: required, string, format: uri, read-only
* `html_url`: required, string, format: uri, read-only
* `summary`: required, string, maxLength: 1024
* `description`: required, string or null, maxLength: 65535
* `severity`: required, string or null, enum: `critical`, `high`, `medium`, `low`, `null`
* `author`: required, all of:
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
* `publisher`: required, all of:
  * **Simple User** (see above)
* `identifiers`: required, array of objects:
  * `type`: required, string, enum: `CVE`, `GHSA`
  * `value`: required, string
* `state`: required, string, enum: `published`, `closed`, `withdrawn`, `draft`, `triage`
* `created_at`: required, string or null, format: date-time, read-only
* `updated_at`: required, string or null, format: date-time, read-only
* `published_at`: required, string or null, format: date-time, read-only
* `closed_at`: required, string or null, format: date-time, read-only
* `withdrawn_at`: required, string or null, format: date-time, read-only
* `submission`: required, object or null, read-only:
  * `accepted`: required, boolean, read-only
* `vulnerabilities`: required, array of objects or null:
  * `package`: required, object or null:
    * `ecosystem`: required, string, enum: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`
    * `name`: required, string or null
  * `vulnerable_version_range`: required, string or null
  * `patched_versions`: required, string or null
  * `vulnerable_functions`: required, array of string or null
* `cvss_severities`: object or null:
  * `cvss_v3`: object or null:
    * `vector_string`: required, string or null
    * `score`: required, number or null, read-only, minimum: 0, maximum: 10
  * `cvss_v4`: object or null:
    * `vector_string`: required, string or null
    * `score`: required, number or null, read-only, minimum: 0, maximum: 10
* `cwes`: required, array of objects or null:
  * `cwe_id`: required, string
  * `name`: required, string, read-only
* `cwe_ids`: required, array of string or null
* `credits`: required, array of objects or null:
  * `login`: string
  * `type`: string, enum: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`
* `credits_detailed`: required, array of objects or null:
  * `user`: required, `Simple User` (see above)
  * `type`: required, string, enum: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`
  * `state`: required, string, enum: `accepted`, `declined`, `pending`
* `collaborating_users`: required, array of `Simple User` or null (see above)
* `collaborating_teams`: required, array of `Team` or null:
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
* `private_fork`: required, all of:
  * **Simple Repository**
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
    * `stargazers_url`: required, string, format: uri
    * `statuses_url`: required, string
    * `subscribers_url`: required, string, format: uri
    * `subscription_url`: required, string, format: uri
    * `tags_url`: required, string, format: uri
    * `teams_url`: required, string, format: uri
    * `trees_url`: required, string
    * `hooks_url`: required, string, format: uri

## Privately report a security vulnerability

```
POST /repos/{owner}/{repo}/security-advisories/reports
```

Report a security vulnerability to the maintainers of the repository.
See "Privately reporting a security vulnerability" for more information about private vulnerability reporting.

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

- **`summary`** (string) (required)
  A short summary of the advisory.

- **`description`** (string) (required)
  A detailed description of what the advisory impacts.

- **`vulnerabilities`** (array of objects or null)
  An array of products affected by the vulnerability detailed in a repository security advisory.
  - **`package`** (object) (required)
    The name of the package affected by the vulnerability.
    - **`ecosystem`** (string) (required)
      The package's language or package management ecosystem.
      Can be one of: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`
    - **`name`** (string or null)
      The unique package name within its ecosystem.
  - **`vulnerable_version_range`** (string or null)
    The range of the package versions affected by the vulnerability.
  - **`patched_versions`** (string or null)
    The package version(s) that resolve the vulnerability.
  - **`vulnerable_functions`** (array of strings or null)
    The functions in the package that are affected.

- **`cwe_ids`** (array of strings or null)
  A list of Common Weakness Enumeration (CWE) IDs.

- **`severity`** (string or null)
  The severity of the advisory. You must choose between setting this field or cvss_vector_string.
  Can be one of: `critical`, `high`, `medium`, `low`, `null`

- **`cvss_vector_string`** (string or null)
  The CVSS vector that calculates the severity of the advisory. You must choose between setting this field or severity.

- **`start_private_fork`** (boolean)
  Whether to create a temporary private fork of the repository to collaborate on a fix. The fork is created only if you are permitted to create one; otherwise, this parameter is ignored and the report is still created.
  Default: `false`

### HTTP response status codes

- **201** - Created

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/security-advisories/reports \
  -d '{
  "summary": "A newly discovered vulnerability",
  "description": "A more in-depth description of what the problem is.",
  "severity": "high",
  "vulnerabilities": [
    {
      "package": {
        "name": "a-package",
        "ecosystem": "npm"
      },
      "vulnerable_version_range": "< 1.0.0",
      "patched_versions": "1.0.0",
      "vulnerable_functions": [
        "important_function"
      ]
    }
  ],
  "cwe_ids": [
    "CWE-123"
  ]
}'
```

**Response schema (Status: 201):**

Same response schema as [Create a repository security advisory](#create-a-repository-security-advisory).

## Get a repository security advisory

```
GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}
```

Get a repository security advisory using its GitHub Security Advisory (GHSA) identifier.
Anyone can access any published security advisory on a public repository.
The authenticated user can access an unpublished security advisory from a repository if they are a security manager or administrator of that repository, or if they are a
collaborator on the security advisory.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:read scope to to get a published security advisory in a private repository, or any unpublished security advisory that the authenticated user has access to.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

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
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID
```

**Response schema (Status: 200):**

Same response schema as [Create a repository security advisory](#create-a-repository-security-advisory).

## Update a repository security advisory

```
PATCH /repos/{owner}/{repo}/security-advisories/{ghsa_id}
```

Update a repository security advisory using its GitHub Security Advisory (GHSA) identifier.
In order to update any security advisory, the authenticated user must be a security manager or administrator of that repository,
or a collaborator on the repository security advisory.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:write scope to use this endpoint.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

#### Body parameters

- **`summary`** (string)
  A short summary of the advisory.

- **`description`** (string)
  A detailed description of what the advisory impacts.

- **`cve_id`** (string or null)
  The Common Vulnerabilities and Exposures (CVE) ID.

- **`vulnerabilities`** (array of objects)
  A product affected by the vulnerability detailed in a repository security advisory.
  - **`package`** (object) (required)
    The name of the package affected by the vulnerability.
    - **`ecosystem`** (string) (required)
      The package's language or package management ecosystem.
      Can be one of: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`
    - **`name`** (string or null)
      The unique package name within its ecosystem.
  - **`vulnerable_version_range`** (string or null)
    The range of the package versions affected by the vulnerability.
  - **`patched_versions`** (string or null)
    The package version(s) that resolve the vulnerability.
  - **`vulnerable_functions`** (array of strings or null)
    The functions in the package that are affected.

- **`cwe_ids`** (array of strings or null)
  A list of Common Weakness Enumeration (CWE) IDs.

- **`credits`** (array of objects or null)
  A list of users receiving credit for their participation in the security advisory.
  - **`login`** (string) (required)
    The username of the user credited.
  - **`type`** (string) (required)
    The type of credit the user is receiving.
    Can be one of: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`

- **`severity`** (string or null)
  The severity of the advisory. You must choose between setting this field or cvss_vector_string.
  Can be one of: `critical`, `high`, `medium`, `low`, `null`

- **`cvss_vector_string`** (string or null)
  The CVSS vector that calculates the severity of the advisory. You must choose between setting this field or severity.

- **`state`** (string)
  The state of the advisory.
  Can be one of: `published`, `closed`, `draft`

- **`collaborating_users`** (array of strings or null)
  A list of usernames who have been granted write access to the advisory.

- **`collaborating_teams`** (array of strings or null)
  A list of team slugs which have been granted write access to the advisory.

### HTTP response status codes

- **200** - OK

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Updating the severity and state.

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID \
  -d '{
  "severity": "critical",
  "state": "published"
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a repository security advisory](#create-a-repository-security-advisory).

#### To add a credit to an advisory, send the whole array of values.

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID \
  -d '{
  "credits": [
    {
      "login": "monauser",
      "type": "remediation_developer"
    }
  ]
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a repository security advisory](#create-a-repository-security-advisory).

## List repository security advisory comments

```
GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}/comments
```

Lists comments on a repository security advisory.
Accessing internal comments requires write access to the advisory.
Callers with read-only access to the advisory receive only eligible post-publication comments. For unpublished advisories, these callers receive an empty list.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

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

- **403** - Forbidden

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID/comments
```

**Response schema (Status: 200):**

Array of `Repository Advisory Comment`:
  * `id`: required, integer, format: int64
  * `node_id`: required, string
  * `url`: required, string, format: uri
  * `html_url`: required, string, format: uri
  * `body`: required, string
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
  * `created_at`: required, string, format: date-time
  * `updated_at`: required, string, format: date-time
  * `advisory_url`: required, string, format: uri
  * `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`

## Create a repository advisory comment

```
POST /repos/{owner}/{repo}/security-advisories/{ghsa_id}/comments
```

Creates a comment on a repository security advisory.
In order to create a comment, the authenticated user must be an advisory collaborator, security manager, or repository administrator.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

#### Body parameters

- **`body`** (string) (required)
  The contents of the comment.

### HTTP response status codes

- **201** - Created

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID/comments \
  -d '{
  "body": "Thanks for the report. We are working on a fix."
}'
```

**Response schema (Status: 201):**

* `id`: required, integer, format: int64
* `node_id`: required, string
* `url`: required, string, format: uri
* `html_url`: required, string, format: uri
* `body`: required, string
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
* `created_at`: required, string, format: date-time
* `updated_at`: required, string, format: date-time
* `advisory_url`: required, string, format: uri
* `author_association`: required, string, enum: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`

## Get a repository advisory comment

```
GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}/comments/{comment_id}
```

Get a comment on a repository security advisory using the comment's ID.
Advisory collaborators can view all non-confidential comments on advisories they have access to.
Other users can only view comments that are not considered internal.
GitHub Apps and fine-grained personal access tokens with the repository_advisories: read permission can view all non-confidential comments, including internal comments.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:read scope to get a comment on a security advisory in a private repository, or any unpublished security advisory that the authenticated user has access to.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

- **`comment_id`** (integer) (required)
  The unique identifier of the comment.

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
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID/comments/COMMENT_ID
```

**Response schema (Status: 200):**

Same response schema as [Create a repository advisory comment](#create-a-repository-advisory-comment).

## Update a repository advisory comment

```
PATCH /repos/{owner}/{repo}/security-advisories/{ghsa_id}/comments/{comment_id}
```

Update the body of a comment on a repository security advisory using the comment's ID.
In order to update a comment, the authenticated user must be the author of the comment, or a security manager or administrator of the repository.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:write scope to use this endpoint.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

- **`comment_id`** (integer) (required)
  The unique identifier of the comment.

#### Body parameters

- **`body`** (string) (required)
  The contents of the comment.

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
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID/comments/COMMENT_ID \
  -d '{
  "body": "Updated comment body."
}'
```

**Response schema (Status: 200):**

Same response schema as [Create a repository advisory comment](#create-a-repository-advisory-comment).

## Request a CVE for a repository security advisory

```
POST /repos/{owner}/{repo}/security-advisories/{ghsa_id}/cve
```

If you want a CVE identification number for the security vulnerability in your project, and don't already have one, you can request a CVE identification number from GitHub. For more information see "Requesting a CVE identification number."
You may request a CVE for public repositories, but cannot do so for private repositories.
In order to request a CVE for a repository security advisory, the authenticated user must be a security manager or administrator of that repository.
OAuth app tokens and personal access tokens (classic) need the repo or repository_advisories:write scope to use this endpoint.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

### HTTP response status codes

- **202** - Accepted

- **400** - Bad Request

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID/cve
```

**Response schema (Status: 202):**

object

## Create a temporary private fork

```
POST /repos/{owner}/{repo}/security-advisories/{ghsa_id}/forks
```

Create a temporary private fork to collaborate on fixing a security vulnerability in a repository.
Repository administrators, organization owners, and security managers can create a temporary private fork. The original reporter of a privately reported vulnerability can also create one while they remain a collaborator on the security advisory.
Note

Forking a repository happens asynchronously. You may have to wait up to 5 minutes before you can access the fork.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

### HTTP response status codes

- **202** - Accepted

- **400** - Bad Request

- **403** - Forbidden

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/security-advisories/GHSA_ID/forks
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
