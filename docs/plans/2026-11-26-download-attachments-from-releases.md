---
status: completed
created_at: 2026-11-26T18:52:00-03:00
updated_at: 2026-11-26T19:40:00-03:00
commit: b3f3c82
---

# Download attachments from releases

## Goal

Maintainers of a private repository can give the agent any file, such as a ZIP or CSV file, by uploading it as an asset of a release of the repository and linking it in the issue. The agent job downloads it through GitHub's REST API. When the issue's own attachments cannot be downloaded, the run says why, links a reference, and points to releases.

## Context

- **What exists.** The agent job downloads GitHub's attachment links found in the issue and the maintainers' comments and reviews, into `.codeman/attachments/` ([attachments](../tasks/attachments.md), [the first plan](2026-11-26-give-the-agent-the-issue-attachments.md)).
- **What fails.** On a private repository, a `github.com/user-attachments/files/…` link answers `404` to the job's `GITHUB_TOKEN`, and to a fine-grained personal access token with read access to contents and issues: the responsible person checked both on 2026-11-26. GitHub has no API for these files ([unable to download](../web/github/unable-to-download-attached-file-to-a-github-issue.md), [private attachments](../web/github/issue-accessing-private-repository-attachments-with-github-app-installation-toke.md)). Images still download, from the signed addresses of the text's rendered HTML.
- **Release assets have an API.** `GET /repos/{owner}/{repo}/releases/assets/{asset_id}`, with `Accept: application/octet-stream`, answers the file or a redirect to it ([release assets](../web/github/rest-api-endpoints-for-release-assets.md#get-a-release-asset)). The agent job's `contents: read` permission covers it: anyone with read access can view releases ([about releases](../web/github/about-releases.md#about-releases)). Each asset may be up to 2 GiB, and a release holds up to 1000 ([about releases](../web/github/about-releases.md#storage-and-bandwidth-quotas)).
- **From a link to an asset.** The asset's link on the release page is `https://github.com/<owner>/<repo>/releases/download/<tag>/<name>`, or `…/releases/latest/download/<name>` for the latest release ([linking to releases](../web/github/linking-to-releases.md)). Its ID comes from `GET /repos/{owner}/{repo}/releases/tags/{tag}` or `…/releases/latest`, whose `assets` list names each one ([releases](../web/github/rest-api-endpoints-for-releases.md)).
- **Drafts.** Only users with push access receive draft releases ([releases](../web/github/rest-api-endpoints-for-releases.md)), so the job's `contents: read` cannot find them.
- **Observed on 2026-11-26.** A public release asset, through the API without a token, answers `302` to `release-assets.githubusercontent.com`, a host the adapter already follows.
- **Costs of a release.** It creates a tag. Publishing it may notify the repository's watchers ([about releases](../web/github/about-releases.md#about-releases)). With immutable releases on, its assets cannot be removed once published ([managing releases](../web/github/managing-releases-in-a-repository.md#editing-a-release), [immutable releases](../web/github/immutable-releases.md)).

## Decisions

### Answered by the responsible person on 2026-11-26

1. **Approach.** Keep downloading the issue's attachments, which works for images and on public repositories, and also download release assets.
2. **Documentation.** Explain to maintainers, step by step, how to give the agent files through a release.
3. **Warning.** The run comment warns, with a link to a GitHub community discussion, that the issue's attachments cannot be downloaded through GitHub's API.
4. **Draft releases.** Options: (a) published releases only, prereleases included, with no permission change; (b) drafts too, with `contents: write` on the agent job and template version 5. **Answer: (a).** A draft asset's link is reported as refused, with a hint to publish the release.
5. **When the warning appears.** Options: (a) when at least one attachment of the issue was refused; (b) on every run whose texts link an issue attachment that is not an image; (c) on every run of a private repository. **Answer: (a).** The line of each refused file says why, then one note explains the platform's limit, links the discussion, and points to releases.
6. **Which release links.** Options: (a) links to one asset; (b) also a link to a whole release, which downloads all its assets. **Answer: (b).** Each asset of a linked release counts against `max-attachments`, as a linked asset does.

### Choices made in this work

1. **Same limits.** Release assets count against the same settings as attachments: `max-attachments`, `max-attachment-bytes`, `max-attachment-total-bytes`, and archives against the extraction limits. No new setting.
2. **Every release through the API.** A release link is resolved through the API with the job's token, whatever its repository: the token reads the task's repository, and public ones. Another private repository's release is refused.
3. **Links.** `https://github.com/<owner>/<repo>/releases/download/<tag>/<name>` and `…/releases/latest/download/<name>` are one asset. `…/releases/tag/<tag>` and `…/releases/latest` are a whole release, expanded into its assets before any download, in the release's order. An asset linked twice, alone and through its release, is downloaded once.
4. **The token.** Sent to `github.com` and `api.github.com` only, never on a redirect to another host.
5. **The reference.** The warning links [the community discussion #162417](https://github.com/orgs/community/discussions/162417), whose question is this one: an issue's file of a private repository, refused with a fine-grained token.

## Steps

1. **Recognize release links.** The GitHub adapter finds asset and release links in the texts, beside the attachment links, and each link says what it is: a conversation attachment, a release asset, or a release. Done when tests cover tags with `/`, `latest`, encoded names, and release pages that are not links to assets or releases. **Done** in `50c20d2`.
2. **Download release assets.** Find the release by tag, or the latest, find the asset by name, and download it through the API, following redirects by hand. A missing release, a missing asset, and a draft's `untagged-` tag are refusals with a detail. Done when tests with a fake fetch cover each case, and that the token goes to `github.com` and `api.github.com` only. **Done** in `50c20d2`.
3. **Expand release links.** `gatherAttachments` replaces each release link with its assets' links before numbering them, and reports a release it could not read. The index says through which release link each asset came. Done when tests cover expansion, duplicates, limits and a refused release. **Done** in `50c20d2`.
4. **The warning.** A refused conversation attachment carries the platform's reference. The run comment adds one note, in English and Portuguese, after the per-file lines: the platform's limit, the reference, and a link to the docs on releases, as plain URLs, since the run comment turns Markdown links into text. The job's log says the same. Done when a flow test checks it. **Done** in `50c20d2`.
5. **Documentation.** In [attachments](../tasks/attachments.md): a section on giving files through a release, step by step, with its costs and how to clean up; the private-repository section points to it; the table of what the run comment says gains the new warning. Update [platforms](../development/platforms.md) and [secrets](../security/secrets.md) where they describe the downloads. Done when `src/docs.test.ts` passes. **Done**, with an entry in [upgrading](../installation/upgrading.md#release-assets-reach-the-agent).
6. **Checks.** `npm run check`, and `dist/index.js` rebuilt. Done when everything passes, but the known failure of `src/gateway/bootstrap.test.ts` on macOS. **Done**: 1206 tests pass, 8 skipped, and only that known failure; `tsc` and Biome are clean. The end-to-end suite was not run.
7. **On real repositories.** The responsible person runs a task on a private repository with a release asset. Done when it reaches the agent. Left to the responsible person, after the merge.

## Out of scope

- Downloading a private repository's issue attachments that are not images: GitHub has no way for a script to do it.
- A person's token or a browser session for attachments.
- Uploading files to releases, or deleting them after the task: maintainers do it.
- Other places for files, such as branches, gists or other hosts.
