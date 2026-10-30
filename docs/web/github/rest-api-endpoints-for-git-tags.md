---
title: "REST API endpoints for Git tags"
url: https://docs.github.com/en/rest/git/tags
created_at: 2026-10-30T11:47:44-03:00
updated_at: 2026-10-30T11:47:44-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for Git tags

Use the REST API to interact with tag objects in your Git database on GitHub.

## About Git tags

A Git tag is similar to a [Git reference](/en/rest/git/refs), but the Git commit that it points to never changes. Git tags are helpful when you want to point to specific releases. These endpoints allow you to read and write [tag objects](https://git-scm.com/book/en/v2/Git-Internals-Git-References#_tags) to your Git database on GitHub. The API only supports [annotated tag objects](https://git-scm.com/book/en/v2/Git-Internals-Git-References#_tags), not lightweight tags.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Create a tag object

```
POST /repos/{owner}/{repo}/git/tags
```

Note that creating a tag object does not create the reference that makes a tag in Git. If you want to create an annotated tag in Git, you have to do this call to create the tag object, and then create the refs/tags/\[tag] reference. If you want to create a lightweight tag, you only have to create the tag reference - this call would be unnecessary.
Signature verification object
The response will include a verification object that describes the result of verifying the commit's signature. The following fields are included in the verification object:

NameTypeDescriptionverifiedbooleanIndicates whether GitHub considers the signature in this commit to be verified.reasonstringThe reason for verified value. Possible values and their meanings are enumerated in table below\.signaturestringThe signature that was extracted from the commit.payloadstringThe value that was signed.verified\_atstringThe date the signature was verified by GitHub.
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

* **`tag`** (string) (required)
  The tag's name. This is typically a version (e.g., "v0.0.1").

* **`message`** (string) (required)
  The tag message.

* **`object`** (string) (required)
  The SHA of the git object this is tagging.

* **`type`** (string) (required)
  The type of the object we're tagging. Normally this is a commit but it can also be a tree or a blob.
  Can be one of: `commit`, `tree`, `blob`

* **`tagger`** (object)
  An object with information about the individual creating the tag.
  * **`name`** (string) (required)
    The name of the author of the tag
  * **`email`** (string) (required)
    The email of the author of the tag
  * **`date`** (string)
    When this object was tagged. This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ.

### HTTP response status codes

* **201** - Created

* **409** - Conflict

* **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/git/tags \
  -d '{
  "tag": "v0.0.1",
  "message": "initial version",
  "object": "c3d0be41ecbe669545ee3e94d31ed9a4bc91ee3c",
  "type": "commit",
  "tagger": {
    "name": "Monalisa Octocat",
    "email": "octocat@github.com",
    "date": "2011-06-17T14:53:35-07:00"
  }
}'
```

**Response schema (Status: 201):**

* `node_id`: required, string
* `tag`: required, string
* `sha`: required, string
* `url`: required, string, format: uri
* `message`: required, string
* `tagger`: required, object:
  * `date`: required, string
  * `email`: required, string
  * `name`: required, string
* `object`: required, object:
  * `sha`: required, string
  * `type`: required, string
  * `url`: required, string, format: uri
* `verification`: `Verification`:
  * `verified`: required, boolean
  * `reason`: required, string
  * `payload`: required, string or null
  * `signature`: required, string or null
  * `verified_at`: required, string or null

## Get a tag

```
GET /repos/{owner}/{repo}/git/tags/{tag_sha}
```

Signature verification object
The response will include a verification object that describes the result of verifying the commit's signature. The following fields are included in the verification object:

NameTypeDescriptionverifiedbooleanIndicates whether GitHub considers the signature in this commit to be verified.reasonstringThe reason for verified value. Possible values and their meanings are enumerated in table below\.signaturestringThe signature that was extracted from the commit.payloadstringThe value that was signed.verified\_atstringThe date the signature was verified by GitHub.
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

* **`tag_sha`** (string) (required)

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
  https://api.github.com/repos/OWNER/REPO/git/tags/TAG_SHA
```

**Response schema (Status: 200):**

Same response schema as [Create a tag object](#create-a-tag-object).
