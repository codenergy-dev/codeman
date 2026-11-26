---
title: "About releases"
url: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
created_at: 2026-11-26T18:50:20-03:00
updated_at: 2026-11-26T18:50:20-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# About releases

You can create a release to package software, along with release notes and links to binary files, for other people to use.

## About releases

Releases are deployable software iterations you can package and make available for a wider audience to download and use.

Releases are based on [Git tags](https://git-scm.com/book/en/v2/Git-Basics-Tagging), which mark a specific point in your repository's history. A tag date may be different than a release date since they can be created at different times. For more information about viewing your existing tags, see [Viewing your repository's releases and tags](/en/repositories/releasing-projects-on-github/viewing-your-repositorys-releases-and-tags).

You can receive notifications when new releases are published in a repository without receiving notifications about other updates to the repository. For more information, see [Viewing your subscriptions](/en/subscriptions-and-notifications/how-tos/managing-subscriptions-for-activity-on-github/viewing-your-subscriptions).

Anyone with read access to a repository can view and compare releases, but only people with write permissions to a repository can manage releases. For more information, see [Managing releases in a repository](/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

You can manually create release notes while managing a release. Alternatively, you can automatically generate release notes from a default template, or customize your own release notes template. For more information, see [Automatically generated release notes](/en/repositories/releasing-projects-on-github/automatically-generated-release-notes).

When viewing the details for a release, the creation date for each release asset is shown next to the release asset.

GitHub will automatically include links to download a zip file and a tarball containing the contents of the repository at the point of the tag's creation.

People with admin permissions to a repository can choose whether Git Large File Storage (Git LFS) objects are included in the ZIP files and tarballs that GitHub creates for each release. For more information, see [Managing Git LFS objects in archives of your repository](/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-git-lfs-objects-in-archives-of-your-repository).

If a release fixes a security vulnerability, you should publish a security advisory in your repository. GitHub reviews each published security advisory and may use it to send Dependabot alerts to affected repositories. For more information, see [Repository security advisories](/en/code-security/concepts/vulnerability-reporting-and-management/repository-security-advisories).

You can view the **Dependents** tab of the dependency graph to see which repositories and packages depend on code in your repository, and may therefore be affected by a new release. For more information, see [Dependency graph](/en/code-security/concepts/supply-chain-security/dependency-graph).

You can also use the Releases API to gather information, such as the number of times people download a release asset. For more information, see [REST API endpoints for releases and release assets](/en/rest/releases).

## Storage and bandwidth quotas

Up to 1000 release assets may be associated with a single release. Each file included in a release must be under 2 GiB. There is no limit on the total size of a release, nor bandwidth usage.