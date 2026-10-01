---
status: completed
created_at: 2026-10-01T13:51:00-03:00
updated_at: 2026-10-01T15:20:00-03:00
commit: e32f4b1
---

# Decisions comment

## Goal

A task's decisions live in a comment of their own, kept up to date in place, so they can use a whole comment and maintainers have one fixed place to read and answer them. No comment Codeman writes exceeds GitHub's limit.

## Context

The status comment is the task's panel: state, links, summary, decisions, workflows, spend, and the task record. It changes on every run; the decisions change only when a plan or a stage raises them or a maintainer answers. A comment holds at most 65,536 characters, and the decisions are the largest part of the panel.

Depends on [output length limits](2026-10-01-output-length-limits.md), which bounds the decisions of one output and compresses the record.

## Decisions

1. **Source of truth.** Options: (a) the record in the status comment stays the only state, and the decisions comment is rendered from it and never read back; (b) the decisions comment holds its own state. Recommendation: (a): a failed update of the decisions comment leaves the state correct, and the next update repairs it; Codeman never trusts its content.
   **Answer:** (a), from the responsible person.
2. **When decisions change.** Options: (a) edit the comment in place, and link to it from the status comment; (b) delete it and post a new one, which notifies and moves it to the end. Recommendation: (a), as the status comment behaves.
   **Answer:** (a), from the responsible person.
3. **Finding the comment.** The record keeps its ID (`decisionsCommentId`). If the comment was deleted, Codeman posts a new one. No other option was considered.

## Steps

1. [x] `renderDecisions` in `src/status.ts` renders the decisions, the answers and how to answer, under a marker. `renderStatus` drops them and links to the decisions comment. Done when unit tests cover both.
2. [x] Each comment fits GitHub's limit. The decisions comment shows answered decisions in short form when the full form is too long, then leaves out answered decisions, then pending ones from the last, with a note pointing to the plan. The status comment keeps its record and links and leaves out the rest, with a note. Done when unit tests render the worst case under 65,536 characters.
3. [x] `apply` creates or updates the decisions comment whenever the task has decisions, before the status comment, and records its ID. `upsertComment` posts a new comment when the old one is gone. A task that never had decisions has no decisions comment; once it has one, it stays current, and says so when a revised plan has no decisions.
4. [x] The message catalogs point to the decisions comment where they point to the status comment for decisions.
5. [x] `docs/architecture.md` describes the decisions comment.
6. [x] `npm run check` passes.

## Out of scope

- A history of answers beyond what the record keeps.
- Splitting any comment in more than one.
