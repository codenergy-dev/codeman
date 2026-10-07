---
title: Concurrency
url: https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency
created_at: 2026-10-06T22:39:04-03:00
updated_at: 2026-10-06T22:39:04-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Concurrency

Learn about running workflows and jobs simultaneously.

By default, GitHub Actions allows multiple jobs within the same workflow, multiple workflow runs within the same repository, and multiple workflow runs across a repository owner's account to run concurrently. This means that multiple instances of the same workflow or job can run at the same time, performing the same steps.

GitHub Actions also allows you to disable concurrent execution. This can be useful for controlling your account’s or organization’s resources in situations where running multiple workflows or jobs at the same time could cause conflicts or consume more Actions minutes and storage than expected. For example, you might want to prevent multiple deployments from running at the same time, or cancel linters checking outdated commits.

When you limit concurrency, by default only one run can be pending in a concurrency group—any additional pending runs cancel the previous one. If you need runs to execute sequentially without being canceled, you can opt in to queuing, which allows multiple runs to wait in line and execute in order.

To start controlling concurrency in your own workflows with the `concurrency` keyword, see [Control the concurrency of workflows and jobs](/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).