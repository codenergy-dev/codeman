---
title: Forks
url: https://docs.github.com/en/pull-requests/reference/forks
created_at: 2026-10-14T17:40:56-03:00
updated_at: 2026-10-14T17:40:56-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Forks

Understand how forks enable independent collaboration by creating separate repositories connected to the original, with distinct settings and permissions.

Forks are repositories that start as copies of another repository, called the upstream repository. A fork has its own settings and permissions but stays connected to the upstream repository.

When you view a forked repository on GitHub, the upstream repository is indicated below the name of the fork.

## What makes forks distinct from branches

A branch is part of one repository. A fork is a separate repository with its own settings and collaboration space.

Each fork can have its own:

* Branches
* Members and discussions
* Issues and pull requests
* Actions and projects
* Tags, labels, and wikis

## Which repositories can be forked?

You can fork any public repository:

* To your personal account
* To an organization where you have permission to create repositories

If you have access to a private repository and the owner permits forking, you can fork the repository:

* To your personal account
* To an organization on GitHub Team where you have permission to create repositories

You cannot fork a private repository to an organization using GitHub Free. For more information about GitHub Team and GitHub Free, see [GitHub's plans](/en/get-started/learning-about-github/githubs-plans).

Repository, organization, and enterprise policies can limit whether repositories can be forked and where forks can be created. For private repositories, access to forks also depends on repository visibility, organization membership, and administrator settings.

If you're a member of an enterprise with managed users, additional restrictions apply to the repositories you can fork.  See [About Enterprise Managed Users](/en/enterprise-cloud@latest/admin/concepts/identity-and-access-management/enterprise-managed-users) in the GitHub Enterprise Cloud documentation.

See [Managing the forking policy for your organization](/en/organizations/managing-organization-settings/managing-the-forking-policy-for-your-organization).

## Visibility of forks

A fork's visibility depends on the upstream repository. Public repository forks are public, and private repository forks are private. You cannot change the visibility of a fork by itself.

A repository network includes the upstream repository, its forks, and forks of those forks. Repositories in the network share Git data and remain connected to the upstream repository. See [Understanding connections between repositories](/en/repositories/viewing-activity-and-data-for-your-repository/understanding-connections-between-repositories).

Deleting a repository or changing its visibility can affect the network. If you delete a fork, code contributions from that fork can remain accessible to the repository network.

## What happens to forks when a repository is deleted or changes visibility

> \[!WARNING]
>
> * If you remove a person’s access to a private repository, any of their forks of that private repository are deleted. Local clones of the private repository are retained. If a team's access to a private repository is revoked or a team with access to a private repository is deleted, and team members do not have access to the repository through another team, private forks of the repository will be deleted.
> * You are responsible for ensuring that people who have lost access to a repository delete any confidential information or intellectual property.
> * People with admin permissions to a private repository can disallow forking of that repository, and organization owners can disallow forking of any private repository in an organization. For more information, see [Managing the forking policy for your organization](/en/organizations/managing-organization-settings/managing-the-forking-policy-for-your-organization) and [Managing the forking policy for your repository](/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository).

Visibility changes can separate forks into new repository networks so that existing fork owners can keep working without unexpected loss of access.

| Action                              | Effect on forks                                                            |
| ----------------------------------- | -------------------------------------------------------------------------- |
| A private repository is deleted     | Its private forks are also deleted.                                        |
| A public repository is deleted      | An active public fork becomes the new upstream repository for the network. |
| A public repository is made private | Its public forks stay public in a separate network.                        |
| A private repository is made public | Private forks stay private but disconnect into separate private networks.  |

Changing a public repository to private can also affect stars, watchers, dependency graph, Dependabot alerts, and code scanning availability. Review repository visibility settings carefully before changing them.

## Permissions of forks

Private forks inherit the permissions structure of the upstream repository. This helps owners of private repositories maintain control over their code. For example, if the upstream repository is private and gives read/write access to a team, then the same team will have read/write access to any forks of the private upstream repository. Only team permissions (not individual permissions) are inherited by private forks.

> \[!NOTE]
> When you change base permissions for an organization, permissions for private forks are not automatically updated. For more information, see [Setting base permissions for an organization](/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/setting-base-permissions-for-an-organization#about-base-permissions-for-an-organization).

Public forks do not inherit the permissions structure of the upstream repository. Fork owners control access to their forks, but repository networks still share Git data. Commits pushed to any repository in a network can be accessible from other repositories in that network, including the upstream repository.

When you fork a public repository to your personal account, you can allow maintainers of the upstream repository to push to your pull request branch. This can help maintainers update your branch, run tests, or resolve small issues before merging. You cannot give push permissions to a fork owned by an organization. See [Allowing changes to a pull request branch created from a fork](/en/pull-requests/how-tos/work-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork).

### Push rulesets for forked repositories

Push rules apply to the entire fork network for a repository, ensuring every entry point to the repository is protected. For example, if you fork a repository that has push rulesets enabled, the same push rulesets will also apply to your forked repository.

For a forked repository, the only people who have bypass permissions for a push rule are the people who have bypass permissions in the root repository.

See [About rulesets](/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets#push-rulesets).

### Important security considerations

Forks are powerful collaboration tools, but they can expose code and history in ways that are easy to overlook.

* Forks have their own permissions separate from the upstream repository.
* Owners of an upstream repository can read all forks in the repository network.
* Organization owners may have administrative access to forks created in personal namespaces.
* Organization owners of a repository that has been forked have read permission to forks created in organizations, but do not have the ability to delete the fork or its branches.
* Forks created in another organization will not be deleted when individual access is removed from the upstream repository.
* Git data from any repository in a network may be accessed from any repository in the same network, including the upstream repository, even after a fork is deleted.

Before allowing forks for sensitive work, review the permissions and visibility model for your repository or organization.

### Forks within an organization

Forks within the same organization copy collaborator and team settings from the upstream repository. The organization controls permissions for these forks, and existing visible teams may keep access.

### Forks within an enterprise

Internal repositories support a single level of forking. You cannot fork a private fork of an internal repository. This keeps access and management simpler for repositories that are visible across an enterprise.