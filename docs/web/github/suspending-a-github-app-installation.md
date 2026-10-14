---
title: Suspending a GitHub App installation
url: https://docs.github.com/en/apps/maintaining-github-apps/suspending-a-github-app-installation
created_at: 2026-10-13T20:46:56-03:00
updated_at: 2026-10-13T20:46:56-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Suspending a GitHub App installation

You can temporarily block your GitHub App from accessing resources owned by the accounts that installed the GitHub App.

> \[!NOTE]
> If you want to suspend a GitHub App that you use but do not own, see [Reviewing and modifying installed GitHub Apps](/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps#blocking-access) instead.

When a GitHub App is suspended for an installation, the GitHub App cannot access resources owned by that installation account. For example, you might want to suspend your GitHub App if you are worried that your app's credentials were leaked.

The owner of a GitHub App and designated app managers can suspend the GitHub App for a specific installation. GitHub App owners and managers can only use the API to suspend their app, and they must suspend the app individually for each installation. For more information, see [REST API endpoints for GitHub Apps](/en/rest/apps/apps#suspend-an-app-installation).

Users who installed a GitHub App on their personal account or an account they own can also suspend a GitHub App from accessing resources owned by their account. People who have installed a GitHub App can only use the GitHub web interface to suspend their app. For more information, see [Reviewing and modifying installed GitHub Apps](/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps).

A GitHub App must be unsuspended in the same way it was suspended. If an owner or manager of a GitHub App suspended the app, they can also unsuspend it, but the owner of an account where the app is installed cannot unsuspend it. Similarly, if the owner of an account where a GitHub App is installed suspended the app, they can also unsuspend it, but an owner or manager of the app cannot unsuspend it.
