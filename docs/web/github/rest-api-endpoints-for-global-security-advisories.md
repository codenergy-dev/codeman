---
title: "REST API endpoints for global security advisories"
url: https://docs.github.com/en/rest/security-advisories/global-advisories
created_at: 2026-10-30T11:47:44-03:00
updated_at: 2026-10-30T11:47:44-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for global security advisories

Use the REST API to view global security advisories.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List global security advisories

```
GET /advisories
```

Lists all global security advisories that match the specified parameters. If no other parameters are defined, the request will return only GitHub-reviewed advisories that are not malware.
By default, all responses will exclude advisories for malware, because malware are not standard vulnerabilities. To list advisories for malware, you must include the type parameter in your request, with the value malware. For more information about the different types of security advisories, see "About the GitHub Advisory database."

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`ghsa_id`** (string)
  If specified, only advisories with this GHSA (GitHub Security Advisory) identifier will be returned.

- **`type`** (string)
  If specified, only advisories of this type will be returned. By default, a request with no other parameters defined will only return reviewed advisories that are not malware.
  Default: `reviewed`
  Can be one of: `reviewed`, `malware`, `unreviewed`

- **`cve_id`** (string)
  If specified, only advisories with this CVE (Common Vulnerabilities and Exposures) identifier will be returned.

- **`ecosystem`** (string)
  If specified, only advisories for these ecosystems will be returned.
  Can be one of: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`

- **`severity`** (string)
  If specified, only advisories with these severities will be returned.
  Can be one of: `unknown`, `low`, `medium`, `high`, `critical`

- **`cwes`** (string or array of strings)
  If specified, only advisories with these Common Weakness Enumerations (CWEs) will be returned.
  Example: cwes=79,284,22 or cwes[]=79&cwes[]=284&cwes[]=22

- **`is_withdrawn`** (boolean)
  Whether to only return advisories that have been withdrawn.

- **`affects`** (string or array of strings)
  If specified, only return advisories that affect any of package or package@version. A maximum of 1000 packages can be specified.
  If the query parameter causes the URL to exceed the maximum URL length supported by your client, you must specify fewer packages.
  Example: affects=package1,package2@1.0.0,package3@2.0.0 or affects[]=package1&affects[]=package2@1.0.0

- **`published`** (string)
  If specified, only return advisories that were published on a date or date range.
  For more information on the syntax of the date range, see "Understanding the search syntax."

- **`updated`** (string)
  If specified, only return advisories that were updated on a date or date range.
  For more information on the syntax of the date range, see "Understanding the search syntax."

- **`modified`** (string)
  If specified, only show advisories that were updated or published on a date or date range.
  For more information on the syntax of the date range, see "Understanding the search syntax."

- **`epss_percentage`** (string)
  If specified, only return advisories that have an EPSS percentage score that matches the provided value.
  The EPSS percentage represents the likelihood of a CVE being exploited.

- **`epss_percentile`** (string)
  If specified, only return advisories that have an EPSS percentile score that matches the provided value.
  The EPSS percentile represents the relative rank of the CVE's likelihood of being exploited compared to other CVEs.

- **`before`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results before this cursor. For more information, see "Using pagination in the REST API."

- **`after`** (string)
  A cursor, as given in the Link header. If specified, the query only searches for results after this cursor. For more information, see "Using pagination in the REST API."

- **`direction`** (string)
  The direction to sort the results by.
  Default: `desc`
  Can be one of: `asc`, `desc`

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`sort`** (string)
  The property to sort the results by.
  Default: `published`
  Can be one of: `updated`, `published`, `epss_percentage`, `epss_percentile`

### HTTP response status codes

- **200** - OK

- **422** - Validation failed, or the endpoint has been spammed.

- **429** - Too many requests

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/advisories
```

**Response schema (Status: 200):**

Array of objects:
  * `ghsa_id`: required, string, read-only
  * `cve_id`: required, string or null, read-only
  * `url`: required, string, read-only
  * `html_url`: required, string, format: uri, read-only
  * `repository_advisory_url`: required, string or null, format: uri, read-only
  * `summary`: required, string, maxLength: 1024
  * `description`: required, string or null, maxLength: 65535
  * `type`: required, string, enum: `reviewed`, `unreviewed`, `malware`, read-only
  * `severity`: required, string, enum: `critical`, `high`, `medium`, `low`, `unknown`
  * `source_code_location`: required, string or null, format: uri
  * `identifiers`: required, array of objects or null:
    * `type`: required, string, enum: `CVE`, `GHSA`
    * `value`: required, string
  * `references`: required, array of string or null
  * `published_at`: required, string, format: date-time, read-only
  * `updated_at`: required, string, format: date-time, read-only
  * `github_reviewed_at`: required, string or null, format: date-time, read-only
  * `nvd_published_at`: required, string or null, format: date-time, read-only
  * `withdrawn_at`: required, string or null, format: date-time, read-only
  * `vulnerabilities`: required, array of objects or null:
    * `package`: required, object or null:
      * `ecosystem`: required, string, enum: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`
      * `name`: required, string or null
    * `vulnerable_version_range`: required, string or null
    * `first_patched_version`: required, string or null
    * `vulnerable_functions`: required, array of string or null
  * `cvss_severities`: object or null:
    * `cvss_v3`: object or null:
      * `vector_string`: required, string or null
      * `score`: required, number or null, read-only, minimum: 0, maximum: 10
    * `cvss_v4`: object or null:
      * `vector_string`: required, string or null
      * `score`: required, number or null, read-only, minimum: 0, maximum: 10
  * `epss`: object or null, read-only:
    * `percentage`: number, minimum: 0, maximum: 100
    * `percentile`: number, minimum: 0, maximum: 100
  * `cwes`: required, array of objects or null:
    * `cwe_id`: required, string
    * `name`: required, string, read-only
  * `credits`: required, array of objects or null:
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
    * `type`: required, string, enum: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`

## Get a global security advisory

```
GET /advisories/{ghsa_id}
```

Gets a global security advisory using its GitHub Security Advisory (GHSA) identifier.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`ghsa_id`** (string) (required)
  The GHSA (GitHub Security Advisory) identifier of the advisory.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/advisories/GHSA_ID
```

**Response schema (Status: 200):**

* `ghsa_id`: required, string, read-only
* `cve_id`: required, string or null, read-only
* `url`: required, string, read-only
* `html_url`: required, string, format: uri, read-only
* `repository_advisory_url`: required, string or null, format: uri, read-only
* `summary`: required, string, maxLength: 1024
* `description`: required, string or null, maxLength: 65535
* `type`: required, string, enum: `reviewed`, `unreviewed`, `malware`, read-only
* `severity`: required, string, enum: `critical`, `high`, `medium`, `low`, `unknown`
* `source_code_location`: required, string or null, format: uri
* `identifiers`: required, array of objects or null:
  * `type`: required, string, enum: `CVE`, `GHSA`
  * `value`: required, string
* `references`: required, array of string or null
* `published_at`: required, string, format: date-time, read-only
* `updated_at`: required, string, format: date-time, read-only
* `github_reviewed_at`: required, string or null, format: date-time, read-only
* `nvd_published_at`: required, string or null, format: date-time, read-only
* `withdrawn_at`: required, string or null, format: date-time, read-only
* `vulnerabilities`: required, array of objects or null:
  * `package`: required, object or null:
    * `ecosystem`: required, string, enum: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `other`, `swift`
    * `name`: required, string or null
  * `vulnerable_version_range`: required, string or null
  * `first_patched_version`: required, string or null
  * `vulnerable_functions`: required, array of string or null
* `cvss_severities`: object or null:
  * `cvss_v3`: object or null:
    * `vector_string`: required, string or null
    * `score`: required, number or null, read-only, minimum: 0, maximum: 10
  * `cvss_v4`: object or null:
    * `vector_string`: required, string or null
    * `score`: required, number or null, read-only, minimum: 0, maximum: 10
* `epss`: object or null, read-only:
  * `percentage`: number, minimum: 0, maximum: 100
  * `percentile`: number, minimum: 0, maximum: 100
* `cwes`: required, array of objects or null:
  * `cwe_id`: required, string
  * `name`: required, string, read-only
* `credits`: required, array of objects or null:
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
  * `type`: required, string, enum: `analyst`, `finder`, `reporter`, `coordinator`, `remediation_developer`, `remediation_reviewer`, `remediation_verifier`, `tool`, `sponsor`, `other`
