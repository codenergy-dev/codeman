---
status: in progress
created_at: 2026-10-19T13:31:14-03:00
updated_at: 2026-10-19T13:32:57-03:00
commit: ffe11b3
---

# Repository override of the organization's settings

## Goal

Decide whether Codeman should detect or prevent a repository variable `CODEMAN_SETTINGS` that replaces the organization's, and make the docs state the outcome and its reasons. This is decision 6b of the [correction plan](2026-10-16-correct-the-docs-against-the-code.md).

## Context

`templates/codeman.yml:179` passes `${{ vars.CODEMAN_SETTINGS }}` as `select`'s `settings` input, the [organization's settings](../glossary.md#organizations-settings). GitHub gives a repository variable precedence over an organization variable of the same name ([precedence](../web/github/variables-reference.md#configuration-variable-precedence)). Anyone with write access to an organization repository can create one ([creating variables](../web/github/store-information-in-variables.md#creating-configuration-variables-for-a-repository)).

The docs already state the boundary:

- Write access to a repository that receives Codeman's secrets is access to all of them, through a workflow on any branch ([who can read Codeman's secrets](../security/overview.md#who-can-read-codemans-secrets)).
- The same people can override `CODEMAN_SETTINGS` and `CODEMAN_COMMIT_SHA` for that repository (same section, and the warning in [shared settings](../installation/shared-settings.md#settings-only-the-organization-sets)).

### What the override does, at `ffe11b3`

| Effect | Where |
| --- | --- |
| `select` parses the input as the organization's settings, whatever level the value came from | `src/steps/select.ts:89` |
| With no `organization-monthly-budget` in it, `select` outputs it empty, and `open-key` checks no organization limit for that repository's runs. The other repositories still count those runs: the ledger's month is the organization's | `src/steps/select.ts:721-726`, `src/steps/keys.ts:61-64` |
| `select` declares the pool the value sets, or the organization alone | `src/steps/select.ts:93` |
| `handshake` writes that declaration on the **organization's** document, not the repository's | `src/board.ts:117-136`, called at `src/steps/select.ts:322` |
| The `select` log calls the value "organization variable CODEMAN_SETTINGS" in every case | `src/settings.ts:28` |

### Reproduction

A scratch test on the fake platform (`/private/tmp/claude-503/-Users-lucaslannes-Developer-codenergy-codeman/6aeed83c-b366-4954-a252-409f507352f1/scratchpad/repro6b/override.test.ts`, outside the repository) drove `select` for three repositories: `org-a/one` and `org-b/x` with `pool: [org-a, org-b]` and `organization-monthly-budget: 100`, and `org-a/two` with `model: a/b`, as a repository variable would. In that order:

1. After `org-a/one`, the document `organizations/org-a` declares `org-a+org-b`.
2. After `org-a/two`, it declares `org-a` alone. `org-a/two`'s task has `organization-monthly-budget` empty.
3. `org-b/x` then warns: "Organization org-a declares pool `org-a`, not `org-a+org-b`: its repositories are not batched with this one's."
4. Another `org-a/one` run declares `org-a+org-b` again.

So one repository's override does more than the docs say. It does not only take that repository out of the pool: until another repository of the organization runs `select`, the other members batch with **none** of the organization's repositories. The declaration flips with each repository's run. The [handshake](../runs/batches.md#the-handshake) still requires both sides to agree, so an override cannot pull another organization in.

### What GitHub offers

Checked against GitHub's pages on 2026-10-19. The facts are in `docs/web/github/`; three summary pages gained a section for them (see Decision 3).

- **No template-only way exists.** The `vars` context is one mapping of names to values, with no key per level ([`vars` context](../web/github/contexts-reference.md#vars-context)).
- **The `GITHUB_TOKEN` cannot read variables.** Its permissions have no key for them ([`permissions`](../web/github/workflow-syntax-for-github-actions.md#permissions)).
- **An App token can, with the repository permission "Variables: read"** ([Variables permissions](../web/github/permissions-required-for-github-apps.md#repository-permissions-for-variables)):
  - `GET /repos/{owner}/{repo}/actions/variables/{name}` tells whether the repository has its own `CODEMAN_SETTINGS`;
  - `GET /repos/{owner}/{repo}/actions/organization-variables` lists the organization variables shared with the repository, with their values, 30 per page at most ([list repository organization variables](../web/github/rest-api-endpoints-for-github-actions-variables.md#list-repository-organization-variables)).
- The App has no Variables permission today ([setup](../installation/setup.md#1-register-the-github-app)). Adding one makes every installation approve it, in every organization of a pool ([changing permissions](../web/github/modifying-a-github-app-registration.md#changing-the-permissions-of-a-github-app)). Until approved, an installation keeps its old permissions ([create-github-app-token](../web/github/create-github-app-token.md)).

### What write access already gives

Whoever can create the repository variable can also push a workflow, on any branch, that reads every Codeman secret the repository receives ([who can read Codeman's secrets](../security/overview.md#who-can-read-codemans-secrets)). With those:

- the Runpod key creates and terminates pods on the pool's account, with no Codeman budget in the way;
- the OpenRouter management key creates keys with no limit on the account's credits;
- the App's private key mints tokens for every installation of the App, every pool member included, with Contents and Workflows write.

None of this goes through `select`. So a check in `select` cannot hold `organization-monthly-budget` or `pool` against such a person. It can only catch an override made by mistake, or by someone who keeps to Codeman's own path.

## Decisions

Answered on 2026-10-19 with the recommendation of each, under the responsible person's approval of the correction plan's recommendations. For decision 3, the sections added to the three `docs/web/github/` summary pages are kept: they record facts this plan relies on, in Codeman's words, as those pages already do; the responsible person may still ask to revert them.

### 1. Mitigate the override in code or in the templates?

| Option | What it prevents | Cost |
| --- | --- | --- |
| a) **No change; document the boundary** | Nothing new. The docs already say these settings hold only as far as write access is trusted | Docs only. Step 2 fixes what they understate: the organization-wide pool declaration |
| b) **Detect a repository-level `CODEMAN_SETTINGS` in `select`**, through `GET /repos/{owner}/{repo}/actions/variables/CODEMAN_SETTINGS`, and refuse or warn | An override by mistake. Not a person with write access, who has the secrets. A rollback through `CODEMAN_COMMIT_SHA` to a commit without the check fails, since the template version rises | The App's "Variables: read" (see below). `permission-variables: read` in `select`'s token request (`templates/codeman.yml:162-169`). Template version 1 → 2, so every repository copies both templates again. A new platform method, its fake and tests, `dist/` rebuilt. One API call per `select` run. Refusing breaks repositories that set `CODEMAN_SETTINGS` on purpose, such as a personal account's, which has no organization variables; refusing only when an organization variable also exists takes a second call. Warning is read only by whoever opens the `select` log |
| c) **Read only the organization's variable in the template** | Not possible: no context or `GITHUB_TOKEN` permission reads one level alone (see [what GitHub offers](#what-github-offers)) | — |
| d) **Read the organization's value through the API**, from `GET /repos/{owner}/{repo}/actions/organization-variables`, in `select` or in a template step, instead of `vars` | Same as b, and the override has no effect at all instead of being reported | Same permission and approvals as b. A template step needs no version bump, but then the code does not depend on it and an older copy keeps reading `vars`; in `select`, the bump is needed. Paginated (30 per page). Changes a documented behavior: a repository variable stops working as shared settings, personal accounts included. Unverified: what the endpoint returns on GitHub Free private repositories, which cannot read organization variables |
| e) **Detect a divergence in the store.** `handshake` already reads the declaration another repository of the organization wrote; `select` could warn when it differs from its own | A mistake, for `pool` only, and only after another repository has run. Covering `organization-monthly-budget` needs a new field on the organization's document | No permission, no API call, no template version. A code change and tests, `dist/` rebuilt. A storage-schema change for the budget. A legitimate change of the organization variable warns once too |

The App permission that b and d need is a security change, a critical decision under `AGENTS.md`:

- "Variables: read" lets the App's key read the variables of every repository it is installed on, and the organization variables shared with them, in every organization of a pool.
- That key is readable by anyone with write access to any repository that receives it ([risk 8](../security/risks.md#8-a-pool-shares-one-app-key)). So people in one organization of a pool could read another's variables, which they cannot today.
- Variables hold no secrets, so the exposure is small. It still widens the App's permissions for a check that protects nothing against the people it would target.

**Recommendation: a).** The override grants nothing beyond what write access already gives: the secrets spend and stop the pool's pods, and reach every pool member, without `select`. b and d buy a guard against mistakes at the price of a wider App permission, an approval in every installation, a template version and, for d, a behavior change. e is cheaper, but catches only part of it and adds a schema field. The docs already warn; step 2 completes them.

### 2. The log's label "organization variable"

`SHARED_SETTINGS` (`src/settings.ts:28`) names the source "the `settings` input (organization variable CODEMAN_SETTINGS)", also when a repository variable replaced the organization's. Readers check this line to confirm the shared settings apply ([shared settings](../installation/shared-settings.md#create-the-variable)).

- a) Keep the label, and say in `installation/shared-settings.md` that the line reads the same for a repository variable. Docs only.
- b) Reword it to "the `settings` input (variable CODEMAN_SETTINGS)". A code change: `src/settings.ts:28`; the strings in `src/steps/flow.test.ts:658,685` and `src/settings.test.ts:125,158`; the examples in `installation/shared-settings.md:22`, `settings/reference.md:87` and `installation/setup.md:424`; `dist/` rebuilt; no template version change. It would add a step between steps 2 and 3.

**Recommendation: a).** The label is true for the setup the docs describe. b makes it true in every case, but tells no more: Codeman cannot see the level without the API.

### 3. Three summary pages in `docs/web/github/` gained a section

To rely on GitHub's facts above, this plan added a section to `contexts-reference.md`, `permissions-required-for-github-apps.md` and `workflow-syntax-for-github-actions.md`, from the pages fetched on 2026-10-19, and set their `updated_at`. Their earlier facts were checked against the same fetch. The correction plan's Out of scope says "pages that are missing are only added", and `AGENTS.md` refreshes a page only on request.

- a) Keep the sections (recommended): each page is a summary of what Codeman relies on, and these are new facts it relies on.
- b) Revert them, and cite the facts only in this plan.

## Steps

Each step is one commit. A step is done when its files are changed as stated and `npm test` passes. No step changes code, so `dist/` and the template version stay as they are.

### 1. Record the reasoning

1. Record the answers to the decisions above, and set this plan `in progress`.
2. Include the three `docs/web/github/` sections, if decision 3 keeps them.

Commit message: `Plan the response to a repository CODEMAN_SETTINGS`.

### 2. State the boundary and the override's whole effect in the docs

1. `security/overview.md#who-can-read-codemans-secrets`, the `CODEMAN_SETTINGS` bullet: add that the repository's runs also rewrite the pool the organization declares, for all its repositories ([the handshake](../runs/batches.md#the-handshake)). After the list, add: "Codeman does not detect these variables. Whoever can create one can already read every secret above, and spend or stop the pool's pods with them, so a check in `select` would hold back no one it targets."
2. `installation/shared-settings.md`, the warning under "Settings only the organization sets":
   - replace "and the repository leaves the pool or declares another list" with: its runs declare that variable's pool, or none, as the organization's, so until another of the organization's repositories runs, the other members batch with none of them;
   - end with "Codeman does not detect such a variable", linking to the security section.
3. With decision 2a, in `installation/shared-settings.md#limits`, the bullet on the repository variable: add that the `select` log still says "organization variable CODEMAN_SETTINGS".
4. `security/overview.md` checklist item 9 needs no change: it already links to the section.

Done when both pages say it, links resolve (`src/docs.test.ts`), and `npm test` passes.

Commit message: `Document the organization-wide effect of a repository CODEMAN_SETTINGS`.

### 3. Close decision 6 in the correction plan

1. In the [correction plan](2026-10-16-correct-the-docs-against-the-code.md), decision 6: link this plan, and record that 6b was looked into and answered with no code change.
2. In its Decisions intro, drop 6b from the code changes that get a plan, or mark it answered.
3. Set this plan `completed`.

Commit message: `Close the decision on a repository CODEMAN_SETTINGS`.

## Out of scope

- A repository variable `CODEMAN_COMMIT_SHA`, which the same people can set. It is limited to commits of Codeman's `main`, and covered by [risk 7](../security/risks.md#7-codemans-own-code-and-dependencies).
- Repository variables for the backend (`CODEMAN_FIREBASE_PROJECT` and the others). The backend admits only `codeman.yml` on the default branch, so they cannot point a run at another repository's data.
- Moving Codeman's secrets into an Environment with required reviewers, which would change the boundary itself.
- The flipping of the organization's pool declaration in the code. Making `handshake` ignore a repository's divergent declaration would need option b, d or e.
