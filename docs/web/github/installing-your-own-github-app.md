---
title: Installing your own GitHub App
url: https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app
created_at: 2026-10-13T20:46:56-03:00
updated_at: 2026-10-13T20:46:56-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Installing your own GitHub App

You can install a GitHub App that you created on the account that owns the app. If your app is public, the GitHub App can also be installed on other accounts.

## About installing your own GitHub App

After creating a GitHub App, you can install it based on its visibility.

* **Only on this account:** The GitHub App can only be installed on the account that created it.
* **Any account:** You can install this GitHub App on any account you control.

## Installing your own GitHub App

1. In the upper-right corner of any page on GitHub, click your profile picture.
1. Navigate to your account settings.
   * For an app owned by a personal account, click **Settings**.
   * For an app owned by an organization:
     1. Click **Your organizations**.
     1. To the right of the organization, click **Settings**.
1. In the left sidebar, click **<svg version="1.1" width="16" height="16" viewBox="0 0 16 16" class="octicon octicon-code" aria-label="code" role="img"><path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"></path></svg> Developer settings**.
1. In the left sidebar, click **GitHub Apps**.
1. Next to the GitHub App that you want to install, click **Edit**.
1. Click **Install App**.
1. Click **Install** next to the location where you want to install the GitHub App.
1. If the app requires repository permissions, select **All repositories** or **Only select repositories**. The app will always have at least read-only access to all public repositories on GitHub.

   If the app does not require repository permissions, these options will be omitted.
1. If you selected **Only select repositories** in the previous step, under the **Select repositories** dropdown, select the repositories that you want the app to access.

   If the app creates any repositories, the app will automatically be granted access to those repositories as well.
1. Click **Install**.
