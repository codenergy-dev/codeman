---
title: Issue Accessing Private Repository Attachments with GitHub App Installation Token
url: https://github.com/orgs/community/discussions/148227
created_at: 2026-11-26T13:40:00-03:00
updated_at: 2026-11-26T13:40:00-03:00
tool: docs/web/tools/fetch-markdown.md
---

# Issue Accessing Private Repository Attachments with GitHub App Installation Token

A discussion in GitHub's community forum, opened on 2024-12-31, whose last reply is from 2025-01-04. It has no Markdown source, and community posts carry no license that allows a copy, so these are the facts Codeman relies on, in our own words. No GitHub staff member answered: they are users' reports, not documented behavior.

## The question

- An attachment of an issue in a private repository downloads with a personal access token. The same request answers `404 Not Found` with an installation token of a GitHub App installed on that repository (the opening post).
- The same installation token downloads an attachment of a public repository (the opening post).

## The replies

- Another user found installation tokens never work for this, and neither did a GitHub App's user access token (the first reply).
- The accepted answer: read the comment through the REST API with the media type `application/vnd.github.full+json`. Its `body_html` holds the image's address with a short-lived JWT in it, which downloads without a token. The answer advises downloading the file at once (the accepted answer).
- The thread speaks of images only. It says nothing of other files, such as CSV or PDF files, and does not say how long the JWT lasts.
