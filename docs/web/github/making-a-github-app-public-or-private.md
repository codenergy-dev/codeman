---
title: Making a GitHub App public or private
url: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private
created_at: 2026-10-13T20:46:55-03:00
updated_at: 2026-10-13T20:46:55-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Making a GitHub App public or private

When registering a GitHub App, you can make it public so that other GitHub accounts can install the app, or private so that you can only install it on the account that owns the app.

## About visibility for GitHub Apps

A GitHub App can be public or private. If you set your GitHub App registration to public, any user on GitHub can install it and authorize it. If you set your GitHub App registration to private, it can only be installed on the account that owns the app. Only members of the organization that owns it can authorize it.

If you want your GitHub App to be available to organizations in a GitHub Enterprise Server instance that you are not part of, then you need to take additional steps. For more information, see [Making your GitHub App available for GitHub Enterprise Server](/en/apps/sharing-github-apps/making-your-github-app-available-for-github-enterprise-server).

If it is important for GitHub Enterprise Server users to be able to use your tool, consider using GitHub Actions instead of a GitHub App. Public actions are available on GitHub Enterprise Server instances with GitHub Connect. For more information, see [Enabling automatic access to GitHub.com actions using GitHub Connect](/en/enterprise-server@3.22/admin/managing-github-actions-for-your-enterprise/managing-access-to-actions-from-githubcom/enabling-automatic-access-to-githubcom-actions-using-github-connect) and [About GitHub Actions for enterprises](/en/enterprise-server@3.22/admin/managing-github-actions-for-your-enterprise/getting-started-with-github-actions-for-your-enterprise/about-github-actions-for-enterprises) in the GitHub Enterprise Server documentation.

For information about changing the visibility of a GitHub App registration, see [Modifying a GitHub App registration](/en/apps/maintaining-github-apps/modifying-a-github-app-registration).

### Accessing details of other GitHub Apps

A GitHub App can use the "Get an app" REST API endpoint to access details of another app when one of these are true:

* The target app is public.
* Both apps are owned by the same organization, regardless of the target app's visibility.
* The target app is internal, and both apps belong to the same enterprise.
* The requesting app is owned by an enterprise, and the target app is owned by an organization in that enterprise.

For more information, see [REST API endpoints for GitHub Apps](/en/rest/apps/apps#get-an-app).

### Public installation flow

Public GitHub Apps have a landing page with an **Install** button, so that other people can install the app on their accounts. If your GitHub App is public to all users on GitHub, you can also choose to publish it to GitHub Marketplace. For more information, see [About GitHub Marketplace for apps](/en/apps/github-marketplace/github-marketplace-overview/about-github-marketplace-for-apps).

### Private installation flow

Private GitHub Apps can only be installed on the user or organization account of the app owner. Limited information about the app will exist on a landing page for the app, and the **Install** button will only be available to organization owners and app managers for the organization that owns the app, or the personal account if the GitHub App is owned by an individual account.
