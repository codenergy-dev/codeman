---
title: REST API endpoints for Git trees
url: https://docs.github.com/en/rest/git/trees
created_at: 2026-10-02T21:53:13-03:00
updated_at: 2026-10-02T21:53:13-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# REST API endpoints for Git trees

Use the REST API to interact with tree objects in your Git database on GitHub.

## About Git trees

A Git tree object creates the hierarchy between files in a Git repository. You can use the Git tree object to create the relationship between directories and the files they contain. These endpoints allow you to read and write [tree objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects#_tree_objects) to your Git database on GitHub.

> [!NOTE]
> Most endpoints use `Authorization: Bearer <YOUR-TOKEN>` and `Accept: application/vnd.github+json` headers, plus `X-GitHub-Api-Version: 2026-03-10`. Curl examples below omit these standard headers for brevity.

## Create a tree

```
POST /repos/{owner}/{repo}/git/trees
```

The tree creation API accepts nested entries. If you specify both a tree and a nested path modifying that tree, this endpoint will overwrite the contents of the tree with the new path contents, and create a new tree structure.
If you use this endpoint to add, delete, or modify the file contents in a tree, you will need to commit the tree and then update a branch to point to the commit. For more information see "Create a commit" and "Update a reference."
Returns an error if you try to delete a file that does not exist.

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

- **`tree`** (array of objects) (required)
  Objects (of path, mode, type, and sha) specifying a tree structure.
  - **`path`** (string)
    The file referenced in the tree.
  - **`mode`** (string)
    The file mode; one of 100644 for file (blob), 100755 for executable (blob), 040000 for subdirectory (tree), 160000 for submodule (commit), or 120000 for a blob that specifies the path of a symlink.
    Can be one of: `100644`, `100755`, `040000`, `160000`, `120000`
  - **`type`** (string)
    Either blob, tree, or commit.
    Can be one of: `blob`, `tree`, `commit`
  - **`sha`** (string or null)
    The SHA1 checksum ID of the object in the tree. Also called tree.sha. If the value is null then the file will be deleted.
Note: Use either tree.sha or content to specify the contents of the entry. Using both tree.sha and content will return an error.
  - **`content`** (string)
    The content you want this file to have. GitHub will write this blob out and use that SHA for this entry. Use either this, or tree.sha.
Note: Use either tree.sha or content to specify the contents of the entry. Using both tree.sha and content will return an error.

- **`base_tree`** (string)
  The SHA1 of an existing Git tree object which will be used as the base for the new tree. If provided, a new Git tree object will be created from entries in the Git tree object pointed to by base_tree and entries defined in the tree parameter. Entries defined in the tree parameter will overwrite items from base_tree with the same path. If you're creating new changes on a branch, then normally you'd set base_tree to the SHA1 of the Git tree object of the current latest commit on the branch you're working on.
If not provided, GitHub will create a new Git tree object from only the entries defined in the tree parameter. If you create a new commit pointing to such a tree, then all files which were a part of the parent commit's tree and were not defined in the tree parameter will be listed as deleted by the new commit.

### HTTP response status codes

- **201** - Created

- **403** - Forbidden

- **404** - Resource not found

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example

**Request:**

```curl
curl -L \
  -X POST \
  https://api.github.com/repos/OWNER/REPO/git/trees \
  -d '{
  "base_tree": "9fb037999f264ba9a7fc6274d15fa3ae2ab98312",
  "tree": [
    {
      "path": "file.rb",
      "mode": "100644",
      "type": "blob",
      "sha": "44b4fc6d56897b048c772eb4087f854f46256132"
    }
  ]
}'
```

**Response schema (Status: 201):**

* `sha`: required, string
* `url`: string, format: uri
* `truncated`: required, boolean
* `tree`: required, array of objects:
  * `path`: required, string
  * `mode`: required, string
  * `type`: required, string
  * `sha`: required, string
  * `size`: integer
  * `url`: string

## Get a tree

```
GET /repos/{owner}/{repo}/git/trees/{tree_sha}
```

Returns a single tree using the SHA1 value or ref name for that tree.
If truncated is true in the response then the number of items in the tree array exceeded our maximum limit. If you need to fetch more items, use the non-recursive method of fetching trees, and fetch one sub-tree at a time.
Note

The limit for the tree array is 100,000 entries with a maximum size of 7 MB when using the recursive parameter.

### Parameters

#### Headers

- **`accept`** (string)
  Setting to `application/vnd.github+json` is recommended.

#### Path and query parameters

- **`owner`** (string) (required)
  The account owner of the repository. The name is not case sensitive.

- **`repo`** (string) (required)
  The name of the repository without the .git extension. The name is not case sensitive.

- **`tree_sha`** (string) (required)
  The SHA1 value or ref (branch or tag) name of the tree.

- **`recursive`** (string)
  Setting this parameter to any value returns the objects or subtrees referenced by the tree specified in :tree_sha. For example, setting recursive to any of the following will enable returning objects or subtrees: 0, 1, "true", and "false". Omit this parameter to prevent recursively returning objects or subtrees.

### HTTP response status codes

- **200** - OK

- **404** - Resource not found

- **409** - Conflict

- **422** - Validation failed, or the endpoint has been spammed.

### Code examples

#### Example 1: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/git/trees/TREE_SHA
```

**Response schema (Status: 200):**

Same response schema as [Create a tree](#create-a-tree).

#### Example 2: Status Code 200

**Request:**

```curl
curl -L \
  -X GET \
  https://api.github.com/repos/OWNER/REPO/git/trees/TREE_SHA
```

**Response schema (Status: 200):**

Same response schema as [Create a tree](#create-a-tree).