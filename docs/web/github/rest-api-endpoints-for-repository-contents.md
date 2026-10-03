---
title: REST API endpoints for repository contents
url: https://docs.github.com/en/rest/repos/contents
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for repository contents

Use the REST API to create, modify, and delete Base64 encoded content in a repository.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Get repository content

```
GET /repos/{owner}/{repo}/contents/{path}
```

Gets the contents of a file or directory in a repository. Specify the file path or directory with the path parameter. If you omit the path parameter, you will receive the contents of the repository's root directory.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw file contents for files and symlinks.
application/vnd.github.html+json: Returns the file contents in HTML. Markup languages are rendered to HTML using GitHub's open-source Markup library.
application/vnd.github.object+json: Returns the contents in a consistent object format regardless of the content type. For example, instead of an array of objects for a directory, the response will be an object with an entries attribute containing the array of objects.

If the content is a directory: The response will be an array of objects, one object for each item in the directory.
If the content is a symlink and the symlink's target is a normal file in the repository, then the API responds with the content of the file. Otherwise, the API responds with an object describing the symlink itself.
If the content is a submodule, the submodule_git_url field identifies the location of the submodule repository, and the sha identifies a specific commit within the submodule repository. Git uses the given URL when cloning the submodule repository, and checks out the submodule at that specific commit. If the submodule repository is not hosted on github.com, the Git URLs (git_url and _links["git"]) and the github.com URLs (html_url and _links["html"]) will have null values.
Notes:

To get a repository's contents recursively, you can recursively get the tree.
This API has an upper limit of 1,000 files for a directory. If you need to retrieve
more files, use the Git Trees API.
Download URLs expire and are meant to be used just once. To ensure the download URL does not expire, please use the contents API to obtain a fresh download URL for each download.
If the requested file's size is:

1 MB or smaller: All features of this endpoint are supported.
Between 1-100 MB: Only the raw or object custom media types are supported. Both will work as normal, except that when using the object media type, the content field will be an empty
string and the encoding field will be "none". To get the contents of these larger files, use the raw media type.
Greater than 100 MB: This endpoint is not supported.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`path`** (string) (required)
  path parameter

- **`ref`** (string)
  The name of the commit/branch/tag. Default: the repository’s default branch.

### HTTP response status codes

- **200** - OK

- **302** - Found

- **304** - Not modified

- **403** - Forbidden

- **404** - Resource not found

### Code examples

#### Content is a file using the object media type

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/contents/PATH
```

**Response schema (Status: 200):**

* `type`: required, string
* `size`: required, integer
* `name`: required, string
* `path`: required, string
* `sha`: required, string
* `content`: string
* `url`: required, string, format: uri
* `git_url`: required, string or null, format: uri
* `html_url`: required, string or null, format: uri
* `download_url`: required, string or null, format: uri
* `entries`: array of objects:
  * `type`: required, string
  * `size`: required, integer
  * `name`: required, string
  * `path`: required, string
  * `sha`: required, string
  * `url`: required, string, format: uri
  * `git_url`: required, string or null, format: uri
  * `html_url`: required, string or null, format: uri
  * `download_url`: required, string or null, format: uri
  * `_links`: required, object:
    * `git`: required, string or null, format: uri
    * `html`: required, string or null, format: uri
    * `self`: required, string, format: uri
* `encoding`: string
* `_links`: required, object:
  * `git`: required, string or null, format: uri
  * `html`: required, string or null, format: uri
  * `self`: required, string, format: uri

#### Content is a directory using the object media type

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/contents/PATH
```

**Response schema (Status: 200):**

* `type`: required, string
* `size`: required, integer
* `name`: required, string
* `path`: required, string
* `sha`: required, string
* `content`: string
* `url`: required, string, format: uri
* `git_url`: required, string or null, format: uri
* `html_url`: required, string or null, format: uri
* `download_url`: required, string or null, format: uri
* `entries`: array of objects:
  * `type`: required, string
  * `size`: required, integer
  * `name`: required, string
  * `path`: required, string
  * `sha`: required, string
  * `url`: required, string, format: uri
  * `git_url`: required, string or null, format: uri
  * `html_url`: required, string or null, format: uri
  * `download_url`: required, string or null, format: uri
  * `_links`: required, object:
    * `git`: required, string or null, format: uri
    * `html`: required, string or null, format: uri
    * `self`: required, string, format: uri
* `encoding`: string
* `_links`: required, object:
  * `git`: required, string or null, format: uri
  * `html`: required, string or null, format: uri
  * `self`: required, string, format: uri

#### Content is a file

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/contents/PATH
```

**Response schema (Status: 200):**

* one of:
  * **Content Directory**
  * **Content File**
    * `type`: required, string, enum: `file`
    * `encoding`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `content`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
    * `target`: string
    * `submodule_git_url`: string
  * **Symlink Content**
    * `type`: required, string, enum: `symlink`
    * `target`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
  * **Submodule Content**
    * `type`: required, string, enum: `submodule`
    * `submodule_git_url`: required, string, format: uri
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri

#### Content is a directory

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/contents/PATH
```

**Response schema (Status: 200):**

* one of:
  * **Content Directory**
  * **Content File**
    * `type`: required, string, enum: `file`
    * `encoding`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `content`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
    * `target`: string
    * `submodule_git_url`: string
  * **Symlink Content**
    * `type`: required, string, enum: `symlink`
    * `target`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
  * **Submodule Content**
    * `type`: required, string, enum: `submodule`
    * `submodule_git_url`: required, string, format: uri
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri

#### Content is a symlink

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/contents/PATH
```

**Response schema (Status: 200):**

* one of:
  * **Content Directory**
  * **Content File**
    * `type`: required, string, enum: `file`
    * `encoding`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `content`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
    * `target`: string
    * `submodule_git_url`: string
  * **Symlink Content**
    * `type`: required, string, enum: `symlink`
    * `target`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
  * **Submodule Content**
    * `type`: required, string, enum: `submodule`
    * `submodule_git_url`: required, string, format: uri
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri

#### Content is a submodule

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/contents/PATH
```

**Response schema (Status: 200):**

* one of:
  * **Content Directory**
  * **Content File**
    * `type`: required, string, enum: `file`
    * `encoding`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `content`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
    * `target`: string
    * `submodule_git_url`: string
  * **Symlink Content**
    * `type`: required, string, enum: `symlink`
    * `target`: required, string
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri
  * **Submodule Content**
    * `type`: required, string, enum: `submodule`
    * `submodule_git_url`: required, string, format: uri
    * `size`: required, integer
    * `name`: required, string
    * `path`: required, string
    * `sha`: required, string
    * `url`: required, string, format: uri
    * `git_url`: required, string or null, format: uri
    * `html_url`: required, string or null, format: uri
    * `download_url`: required, string or null, format: uri
    * `_links`: required, object:
      * `git`: required, string or null, format: uri
      * `html`: required, string or null, format: uri
      * `self`: required, string, format: uri

## Create or update file contents

```
PUT /repos/{owner}/{repo}/contents/{path}
```

Creates a new file or replaces an existing file in a repository.
Note

If you use this endpoint and the "Delete a file" endpoint in parallel, the concurrent requests will conflict and you will receive errors. You must use these endpoints serially instead.

OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint. The workflow scope is also required in order to modify files in the .github/workflows directory.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`path`** (string) (required)
  path parameter

#### Body parameters

- **`message`** (string) (required)
  The commit message.

- **`content`** (string) (required)
  The new file content, using Base64 encoding.

- **`sha`** (string)
  Required if you are updating a file. The blob SHA of the file being replaced.

- **`branch`** (string)
  The branch name. Default: the repository’s default branch.

- **`committer`** (object)
  The person that committed the file. Default: the authenticated user.
  - **`name`** (string) (required)
    The name of the author or committer of the commit. You'll receive a 422 status code if name is omitted.
  - **`email`** (string) (required)
    The email of the author or committer of the commit. You'll receive a 422 status code if email is omitted.
  - **`date`** (string)

- **`author`** (object)
  The author of the file. Default: The committer or the authenticated user if you omit committer.
  - **`name`** (string) (required)
    The name of the author or committer of the commit. You'll receive a 422 status code if name is omitted.
  - **`email`** (string) (required)
    The email of the author or committer of the commit. You'll receive a 422 status code if email is omitted.
  - **`date`** (string)

### HTTP response status codes

- **200** - OK

- **201** - Created

- **404** - Resource not found

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example for creating a file

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/contents/PATH \
  -d '{
  "message": "my commit message",
  "committer": {
    "name": "Monalisa Octocat",
    "email": "octocat@github.com"
  },
  "content": "bXkgbmV3IGZpbGUgY29udGVudHM="
}'
```

**Response schema (Status: 201):**

* `content`: required, object or null:
  * `name`: string
  * `path`: string
  * `sha`: string
  * `size`: integer
  * `url`: string
  * `html_url`: string
  * `git_url`: string
  * `download_url`: string
  * `type`: string
  * `_links`: object:
    * `self`: string
    * `git`: string
    * `html`: string
* `commit`: required, object:
  * `sha`: string
  * `node_id`: string
  * `url`: string
  * `html_url`: string
  * `author`: object:
    * `date`: string
    * `name`: string
    * `email`: string
  * `committer`: object:
    * `date`: string
    * `name`: string
    * `email`: string
  * `message`: string
  * `tree`: object:
    * `url`: string
    * `sha`: string
  * `parents`: array of objects:
    * `url`: string
    * `html_url`: string
    * `sha`: string
  * `verification`: object:
    * `verified`: boolean
    * `reason`: string
    * `signature`: string or null
    * `payload`: string or null
    * `verified_at`: string or null

#### Example for updating a file

**Request:**

```curl
curl -L \
  -X PUT \
  https://api.github.com/repos/OWNER/REPO/contents/PATH \
  -d '{
  "message": "a new commit message",
  "committer": {
    "name": "Monalisa Octocat",
    "email": "octocat@github.com"
  },
  "content": "bXkgdXBkYXRlZCBmaWxlIGNvbnRlbnRz",
  "sha": "95b966ae1c166bd92f8ae7d1c313e738c731dfc3"
}'
```

**Response schema (Status: 200):**

* `content`: required, object or null:
  * `name`: string
  * `path`: string
  * `sha`: string
  * `size`: integer
  * `url`: string
  * `html_url`: string
  * `git_url`: string
  * `download_url`: string
  * `type`: string
  * `_links`: object:
    * `self`: string
    * `git`: string
    * `html`: string
* `commit`: required, object:
  * `sha`: string
  * `node_id`: string
  * `url`: string
  * `html_url`: string
  * `author`: object:
    * `date`: string
    * `name`: string
    * `email`: string
  * `committer`: object:
    * `date`: string
    * `name`: string
    * `email`: string
  * `message`: string
  * `tree`: object:
    * `url`: string
    * `sha`: string
  * `parents`: array of objects:
    * `url`: string
    * `html_url`: string
    * `sha`: string
  * `verification`: object:
    * `verified`: boolean
    * `reason`: string
    * `signature`: string or null
    * `payload`: string or null
    * `verified_at`: string or null

## Delete a file

```
DELETE /repos/{owner}/{repo}/contents/{path}
```

Deletes a file in a repository.
You can provide an additional committer parameter, which is an object containing information about the committer. Or, you can provide an author parameter, which is an object containing information about the author.
The author section is optional and is filled in with the committer information if omitted. If the committer information is omitted, the authenticated user's information is used.
You must provide values for both name and email, whether you choose to use author or committer. Otherwise, you'll receive a 422 status code.
Note

If you use this endpoint and the "Create or update file contents" endpoint in parallel, the concurrent requests will conflict and you will receive errors. You must use these endpoints serially instead.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`path`** (string) (required)
  path parameter

#### Body parameters

- **`message`** (string) (required)
  The commit message.

- **`sha`** (string) (required)
  The blob SHA of the file being deleted.

- **`branch`** (string)
  The branch name. Default: the repository’s default branch

- **`committer`** (object)
  object containing information about the committer.
  - **`name`** (string)
    The name of the author (or committer) of the commit
  - **`email`** (string)
    The email of the author (or committer) of the commit

- **`author`** (object)
  object containing information about the author.
  - **`name`** (string)
    The name of the author (or committer) of the commit
  - **`email`** (string)
    The email of the author (or committer) of the commit

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

- **503** - Service unavailable

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X DELETE \
  https://api.github.com/repos/OWNER/REPO/contents/PATH \
  -d '{
  "message": "my commit message",
  "committer": {
    "name": "Monalisa Octocat",
    "email": "octocat@github.com"
  },
  "sha": "329688480d39049927147c162b9d2deaf885005f"
}'
```

**Response schema (Status: 200):**

Same response schema as [Create or update file contents](#create-or-update-file-contents).

## Get a repository README

```
GET /repos/{owner}/{repo}/readme
```

Gets the preferred README for a repository.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw file contents. This is the default if you do not specify a media type.
application/vnd.github.html+json: Returns the README in HTML. Markup languages are rendered to HTML using GitHub's open-source Markup library.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`ref`** (string)
  The name of the commit/branch/tag. Default: the repository’s default branch.

### HTTP response status codes

- **200** - OK

- **304** - Not modified

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/readme
```

**Response schema (Status: 200):**

* `type`: required, string, enum: `file`
* `encoding`: required, string
* `size`: required, integer
* `name`: required, string
* `path`: required, string
* `content`: required, string
* `sha`: required, string
* `url`: required, string, format: uri
* `git_url`: required, string or null, format: uri
* `html_url`: required, string or null, format: uri
* `download_url`: required, string or null, format: uri
* `_links`: required, object:
  * `git`: required, string or null, format: uri
  * `html`: required, string or null, format: uri
  * `self`: required, string, format: uri
* `target`: string
* `submodule_git_url`: string

## Get a repository README for a directory

```
GET /repos/{owner}/{repo}/readme/{dir}
```

Gets the README from a repository directory.
This endpoint supports the following custom media types. For more information, see "Media types."

application/vnd.github.raw+json: Returns the raw file contents. This is the default if you do not specify a media type.
application/vnd.github.html+json: Returns the README in HTML. Markup languages are rendered to HTML using GitHub's open-source Markup library.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`dir`** (string) (required)
  The alternate path to look for a README file

- **`ref`** (string)
  The name of the commit/branch/tag. Default: the repository’s default branch.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/readme/DIR
```

**Response schema (Status: 200):**

Same response schema as [Get a repository README](#get-a-repository-readme).

## Download a repository archive (tar)

```
GET /repos/{owner}/{repo}/tarball/{ref}
```

Gets a redirect URL to download a tar archive for a repository. If you omit :ref, the repository’s default branch (usually
main) will be used. Please make sure your HTTP framework is configured to follow redirects or you will need to use
the Location header to make a second GET request.
Note

For private repositories, these links are temporary and expire after five minutes.

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

### HTTP response status codes

- **302** - Found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/tarball/REF
```

**Response schema (Status: 302):**

## Download a repository archive (zip)

```
GET /repos/{owner}/{repo}/zipball/{ref}
```

Gets a redirect URL to download a zip archive for a repository. If you omit :ref, the repository’s default branch (usually
main) will be used. Please make sure your HTTP framework is configured to follow redirects or you will need to use
the Location header to make a second GET request.
Note

For private repositories, these links are temporary and expire after five minutes. If the repository is empty, you will receive a 404 when you follow the redirect.

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

### HTTP response status codes

- **302** - Found

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/zipball/REF
```

**Response schema (Status: 302):**