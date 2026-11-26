---
title: Unable to download attached file to a GitHub Issue
url: https://github.com/orgs/community/discussions/162417
created_at: 2026-11-26T18:50:20-03:00
updated_at: 2026-11-26T18:50:20-03:00
tool: docs/web/tools/fetch-markdown.md
---

# Unable to download attached file to a GitHub Issue

A discussion in GitHub's community forum, opened on 2025-06-11. It has no Markdown source, and community posts carry no license that allows a copy, so these are the facts Codeman relies on, in our own words. The accepted answer is a user's, not GitHub staff's.

## The question

- The author tries to download, from a script, a file attached to an issue of a private repository: a `github.com/user-attachments/files/…` link. The download answers `404 Not Found` (the opening post).

## The accepted answer

- GitHub does not let scripts download a private repository's issue attachments, with a fine-grained personal access token or a GitHub App's token alike.
- These links need a signed-in browser session, so requests through the API fail.
- There is no API to fetch them.

## What Codeman observed

Not part of the discussion. On 2026-11-26, a `user-attachments/files/` link of a private repository answered `404` to the agent job's `GITHUB_TOKEN`, and to a fine-grained personal access token with read access to the repository's contents and issues.
