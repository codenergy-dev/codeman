---
title: Webhook events and payloads
url: https://docs.github.com/en/webhooks/webhook-events-and-payloads
created_at: 2026-10-13T20:50:00-03:00
updated_at: 2026-10-13T20:50:00-03:00
tool: docs/web/tools/github.md
---

# Webhook events and payloads

GitHub's reference of every webhook payload is too large to keep here (about 95 KB). These are the facts Codeman relies on, from the page's Markdown source (`https://docs.github.com/api/article/body?pathname=/en/webhooks/webhook-events-and-payloads`). A workflow's `github.event` is the payload of the event that started it.

## The `sender` property

- Most payloads have a `sender`, the user who triggered the event. When GitHub cannot resolve one, `sender` is the `ghost` user (login `ghost`), so it does not always identify who caused the event.

## issues

- Action types: `assigned`, `closed`, `deleted`, `demilestoned`, `edited`, `field_added`, `field_removed`, `labeled`, `locked`, `milestoned`, `opened`, `pinned`, `reopened`, `transferred`, `typed`, `unassigned`, `unlabeled`, `unlocked`, `unpinned`, `untyped`.
- Every payload has `issue`, the issue itself.
- The Markdown source details only the first action's parameters (`assigned`: `assignee`, `issue`); it does not show the `label` that the `labeled` and `unlabeled` payloads carry.

## label

- To learn that a label was added to or removed from an issue, use the `labeled` and `unlabeled` actions of the `issues` event; the `label` event is about the labels themselves.
