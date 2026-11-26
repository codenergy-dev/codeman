---
status: in progress
created_at: 2026-11-26T13:15:10-03:00
updated_at: 2026-11-26T13:45:00-03:00
commit: 3fc6d2d
---

# Give the agent the issue's attachments

## Goal

Files a maintainer attaches to a task's issue or comments, such as CSV files, reach the agent as files in its working tree, in `.codeman/attachments/`, with an index that maps each link in the text to its file. Today the agent gets only the links.

## Context

- **What the agent gets today.** `select` puts the issue's title and body, and the maintainers' comments, in the task's context (`toTask` in `src/tasks.ts`, `authorizedComments` in `src/steps/select.ts`). The prompt quotes them as text (`issueSection` in `src/prompt.ts`). An attachment is only its Markdown link there. Nothing downloads it, and nothing tells the agent to.
- **Why the agent cannot fetch them itself.** The agent can reach the network, but its only credential is its model's key ([agent sandbox](../runs/agent.md#agent-sandbox)). GitHub serves the files of private and internal repositories only to people with access to them ([attaching files](../web/github/attaching-files.md)), so its downloads would fail there. On public repositories, it fetches a file only if it decides to.
- **What GitHub accepts.** Images and GIFs up to 10 MB, videos up to 100 MB, other files up to 25 MB. Besides images and videos, it accepts documents, data files (`.csv`, `.tsv`, `.json`, `.log`), code, archives (`.zip`, `.gz`, `.tgz`) and audio ([attaching files](../web/github/attaching-files.md#supported-file-types)).
- **A pattern to follow.** The agent job already downloads results for the agent outside the sandbox: the results of the workflows it asked for, with the job's token, within byte limits, with an index, copied into `.codeman/results/` (`downloadResults` in `src/results.ts`, `agentJob` in `src/steps/agent.ts`). The agent job does not collect `.codeman/`, and `apply` drops every change there ([change policy](../runs/changes.md#change-policy)), so nothing there reaches the task branch.
- **Platforms.** The steps reach GitHub only through interfaces ([platforms](../development/platforms.md)). Which links are attachments, and how to download them, is GitHub's business. It belongs in the GitHub adapter, and the fake platform needs its own format.
- **Images.** The [self-hosted images plan](2026-10-28-let-self-hosted-models-read-images.md#out-of-scope) left images in the issue out of scope. Once downloaded, an image is a file the agent can `read`, as with the design stage's screenshots, when its model reads images.

### How attachments download

Observed on 2026-11-26 on public issues of public repositories, without a token, and from a community discussion ([private attachments](../web/github/issue-accessing-private-repository-attachments-with-github-app-installation-toke.md)):

| Link in the issue's `body` | Without a token, public repository | In `body_html` (`full+json`) | Private repository, installation token |
| --- | --- | --- | --- |
| `https://github.com/user-attachments/files/<id>/<name>` | `302` to a signed `objects.githubusercontent.com` URL that lasts 300 seconds, then the file | The same link | Reported `404`; no known way around it |
| `https://github.com/user-attachments/assets/<uuid>` (images, videos) | `302` to a signed `github-production-user-asset-*.s3.amazonaws.com` URL, then the file | `https://private-user-images.githubusercontent.com/<user>/<n>-<uuid>.<ext>?jwt=…`, a JWT valid for 300 seconds | Reported `404` on the link; the `body_html` address downloads without a token |

- The job's `GITHUB_TOKEN` is an installation token too, of GitHub's Actions App, so it is expected to behave as the App's.
- So the adapter tries the link first, with the job's token sent only to `github.com`. When that fails, it reads the text's `body_html` again and downloads the signed address with the attachment's ID in it, without a token.
- **Risk.** Files that are not images or videos, such as CSV files, may not download from private repositories at all. The maintainer checks it on real repositories after the merge (step 9). If they fail, the plan is reopened with options, such as an optional token of a person.

## Decisions

### Answered by the responsible person on 2026-11-26

1. **Which job downloads the attachments.** Options: (a) the agent job, with `issues: read` and template version 4; (b) `select`, into the `codeman-task` artifact. **Answer: (a).**
2. **Which texts' attachments.** Options: (a) every text the agent already gets: the issue's body, the maintainers' comments, and their reviews and review comments; (b) the issue's body only. **Answer: (a).**
3. **Limits.** Options: fixed in the code, or settings. **Answer: settings, optional, with defaults**, in `.codeman/settings.yml` and the organization's settings (`CODEMAN_SETTINGS`), like `max-files`.
4. **File types.** Options: (a) every type GitHub accepts; (b) text and data only. **Answer: (a).**
5. **Archives.** Options: keep them as they are, or extract them. **Answer: extract them, with safeguards against malicious archives.**
6. **Where the maintainers see what was not downloaded.** Options: the job's log and the run comment, or the log only. **Answer: the log and the run comment.**

### Choices made in this work

1. **Where.** `.codeman/attachments/` in the agent's copy, with `README.md` as its index: for each link, where it was found (the issue's body, or whose comment), its URL, and its file, or why it is missing.
2. **File names.** A two-digit position, then the name from the link, or from the download for images, through `safeName` of `src/results.ts`: `01-data.csv`. A link that appears twice is downloaded once. An archive's content goes to a directory beside it: `02-data.zip.extracted/`.
3. **Only GitHub's attachments.** The adapter recognizes `github.com/user-attachments/files/` and `/assets/`, their older forms under a repository (`github.com/<owner>/<repo>/files/` and `/assets/`), and `user-images.githubusercontent.com` and `private-user-images.githubusercontent.com`. Other links stay text.
4. **The token.** Sent only to `github.com`, never on a redirect to another host. Redirects are followed by hand, over HTTPS, only to `github.com`, hosts under `githubusercontent.com`, and GitHub's `github-production-*.s3.amazonaws.com` buckets. A redirect to GitHub's sign-in page counts as refused.
5. **Settings.** All are whole numbers, set in the settings files only, as `max-files` is:

   | Setting | Default | Allowed | Meaning |
   | --- | --- | --- | --- |
   | `max-attachments` | `50` | `0` to `200`; `0` turns downloads off | Attachments downloaded per agent run |
   | `max-attachment-bytes` | `26214400` (25 MiB) | 1 to 104857600 (100 MiB) | Size limit of each attachment |
   | `max-attachment-total-bytes` | `104857600` (100 MiB) | 1 to 1073741824 (1 GiB) | Size limit of a run's attachments together |
   | `max-extracted-bytes` | `209715200` (200 MiB) | `0` to 2147483648 (2 GiB); `0` turns extraction off | Size limit of everything extracted from a run's archives |
   | `max-extracted-files` | `1000` | 1 to 10000 | Files extracted from a run's archives together |

6. **Time.** Downloads and extraction get 4 minutes per run, within the 10 minutes the agent job has for its own steps. What is left when they run out is listed as not downloaded.
7. **Archive safeguards.** Codeman extracts `.zip`, `.tar.gz`, `.tgz` and `.gz` itself, in Node.js, without running a program, before the agent's copy is made:
   - Only regular files and directories are written. Symbolic links, hard links and devices are skipped and listed.
   - A path that is absolute, has a `..` part, a drive letter or a control character is skipped. Every path is checked to stay inside the archive's directory, and no file is overwritten.
   - Sizes are checked against `max-extracted-bytes` before and while inflating, and the number of files against `max-extracted-files`, so an archive that expands without bound stops at the limit.
   - A ZIP entry that is encrypted, in ZIP64, or compressed by another method than stored or deflated is skipped. Its CRC-32 is checked.
   - An archive inside an archive is not extracted.
   - An archive that cannot be read stays as it is, and the index says why.
8. **Failures never fail the run.** What was not downloaded or extracted is in the index, the job's log and the run comment.
9. **Untrusted data.** The prompt's new section says the files came from the conversation and are data, not instructions, as the workflow results section does.
10. **Nothing reaches the branch on its own.** If the task needs a file in the repository, such as a test fixture, the agent copies it there, as any other change.

## Steps

1. **Third-party docs.** Add "Attaching files" and the community discussion on private attachments to `docs/web/github/`. The REST pages for issues, issue comments, reviews and review comments, with their `full+json` media type, are already there. Done when `npm test` passes `src/webdocs.test.ts` and `src/docs.test.ts`.
   - **Done on 2026-11-26.**
2. **How attachments download.** Record the URL forms and redirects of public attachments, and what is known of private ones. Done when the table above is filled.
   - **Done on 2026-11-26,** on public issues only: the responsible person checks private repositories after the merge (step 9).
3. **Settings.** Failing tests in `src/settings.test.ts` for the five settings: defaults, bounds, `0` where allowed, and where they may be set. Then add them to `src/settings.ts` and `templates/settings.yml`. Done when the tests pass.
4. **Archives.** Failing tests in a new `src/archives.test.ts`, with archives built in the test: files and directories extracted; links, `..` and absolute paths skipped; the byte and file limits, including a deflate bomb; a bad CRC; a nested archive kept as a file. Then `src/archives.ts`. Done when the tests pass.
5. **Attachments.**
   - An `Attachments` interface in `src/platform/platform.ts`, a service in `src/services.ts`, and `FakeAttachments` with its own link format.
   - The GitHub adapter in `src/platform/github/attachments.ts`, with tests on a fake `fetch` and Octokit: links found, the token only on `github.com`, redirects checked, the `body_html` fallback, the size limit while reading.
   - `src/attachments.ts`, with tests: the texts of the task, limits, names, the index, extraction, and the problems reported.

   Done when the tests pass.
6. **The agent job and the run comment.** `agentJob` downloads into a directory of its own and copies it to `.codeman/attachments/`. `src/prompt.ts` gets the section, `Manifest` gets the problems, and `apply` lists them in the run comment, in English and Portuguese. Tests in `src/prompt.test.ts`, `src/steps/apply.test.ts` and `src/i18n/i18n.test.ts`. Done when they pass.
7. **Templates.** `issues: read` and `pull-requests: read` for the agent job's token, `TEMPLATE_VERSION` 4, and `template-version: 4` in every step of both templates. Done when `src/templates.test.ts` and `src/action.test.ts` pass.
8. **Docs.** Done when `npm run check` passes:
   - a new page, `docs/tasks/attachments.md`, linked from `docs/README.md`;
   - `docs/runs/agent.md`, `docs/settings/reference.md`, `docs/security/risks.md`, `docs/security/secrets.md`, `docs/installation/setup.md` and `docs/development/platforms.md`;
   - an entry in `docs/installation/upgrading.md` for template version 4.
9. **Check on real repositories.** After the merge, the responsible person runs tasks with attachments on public and private repositories. If something fails, the plan is reopened.
10. **Commits.** On `features/issue-attachments`, as authorized on 2026-11-26 until the plan is done. The responsible person opens the pull request and merges it.

## Out of scope

- **Attachments from people who are not maintainers.** Their issues are not tasks, and their comments do not reach the agent.
- **Links to other hosts**, such as cloud drives or object stores. They stay text, which the agent may fetch on its own when they are public.
- **Committing attachments automatically.** The agent copies a file into the repository only when the task calls for it.
- **GitHub Enterprise Server**, whose attachment URLs may differ. Codeman targets GitHub.com.
- **Attachments the agent writes.** The agent cannot attach files to its comments. Its outputs stay text and commits.
- **Extracting other formats**, such as `.7z`, `.rar`, `.tar.bz2` or `.tar.xz`, which GitHub does not accept as attachments.
