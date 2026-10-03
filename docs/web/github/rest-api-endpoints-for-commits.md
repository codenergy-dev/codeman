---
title: REST API endpoints for commits
url: https://docs.github.com/en/rest/commits/commits
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for commits

Use the REST API to interact with commits.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List commits

```
GET /repos/{owner}/{repo}/commits
```

Signature verification object
The response will include a verification object that describes the result of verifying the commit's signature. The following fields are included in the verification object:

NameTypeDescriptionverifiedbooleanIndicates whether GitHub considers the signature in this commit to be verified.reasonstringThe reason for verified value. Possible values and their meanings are enumerated in table below.signaturestringThe signature that was extracted from the commit.payloadstringThe value that was signed.verified_atstringThe date the signature was verified by GitHub.
These are the possible values for reason in the verification object:

ValueDescriptionexpired_keyThe key that made the signature is expired.not_signing_keyThe "signing" flag is not among the usage flags in the GPG key that made the signature.gpgverify_errorThere was an error communicating with the signature verification service.gpgverify_unavailableThe signature verification service is currently unavailable.unsignedThe object does not include a signature.unknown_signature_typeA non-PGP signature was found in the commit.no_userNo user was associated with the committer email address in the commit.unverified_emailThe committer email address in the commit was associated with a user, but the email address is not verified on their account.bad_emailThe committer email address in the commit is not included in the identities of the PGP key that made the signature.unknown_keyThe key that made the signature has not been registered with any user's account.malformed_signatureThere was an error parsing the signature.invalidThe signature could not be cryptographically verified using the key whose key-id was found in the signature.validNone of the above errors applied, so the signature is considered to be verified.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`sha`** (string)
  SHA or branch to start listing commits from. Default: the repository’s default branch (usually main).

- **`path`** (string)
  Only commits containing this file path will be returned.

- **`author`** (string)
  GitHub username or email address to use to filter by commit author.

- **`committer`** (string)
  GitHub username or email address to use to filter by commit committer.

- **`since`** (string)
  Only show results that were last updated after the given time. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ. Due to limitations of Git, timestamps must be between 1970-01-01 and 2099-12-31 (inclusive) or unexpected results may be returned.

- **`until`** (string)
  Only commits before this date will be returned. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ. Due to limitations of Git, timestamps must be between 1970-01-01 and 2099-12-31 (inclusive) or unexpected results may be returned.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

- **400** - Bad Request

- **404** - Resource not found

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

- **429** - The request could not be processed due to heavy server load. Please try again.

- **500** - Internal Error

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/commits
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

## List branches for HEAD commit

```
GET /repos/{owner}/{repo}/commits/{commit_sha}/branches-where-head
```

Protected branches are available in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, GitHub Enterprise Cloud, and GitHub Enterprise Server. For more information, see GitHub's products in the GitHub Help documentation.
Returns all branches where the given commit SHA is the HEAD, or latest commit for the branch.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`commit_sha`** (string) (required)
  The SHA of the commit.

### HTTP response status codes

- **200** - OK

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/commits/COMMIT_SHA/branches-where-head
```

**Response schema (Status: 200):**

Array of `Branch Short`:
  * `name`: required, string
  * `commit`: required, object:
    * `sha`: required, string
    * `url`: required, string
  * `protected`: required, boolean

## List pull requests associated with a commit

```
GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls
```

Lists the merged pull request that introduced the commit to the repository. If the commit is not present in the default branch, it will return merged and open pull requests associated with the commit.
To list the open or merged pull requests associated with a branch, you can set the commit_sha parameter to the branch name.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`commit_sha`** (string) (required)
  The SHA of the commit.

- **`per_page`** (integer)
  The number of results per page (max 100). For more information, see "Using pagination in the REST API."
  Default: `30`

- **`page`** (integer)
  The page number of the results to fetch. For more information, see "Using pagination in the REST API."
  Default: `1`

### HTTP response status codes

- **200** - OK

- **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/commits/COMMIT_SHA/pulls
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

## Get a commit

```
GET /repos/{owner}/{repo}/commits/{ref}
```

Returns the contents of a single commit reference. You must have read access for the repository to use this endpoint.
Note

If there are more than 300 files in the commit diff and the default JSON media type is requested, the response will include pagination link headers for the remaining files, up to a limit of 3000 files. Each page contains the static commit information, and the only changes are to the file listing.

This endpoint supports the following custom media types. For more information, see "Media types." Pagination query parameters are not supported for these media types.

application/vnd.github.diff: Returns the diff of the commit. Larger diffs may time out and return a 5xx status code.
application/vnd.github.patch: Returns the patch of the commit. Diffs with binary data will have no patch property. Larger diffs may time out and return a 5xx status code.
application/vnd.github.sha: Returns the commit's SHA-1 hash. You can use this endpoint to check if a remote reference's SHA-1 hash is the same as your local reference's SHA-1 hash by providing the local SHA-1 reference as the ETag.

Signature verification object
The response will include a verification object that describes the result of verifying the commit's signature. The following fields are included in the verification object:

NameTypeDescriptionverifiedbooleanIndicates whether GitHub considers the signature in this commit to be verified.reasonstringThe reason for verified value. Possible values and their meanings are enumerated in table below.signaturestringThe signature that was extracted from the commit.payloadstringThe value that was signed.verified_atstringThe date the signature was verified by GitHub.
These are the possible values for reason in the verification object:

ValueDescriptionexpired_keyThe key that made the signature is expired.not_signing_keyThe "signing" flag is not among the usage flags in the GPG key that made the signature.gpgverify_errorThere was an error communicating with the signature verification service.gpgverify_unavailableThe signature verification service is currently unavailable.unsignedThe object does not include a signature.unknown_signature_typeA non-PGP signature was found in the commit.no_userNo user was associated with the committer email address in the commit.unverified_emailThe committer email address in the commit was associated with a user, but the email address is not verified on their account.bad_emailThe committer email address in the commit is not included in the identities of the PGP key that made the signature.unknown_keyThe key that made the signature has not been registered with any user's account.malformed_signatureThere was an error parsing the signature.invalidThe signature could not be cryptographically verified using the key whose key-id was found in the signature.validNone of the above errors applied, so the signature is considered to be verified.

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

- **`ref`** (string) (required)
  The commit reference. Can be a commit SHA, branch name (heads/BRANCH_NAME), or tag name (tags/TAG_NAME). For more information, see "Git References" in the Git documentation.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

- **429** - The request could not be processed due to heavy server load. Please try again.

- **500** - Internal Error

- **503** - Service unavailable

### Code examples

#### Example 1: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/commits/REF
```

**Response schema (Status: 200):**

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

#### Example 2: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/commits/REF
```

**Response schema (Status: 200):**

string

#### Example 3: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/commits/REF
```

**Response schema (Status: 200):**

string

#### Example 4: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/commits/REF
```

**Response schema (Status: 200):**

string

## Compare two commits

```
GET /repos/{owner}/{repo}/compare/{basehead}
```

Compares two commits against one another. You can compare refs (branches or tags) and commit SHAs in the same repository, or you can compare refs and commit SHAs that exist in different repositories within the same repository network, including fork branches. For more information about how to view a repository's network, see "Understanding connections between repositories."
This endpoint is equivalent to running the git log BASE..HEAD command, but it returns commits in a different order. The git log BASE..HEAD command returns commits in reverse chronological order, whereas the API returns commits in chronological order.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.diff: Returns the diff of the commit.
application/vnd.github.patch: Returns the patch of the commit. Diffs with binary data will have no patch property.

The API response includes details about the files that were changed between the two commits. This includes the status of the change (if a file was added, removed, modified, or renamed), and details of the change itself. For example, files with a renamed status have a previous_filename field showing the previous filename of the file, and files with a modified status have a patch field showing the changes made to the file.
When calling this endpoint without any paging parameter (per_page or page), the returned list is limited to 250 commits, and the last commit in the list is the most recent of the entire comparison.
Working with large comparisons
To process a response with a large number of commits, use a query parameter (per_page or page) to paginate the results. When using pagination:

The list of changed files is only shown on the first page of results, and it includes up to 300 changed files for the entire comparison.
The results are returned in chronological order, but the last commit in the returned list may not be the most recent one in the entire set if there are more pages of results.

For more information on working with pagination, see "Using pagination in the REST API."
Signature verification object
The response will include a verification object that describes the result of verifying the commit's signature. The verification object includes the following fields:

NameTypeDescriptionverifiedbooleanIndicates whether GitHub considers the signature in this commit to be verified.reasonstringThe reason for verified value. Possible values and their meanings are enumerated in table below.signaturestringThe signature that was extracted from the commit.payloadstringThe value that was signed.verified_atstringThe date the signature was verified by GitHub.
These are the possible values for reason in the verification object:

ValueDescriptionexpired_keyThe key that made the signature is expired.not_signing_keyThe "signing" flag is not among the usage flags in the GPG key that made the signature.gpgverify_errorThere was an error communicating with the signature verification service.gpgverify_unavailableThe signature verification service is currently unavailable.unsignedThe object does not include a signature.unknown_signature_typeA non-PGP signature was found in the commit.no_userNo user was associated with the committer email address in the commit.unverified_emailThe committer email address in the commit was associated with a user, but the email address is not verified on their account.bad_emailThe committer email address in the commit is not included in the identities of the PGP key that made the signature.unknown_keyThe key that made the signature has not been registered with any user's account.malformed_signatureThere was an error parsing the signature.invalidThe signature could not be cryptographically verified using the key whose key-id was found in the signature.validNone of the above errors applied, so the signature is considered to be verified.

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

- **`basehead`** (string) (required)
  The base branch and head branch to compare. This parameter expects the format BASE...HEAD. Both must be branch names in repo. To compare with a branch that exists in a different repository in the same network as repo, the basehead parameter expects the format USERNAME:BASE...USERNAME:HEAD.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

- **500** - Internal Error

- **503** - Service unavailable

### Code examples

#### Example 1: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/compare/BASEHEAD
```

**Response schema (Status: 200):**

* `url`: required, string, format: uri
* `html_url`: required, string, format: uri
* `permalink_url`: required, string, format: uri
* `diff_url`: required, string, format: uri
* `patch_url`: required, string, format: uri
* `base_commit`: required, `Commit`:
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
* `merge_base_commit`: required, `Commit` (see above)
* `status`: required, string, enum: `diverged`, `ahead`, `behind`, `identical`
* `ahead_by`: required, integer
* `behind_by`: required, integer
* `total_commits`: required, integer
* `commits`: required, array of `Commit` (see above)
* `files`: array of `Diff Entry` (see above)

#### Example 2: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/compare/BASEHEAD
```

**Response schema (Status: 200):**

Same response schema as [Get a commit](#get-a-commit).

#### Example 3: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/compare/BASEHEAD
```

**Response schema (Status: 200):**

Same response schema as [Get a commit](#get-a-commit).