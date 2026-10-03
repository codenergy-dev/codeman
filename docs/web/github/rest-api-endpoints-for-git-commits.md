---
title: REST API endpoints for Git commits
url: https://docs.github.com/en/rest/git/commits
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for Git commits

Use the REST API to interact with commit objects in your Git database on GitHub.

## About Git commits

A Git commit is a snapshot of the hierarchy ([Git tree](/en/rest/git/trees)) and the contents of the files ([Git blob](/en/rest/git/blobs)) in a Git repository. These endpoints allow you to read and write [commit objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects#_git_commit_objects) to your Git database on GitHub.

> \[!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Create a commit

```
POST /repos/{owner}/{repo}/git/commits
```

Creates a new Git commit object.
Signature verification object
The response will include a verification object that describes the result of verifying the commit's signature. The following fields are included in the verification object:

NameTypeDescriptionverifiedbooleanIndicates whether GitHub considers the signature in this commit to be verified.reasonstringThe reason for verified value. Possible values and their meanings are enumerated in the table below\.signaturestringThe signature that was extracted from the commit.payloadstringThe value that was signed.verified\_atstringThe date the signature was verified by GitHub.
These are the possible values for reason in the verification object:

ValueDescriptionexpired\_keyThe key that made the signature is expired.not\_signing\_keyThe "signing" flag is not among the usage flags in the GPG key that made the signature.gpgverify\_errorThere was an error communicating with the signature verification service.gpgverify\_unavailableThe signature verification service is currently unavailable.unsignedThe object does not include a signature.unknown\_signature\_typeA non-PGP signature was found in the commit.no\_userNo user was associated with the committer email address in the commit.unverified\_emailThe committer email address in the commit was associated with a user, but the email address is not verified on their account.bad\_emailThe committer email address in the commit is not included in the identities of the PGP key that made the signature.unknown\_keyThe key that made the signature has not been registered with any user's account.malformed\_signatureThere was an error parsing the signature.invalidThe signature could not be cryptographically verified using the key whose key-id was found in the signature.validNone of the above errors applied, so the signature is considered to be verified.

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

* **`message`** (string) (required)
  The commit message

* **`tree`** (string) (required)
  The SHA of the tree object this commit points to

* **`parents`** (array of strings)
  The full SHAs of the commits that were the parents of this commit. If omitted or empty, the commit will be written as a root commit. For a single parent, an array of one SHA should be provided; for a merge commit, an array of more than one should be provided.

* **`author`** (object)
  Information about the author of the commit. By default, the author will be the authenticated user and the current date. See the author and committer object below for details.
  * **`name`** (string) (required)
    The name of the author (or committer) of the commit
  * **`email`** (string) (required)
    The email of the author (or committer) of the commit
  * **`date`** (string)
    Indicates when this commit was authored (or committed). This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

* **`committer`** (object)
  Information about the person who is making the commit. By default, committer will use the information set in author. See the author and committer object below for details.
  * **`name`** (string)
    The name of the author (or committer) of the commit
  * **`email`** (string)
    The email of the author (or committer) of the commit
  * **`date`** (string)
    Indicates when this commit was authored (or committed). This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

* **`signature`** (string)
  The PGP signature of the commit. GitHub adds the signature to the gpgsig header of the created commit. For a commit signature to be verifiable by Git or GitHub, it must be an ASCII-armored detached PGP signature over the string commit as it would be written to the object database. To pass a signature parameter, you need to first manually create a valid PGP signature, which can be complicated. You may find it easier to use the command line to create signed commits.

### HTTP response status codes

* **201** - Created

* **404** - Resource not found

* **409** - Conflict

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/git/commits \
  -d '{
  "message": "my commit message",
  "author": {
    "name": "Mona Octocat",
    "email": "octocat@github.com",
    "date": "2008-07-09T16:13:30+12:00"
  },
  "parents": [
    "7d1b31e74ee336d15cbd21741bc88a537ed063a0"
  ],
  "tree": "827efc6d56897b048c772eb4087f854f46256132",
  "signature": "-----BEGIN PGP SIGNATURE-----\n\niQIzBAABAQAdFiEESn/54jMNIrGSE6Tp6cQjvhfv7nAFAlnT71cACgkQ6cQjvhfv\n7nCWwA//XVqBKWO0zF+bZl6pggvky3Oc2j1pNFuRWZ29LXpNuD5WUGXGG209B0hI\nDkmcGk19ZKUTnEUJV2Xd0R7AW01S/YSub7OYcgBkI7qUE13FVHN5ln1KvH2all2n\n2+JCV1HcJLEoTjqIFZSSu/sMdhkLQ9/NsmMAzpf/iIM0nQOyU4YRex9eD1bYj6nA\nOQPIDdAuaTQj1gFPHYLzM4zJnCqGdRlg0sOM/zC5apBNzIwlgREatOYQSCfCKV7k\nnrU34X8b9BzQaUx48Qa+Dmfn5KQ8dl27RNeWAqlkuWyv3pUauH9UeYW+KyuJeMkU\n+NyHgAsWFaCFl23kCHThbLStMZOYEnGagrd0hnm1TPS4GJkV4wfYMwnI4KuSlHKB\njHl3Js9vNzEUQipQJbgCgTiWvRJoK3ENwBTMVkKHaqT4x9U4Jk/XZB6Q8MA09ezJ\n3QgiTjTAGcum9E9QiJqMYdWQPWkaBIRRz5cET6HPB48YNXAAUsfmuYsGrnVLYbG+\nUpC6I97VybYHTy2O9XSGoaLeMI9CsFn38ycAxxbWagk5mhclNTP5mezIq6wKSwmr\nX11FW3n1J23fWZn5HJMBsRnUCgzqzX3871IqLYHqRJ/bpZ4h20RhTyPj5c/z7QXp\neSakNQMfbbMcljkha+ZMuVQX1K9aRlVqbmv3ZMWh+OijLYVU2bc=\n=5Io4\n-----END PGP SIGNATURE-----\n"
}'
```

**Response schema (Status: 201):**

* `sha`: required, string
* `node_id`: required, string
* `url`: required, string, format: uri
* `author`: required, object:
  * `date`: required, string, format: date-time
  * `email`: required, string
  * `name`: required, string
* `committer`: required, object:
  * `date`: required, string, format: date-time
  * `email`: required, string
  * `name`: required, string
* `message`: required, string
* `tree`: required, object:
  * `sha`: required, string
  * `url`: required, string, format: uri
* `parents`: required, array of objects:
  * `sha`: required, string
  * `url`: required, string, format: uri
  * `html_url`: required, string, format: uri
* `verification`: required, object:
  * `verified`: required, boolean
  * `reason`: required, string
  * `signature`: required, string or null
  * `payload`: required, string or null
  * `verified_at`: required, string or null
* `html_url`: required, string, format: uri

## Get a commit object

```
GET /repos/{owner}/{repo}/git/commits/{commit_sha}
```

Gets a Git commit object.
To get the contents of a commit, see "Get a commit."
Signature verification object
The response will include a verification object that describes the result of verifying the commit's signature. The following fields are included in the verification object:

NameTypeDescriptionverifiedbooleanIndicates whether GitHub considers the signature in this commit to be verified.reasonstringThe reason for verified value. Possible values and their meanings are enumerated in the table below\.signaturestringThe signature that was extracted from the commit.payloadstringThe value that was signed.verified\_atstringThe date the signature was verified by GitHub.
These are the possible values for reason in the verification object:

ValueDescriptionexpired\_keyThe key that made the signature is expired.not\_signing\_keyThe "signing" flag is not among the usage flags in the GPG key that made the signature.gpgverify\_errorThere was an error communicating with the signature verification service.gpgverify\_unavailableThe signature verification service is currently unavailable.unsignedThe object does not include a signature.unknown\_signature\_typeA non-PGP signature was found in the commit.no\_userNo user was associated with the committer email address in the commit.unverified\_emailThe committer email address in the commit was associated with a user, but the email address is not verified on their account.bad\_emailThe committer email address in the commit is not included in the identities of the PGP key that made the signature.unknown\_keyThe key that made the signature has not been registered with any user's account.malformed\_signatureThere was an error parsing the signature.invalidThe signature could not be cryptographically verified using the key whose key-id was found in the signature.validNone of the above errors applied, so the signature is considered to be verified.

### Parameters

#### Headers

* **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

* **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

* **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

* **`commit_sha`** (string) (required)
  The SHA of the commit.

### HTTP response status codes

* **200** - OK

* **404** - Resource not found

* **409** - Conflict

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/git/commits/COMMIT_SHA
```

**Response schema (Status: 200):**

Same response schema as [Create a commit](#create-a-commit).