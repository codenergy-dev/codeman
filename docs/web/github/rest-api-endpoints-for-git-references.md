---
title: REST API endpoints for Git references
url: https://docs.github.com/en/rest/git/refs
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for Git references

Use the REST API to interact with references in your Git database on GitHub

## About Git references

A Git reference (`git ref`) is a file that contains a Git commit SHA-1 hash. When referring to a Git commit, you can use the Git reference, which is an easy-to-remember name, rather than the hash. The Git reference can be rewritten to point to a new commit. A branch is a Git reference that stores the new Git commit hash. These endpoints allow you to read and write [references](https://git-scm.com/book/en/v2/Git-Internals-Git-References) to your Git database on GitHub.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## List matching references

```
GET /repos/{owner}/{repo}/git/matching-refs/{ref}
```

Returns an array of references from your Git database that match the supplied name. The :ref in the URL must be formatted as heads/<branch name> for branches and tags/<tag name> for tags. If the :ref doesn't exist in the repository, but existing refs start with :ref, they will be returned as an array.
When you use this endpoint without providing a :ref, it will return an array of all the references from your Git database, including notes and stashes if they exist on the server. Anything in the namespace is returned, not just heads and tags.
Note

You need to explicitly request a pull request to trigger a test merge commit, which checks the mergeability of pull requests. For more information, see "Checking mergeability of pull requests".

If you request matching references for a branch named feature but the branch feature doesn't exist, the response can still include other matching head refs that start with the word feature, such as featureA and featureB.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ref`** (string) (required)
  The Git reference. For more information, see "Git References" in the Git documentation.

### HTTP response status codes

- **200** - OK

- **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/git/matching-refs/REF
```

**Response schema (Status: 200):**

Array of `Git Reference`:
  * `ref`: required, string
  * `node_id`: required, string
  * `url`: required, string, format: uri
  * `object`: required, object:
    * `type`: required, string
    * `sha`: required, string, minLength: 40, maxLength: 40
    * `url`: required, string, format: uri

## Get a reference

```
GET /repos/{owner}/{repo}/git/ref/{ref}
```

Returns a single reference from your Git database. The :ref in the URL must be formatted as heads/<branch name> for branches and tags/<tag name> for tags. If the :ref doesn't match an existing ref, a 404 is returned.
Note

You need to explicitly request a pull request to trigger a test merge commit, which checks the mergeability of pull requests. For more information, see "Checking mergeability of pull requests".

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ref`** (string) (required)
  The Git reference. For more information, see "Git References" in the Git documentation.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/git/ref/REF
```

**Response schema (Status: 200):**

* `ref`: required, string
* `node_id`: required, string
* `url`: required, string, format: uri
* `object`: required, object:
  * `type`: required, string
  * `sha`: required, string, minLength: 40, maxLength: 40
  * `url`: required, string, format: uri

## Create a reference

```
POST /repos/{owner}/{repo}/git/refs
```

Creates a reference for your repository. You are unable to create new references for empty repositories, even if the commit SHA-1 hash used exists. Empty repositories are repositories without branches.

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

- **`ref`** (string) (required)
  The name of the fully qualified reference (ie: refs/heads/master). If it doesn't start with 'refs' and have at least two slashes, it will be rejected.

- **`sha`** (string) (required)
  The SHA1 value for this reference.

### HTTP response status codes

- **201** - Created

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/git/refs \
  -d '{
  "ref": "refs/heads/featureA",
  "sha": "aa218f56b14c9653891f9e74264a383fa43fefbd"
}'
```

**Response schema (Status: 201):**

Same response schema as [Get a reference](#get-a-reference).

## Update a reference

```
PATCH /repos/{owner}/{repo}/git/refs/{ref}
```

Updates the provided reference to point to a new SHA. For more information, see "Git References" in the Git documentation.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ref`** (string) (required)
  The Git reference. For more information, see "Git References" in the Git documentation.

#### Body parameters

- **`sha`** (string) (required)
  The SHA1 value to set this reference to

- **`force`** (boolean)
  Indicates whether to force the update or to make sure the update is a fast-forward update. Leaving this out or setting it to false will make sure you're not overwriting work.
  Default: `false`

### HTTP response status codes

- **200** - OK

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X PATCH \
  https://api.github.com/repos/OWNER/REPO/git/refs/REF \
  -d '{
  "sha": "aa218f56b14c9653891f9e74264a383fa43fefbd",
  "force": true
}'
```

**Response schema (Status: 200):**

Same response schema as [Get a reference](#get-a-reference).

## Delete a reference

```
DELETE /repos/{owner}/{repo}/git/refs/{ref}
```

Deletes the provided reference.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ref`** (string) (required)
  The Git reference. For more information, see "Git References" in the Git documentation.

### HTTP response status codes

- **204** - No Content

- **409** - Conflict

- **422** - Validation failed, an attempt was made to delete the default branch, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/git/refs/REF
```

**Response schema (Status: 204):**