---
title: Mutations
url: https://docs.github.com/en/graphql/reference/mutations
created_at: 2026-10-02T21:54:12-03:00
updated_at: 2026-10-02T21:54:12-03:00
tool: docs/web/tools/github.md
---

# Mutations

GitHub's list of GraphQL mutations is too large to keep here. These are the facts Codeman relies on, from GitHub's public schema (`https://docs.github.com/public/fpt/schema.docs.graphql`), which the page is built from.

## markPullRequestReadyForReview

- Marks a draft pull request as ready for review. The REST endpoint that updates a pull request has no field for this (see [REST API endpoints for pull requests](rest-api-endpoints-for-pull-requests.md), "Update a pull request"), so a draft is made ready only through GraphQL.
- Input `MarkPullRequestReadyForReviewInput`: `pullRequestId` (`ID!`, the pull request's global node ID) and an optional `clientMutationId`.
- Payload `MarkPullRequestReadyForReviewPayload`: `pullRequest` and `clientMutationId`.
- The node ID is the `node_id` field of the REST pull request object.
