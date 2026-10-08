---
status: in progress
created_at: 2026-10-08T15:47:37-03:00
updated_at: 2026-10-08T16:22:31-03:00
commit: 2a23d6a
---

# Organize the docs

## Goal

Each subject of Codeman's documentation has its own file, grouped in directories by subject, so a reader finds it and reads it in one go, without losing or duplicating anything. One subject is also enriched: how a provider's settings go with it across layers and profiles, with worked examples.

## Context

- **Sizes at `2a23d6a`.** `docs/architecture.md`: 499 lines, 85 KB, 38 sections. `docs/installation.md`: 252 lines, 25 KB. `docs/security.md`: 131 lines, 19 KB. `docs/dependencies.md`: 123 lines, 14 KB. `docs/development.md`: 49 lines, 5 KB. The amount is fine (the responsible person, 2026-10-08); the problem is that unrelated subjects share a file.
- **What is mixed.** `architecture.md` holds the task lifecycle, the run's jobs, the agent's sandbox and output, budgets, OpenRouter's keys, self-hosted inference, the backend, settings, providers, profiles, commands, comments and the platform interfaces. Its "Budget" section alone mixes the budgets, how OpenRouter keys are opened and measured, and the spend table. `installation.md` mixes first-time setup, the backend's Google Cloud setup, Runpod, profiles and upgrade notes for older settings and workflow files.
- **Provider settings across layers.** Today one sentence (`architecture.md`, line 372, "Providers") and repeats in "Profiles" (line 427) and in installation's "Profiles". The rule is in `serving` and `resolveRun` (`src/settings.ts`), from choice 9 of the [provider settings plan](2026-10-08-provider-settings.md). The responsible person asked for worked examples and a summary table.
- **What depends on the paths and anchors** (`git grep` at `2a23d6a`):
  - 232 relative links inside the five files: 82 same-file anchors (`#budget`), 53 to one another, 97 to other paths (`../templates/`, `../src/`, `plans/`, `web/`) whose depth changes when a file moves into a directory.
  - `README.md`: 9 links, including the "Learn more" list.
  - 28 plans, all `completed`: 79 links to the five files.
  - `docs/web/npm/package-metadata.md` (written in our own words): 1 link to `dependencies.md`.
  - 31 mentions in 26 files of `src/`, `templates/` and `docker/`: code comments (`See docs/architecture.md#pods`), two runtime strings (`src/store/backend.ts`'s `SETUP`, shown in the backend's errors and asserted by `src/store/backend.test.ts`; `src/inference/selfhosted.ts`, "No pod image is pinned; see docs/installation.md."), and the templates: `templates/codeman.yml` and `templates/codeman-task.yml` link `https://github.com/codenergy-dev/codeman/blob/main/docs/installation.md`, and `templates/settings.yml` links `.../blob/main/docs/architecture.md#settings` and mentions `docs/installation.md`. Target repositories hold copies of those templates, so their URLs are public and outlive a move.
  - Both runtime strings are bundled into `dist/index.js`, which must be rebuilt.
  - `src/inference/providers.test.ts` reads `docs/architecture.md` and splits it on `^#### ` to compare each provider's documented settings, defaults and secrets with the registry.
  - `AGENTS.md` names only `docs/`, `docs/plans/` and `docs/web/`. Its `##` sections are the working rules Codeman gives the agents it runs on other repositories (`src/rules.ts`); the text before the first `##` is not sent.
- **No link checker exists.** No test reads Markdown links; `src/webdocs.test.ts` checks only `docs/web/` front matter and names. A scan at `2a23d6a` finds one broken link outside `docs/web/`: `docs/plans/2026-10-08-provider-settings.md` links `../architecture.md#inference-profiles`, an anchor that plan renamed. The full copies in `docs/web/` keep their source's links (`/en/actions/...`, `./gpu.mdx`), which do not resolve here and are not ours to fix.
- **`docs/plans/` and `docs/web/`** keep their layout: their paths are rules in `AGENTS.md` and in the code (`WEB_DIR`, the plan path `select` gives each task), and Codeman gives the same rules to other repositories.

## Proposed tree

Every new file starts with an H1. A section that becomes a file's top level is promoted (`###` to `##`); its heading text stays, so its anchor stays (`#shared-pods`). Where a file's H1 repeats an old section's name (`# Budget`, `# Settings`, `# Backend`), the old anchor keeps working on the new file. Line numbers are at `2a23d6a`.

```
docs/
├── README.md                              Index: every file, one line each, by reader (decision 2)
├── tasks/                                 What a task goes through, as maintainers see it
│   ├── lifecycle.md                       States and their labels; planning
│   ├── stages.md                          The stages, routing, running a stage, feedback
│   ├── commands.md                        Every /codeman command
│   └── comments.md                        Status, decisions and run comments; conversation language
├── runs/                                  How a run executes
│   ├── runs-and-jobs.md                   Triggers, concurrency, parallel tasks; the jobs and their credentials
│   ├── agent.md                           The agent's sandbox, its working rules, its output and limits
│   └── changes.md                         What the agent may change: change policy, on-demand workflows, docs/web/
├── settings/                              What a repository configures
│   ├── reference.md                       Layers, every setting, the file format
│   ├── providers.md                       Each provider's settings, model IDs, secrets and cost; accounts
│   ├── profiles.md                        Profiles: conditions, which applies, layers, checks
│   └── provider-settings-across-layers.md NEW: worked examples and a summary table
├── inference/                             Where models are served
│   ├── openrouter.md                      Per-run OpenRouter keys, usage, analytics, key encryption
│   ├── self-hosted.md                     Runpod providers compared, choosing, the interfaces, the gateway
│   ├── pods.md                            The pod registry, leases, shared pods
│   └── serverless.md                      Endpoint checks, the job queue, worker-time estimates and splits
├── budget/                                What a task may spend and what it spent
│   ├── budget.md                          Task, month and organization budgets; reservations, expiry, refusals
│   └── spend.md                           The spend table; how self-hosted runs count
├── backend/                               Codeman's records
│   ├── backend.md                         Firestore: access, client, rules, cost; the store; the ledger
│   └── data-layout.md                     Collections, documents, IDs, events and queries
├── installation/                          Setting Codeman up on a repository
│   ├── setup.md                           Steps 1 to 5, parallel tasks, and trying it
│   ├── shared-settings.md                 The organization's CODEMAN_SETTINGS
│   ├── runpod.md                          The Runpod account, pods, a Serverless endpoint
│   ├── profiles.md                        How to write profiles
│   └── upgrading.md                       Old setting names; workflow files copied before the backend
├── security/
│   ├── overview.md                        Whom it is for, the checklist, the roadmap
│   ├── secrets.md                         Each secret: who uses it, why it is safe, gaps, mitigations
│   └── risks.md                           Risks 1 to 7; untrusted input
├── development/                           Working on Codeman itself
│   ├── guide.md                           Scripts, source layout, Firestore's emulator, conventions
│   ├── platforms.md                       Platform interfaces and what an adapter must guarantee
│   └── dependencies.md                    The dependency audit record
├── plans/                                 Unchanged
└── web/                                   Unchanged
```

31 files replace 5 (about 5 KB each; the largest are `security/risks.md`, `security/secrets.md` and `development/dependencies.md`, 8 to 14 KB, which are one subject each).

### Section-by-section mapping

`docs/architecture.md`:

| Lines | Section | Goes to |
| --- | --- | --- |
| 1–3 | `# Architecture` intro (templates, interfaces) | `runs/runs-and-jobs.md`, top |
| 5–27 | Tasks and states | `tasks/lifecycle.md` |
| 29–36 | Runs | `runs/runs-and-jobs.md` |
| 38–63 | Jobs | `runs/runs-and-jobs.md` |
| 65–75 | Agent sandbox | `runs/agent.md` |
| 77–82 | Agent rules | `runs/agent.md` |
| 84–94 | Budget: intro, Task, Month, Organization, Reservations, Expiry, Refusals, Secrets | `budget/budget.md` (H1 `# Budget`) |
| 95–96 | Budget: per-run keys; `close-key` reads usage and refreshes costs | `inference/openrouter.md` |
| 97–99 | Budget: the spend table, its notes, its total row | `budget/spend.md`, `## The spend table` |
| 100–102 | Budget: agent time and analytics tokens; throughput and context length; key encryption | `inference/openrouter.md` |
| 104–111 | Self-hosted inference: intro and table | `inference/self-hosted.md` |
| 113–121 | Choosing | `inference/self-hosted.md` |
| 123–130 | Layers | `inference/self-hosted.md` |
| 132–139 | The gateway | `inference/self-hosted.md` |
| 141–150 | Pods | `inference/pods.md` (H1 `# Pods`) |
| 152–160 | Shared pods | `inference/pods.md` |
| 162–170 | Serverless | `inference/serverless.md` (H1 `# Serverless`) |
| 172–180 | Spend | `budget/spend.md`, `## Self-hosted runs` |
| 182–190 | Backend | `backend/backend.md` (H1 `# Backend`) |
| 192–196 | The store | `backend/backend.md` |
| 198–212 | Data layout | `backend/data-layout.md` |
| 214–219 | The ledger | `backend/backend.md` |
| 221–229 | Planning | `tasks/lifecycle.md` |
| 231–241 | Stages | `tasks/stages.md` (H1 `# Stages`) |
| 243–256 | Routing | `tasks/stages.md` |
| 258–269 | Running a stage | `tasks/stages.md` |
| 271–280 | Feedback | `tasks/stages.md` |
| 282–289 | Third-party documentation | `runs/changes.md` |
| 291–299 | Agent output | `runs/agent.md` |
| 301–314 | Change policy | `runs/changes.md` |
| 316–328 | On-demand workflows | `runs/changes.md` |
| 330–366 | Settings | `settings/reference.md` (H1 `# Settings`) |
| 368–374 | Providers (line 372 moves to the new page; a link to it takes its place) | `settings/providers.md` (H1 `# Providers`) |
| 376–409 | `openrouter`, `runpod-pod`, `runpod-serverless` | `settings/providers.md`, as `##` |
| 411–430 | Profiles | `settings/profiles.md` (H1 `# Profiles`) |
| 432–452 | Commands | `tasks/commands.md` (H1 `# Commands`) |
| 454–466 | Status and run comments | `tasks/comments.md` |
| 468–475 | Conversation language | `tasks/comments.md` |
| 477–498 | Platforms | `development/platforms.md` (H1 `# Platforms`) |

`docs/installation.md`:

| Lines | Section | Goes to |
| --- | --- | --- |
| 1–3 | Intro | `installation/setup.md`, top |
| 5–56 | 1. Register the GitHub App; 2. Prepare OpenRouter; 3. Add the credentials | `installation/setup.md` |
| 58–116 | 4. Set up the backend | `installation/setup.md` (keeps `#4-set-up-the-backend`) |
| 118–127 | 5. Add the workflow and settings: steps and where settings are read | `installation/setup.md` |
| 129–137 | Settings written before the provider settings plan | `installation/upgrading.md` |
| 139 | Linux runner | `installation/setup.md` |
| 141 | Updating workflow files copied before the backend | `installation/upgrading.md` |
| 143 | Parallel tasks | `installation/setup.md` |
| 145–168 | Shared settings | `installation/shared-settings.md` (H1 `# Shared settings`) |
| 170–218 | Self-hosted inference on Runpod: the account, pods, Serverless | `installation/runpod.md` (H1 `# Self-hosted inference on Runpod`) |
| 220–244 | Profiles | `installation/profiles.md` |
| 246–252 | Try it | `installation/setup.md`, last |

`docs/security.md`:

| Lines | Section | Goes to |
| --- | --- | --- |
| 1–5 | Intro | `security/overview.md` (its "This document" covers the three files; reworded only where it names them) |
| 7–26 | Secrets | `security/secrets.md` |
| 28–98 | Risks 1 to 7 | `security/risks.md` |
| 100–108 | Untrusted input | `security/risks.md` |
| 110–121 | Checklist | `security/overview.md` |
| 123–131 | Roadmap | `security/overview.md` |

`docs/dependencies.md` goes whole to `development/dependencies.md`; `docs/development.md` goes whole to `development/guide.md`.

### The new page: `settings/provider-settings-across-layers.md`

Intended content. Every outcome and error below was checked at `2a23d6a` by running `resolveRun` (`src/settings.ts`) on these exact settings.

**The rule.** A provider's settings (`engine`, `gpu`, `endpoint`, `pod-reuse`) go with it. The layers apply from the bottom: Codeman's defaults (`provider: openrouter`), the organization's settings, the repository's file, a manual run's inputs; then the run's profile over the top level; then the task's commands. A layer or profile that names another provider than the one below it starts with none of the provider settings below; one that names the same provider, or none, keeps them and replaces only those it sets. Then the provider's defaults fill what is left (`engine`; `pod-reuse: task`). `model` is not a provider setting: it always carries over, and must fit the provider the run ends on. Budgets and limits are not provider settings either, and never drop.

**Why.** No layer can unset a value from a layer below: `gpu:` with no value is an error ("`gpu` must be a GPU type, such as `NVIDIA RTX A6000`."). Without the rule, a profile could not leave a provider whose settings the next one refuses.

**1. A profile that switches provider.**

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
profiles:
  - name: serverless-review
    when:
      stages: [review]
    provider: runpod-serverless
    endpoint: abc123xyz
    model: Qwen/Qwen3-Coder-30B-A3B-Instruct
```

Review runs: `runpod-serverless`, `endpoint: abc123xyz`, `engine: vllm` (its default), the Qwen model; no `gpu`, no `pod-reuse`. Every other run: `runpod-pod`, `qwen3-coder:30b`, `gpu: "NVIDIA RTX A6000"`, `pod-reuse: task` and `engine: ollama` (the defaults). Without the rule, the profile would inherit `gpu` and every run would stop with "Profile `serverless-review`: `runpod-serverless` does not accept `gpu`; besides `model`, it takes `engine` and `endpoint`.", with nothing the profile could write to fix it.

**2. A repository leaves the organization's pods.** The organization's `CODEMAN_SETTINGS`:

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
pod-reuse: run
task-budget: 1
```

The repository's `.codeman/settings.yml`:

```yaml
provider: openrouter
model: deepseek/deepseek-v4.1-flash
```

Runs: `openrouter` with `deepseek/deepseek-v4.1-flash`. The organization's `gpu` and `pod-reuse` are dropped; its `task-budget: 1` still applies. Had the file set only `provider: openrouter`, the organization's model would carry over, and the first run would stop with "With `openrouter`, `model` must be an OpenRouter model ID, such as `provider/model`, not `qwen3-coder:30b`." (no profile name: the error is in the top-level settings).

**3. No provider, or the same provider, keeps them.** Over the same organization's settings, a repository file with only `model: qwen2.5-coder:32b`, or with `provider: runpod-pod` and that model, runs `runpod-pod` with `qwen2.5-coder:32b`, the organization's `gpu` and `pod-reuse: run`. The same holds for profiles:

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
pod-reuse: run
profiles:
  - name: bigger-gpu
    when:
      stages: [code]
    gpu: "NVIDIA H100 80GB HBM3"
  - name: other-model
    when:
      stages: [test]
    provider: runpod-pod
    model: qwen2.5-coder:32b
```

Code runs: `qwen3-coder:30b` on `"NVIDIA H100 80GB HBM3"`, `pod-reuse: run`. Test runs: `qwen2.5-coder:32b` on `"NVIDIA RTX A6000"`, `pod-reuse: run`.

**4. `model` always carries over, and must fit.**

```yaml
provider: runpod-pod
model: qwen3-coder:30b
gpu: "NVIDIA RTX A6000"
profiles:
  - name: planner
    when:
      stages: [plan, route]
    provider: openrouter
```

The profile drops `gpu` but keeps the Ollama model, so the first run, whatever its stage, stops with "Profile `planner`: With `openrouter`, `model` must be an OpenRouter model ID, such as `provider/model`, not `qwen3-coder:30b`." The fix is a `model` in the profile. Codeman checks the model's form only: an OpenRouter ID such as `deepseek/deepseek-v4.1-flash` also has the form of an Ollama name and of a Hugging Face ID, so a `runpod-pod` or `runpod-serverless` profile without `model` under an OpenRouter top level passes the check. On Serverless, `open-key`'s endpoint check then refuses the run, since the worker serves another model; on pods, the pod fails to pull it, after Codeman created it. A profile that changes provider should always set `model`.

**Summary.**

| Where | Names a provider? | Provider settings from below (`engine`, `gpu`, `endpoint`, `pod-reuse`) | `model` from below |
| --- | --- | --- | --- |
| Organization's settings, repository's file, or a profile, without `provider` | No | Kept; those it sets replace them | Carries over, unless it sets one |
| The same, with the same provider as below | Yes, the same | Kept; those it sets replace them | Carries over, unless it sets one |
| The same, with another provider | Yes, another | Dropped; only its own, then the new provider's defaults | Carries over, unless it sets one; must fit the new provider |
| A manual run's inputs | Cannot (no `provider` input) | Kept | Its `model` replaces the top level's, not a profile's |
| A task's `/codeman set` | Cannot (no `set provider`) | `gpu` applies to the runs whose provider accepts it | Wins over every layer and profile; where it does not fit, reported as a problem and left out |

## Decisions

1. **Top-level organization of the tree.** Options:
   - (a) Subject directories, as in [Proposed tree](#proposed-tree): `tasks/`, `runs/`, `settings/`, `inference/`, `budget/`, `backend/`, `installation/`, `security/`, `development/`; 31 files.
   - (b) Directories by kind of reading: `guides/` (installation, profiles how-to), `reference/` (settings, commands, data layout), `internals/` (runs, inference, budget, backend), `security/`, `development/`. Good for a reader who knows what kind of page they want; a subject (profiles, pods) is then split across directories.
   - (c) Flat: about 15 files directly under `docs/` (`tasks.md`, `settings.md`, `inference.md`, `budget.md`, `backend.md`, `installation.md`, ...), no directories. Fewer moves; some files stay at 15 to 20 KB and mix sub-subjects (pods and Serverless; budgets and spend).

   Recommendation: (a). Each subject has one place, files read in one go, and a new subject (another provider, another platform) has an obvious home.

   **Answer:** (a), subject directories as proposed (the responsible person, 2026-10-08).
2. **Index file.** Options:
   - (a) One `docs/README.md`: every file with one line, grouped by reader (setting it up, using it, how it works, security, working on Codeman). GitHub shows it when browsing `docs/`. It holds navigation only, no project knowledge.
   - (b) (a), and a `README.md` in each directory as that subject's entry page. Shown when browsing a directory, but 9 more files to keep current, and "README.md" then means two things in `AGENTS.md`'s Documentation rules.
   - (c) No index: the root `README.md`'s "Learn more" lists the directories.

   Recommendation: (a). The root `README.md`'s "Learn more" links to it and to the few pages a newcomer needs.

   **Answer:** (a), one `docs/README.md` index (the responsible person, 2026-10-08).
3. **Links in completed plans** (79 links in 28 plans). Options:
   - (a) Update the link targets only (path and anchor), never their text or the plans' prose; mentions in code spans (`` `docs/architecture.md` ``) stay. Also fix the one broken link (`#inference-profiles` in the provider settings plan, to `settings/profiles.md`). The link checker covers plans.
   - (b) Leave them: each plan's `commit` names the tree its links were written for. The link checker skips `docs/plans/`, and plan links rot with every later move.
   - (c) (a), and also rewrite prose mentions of the old paths.

   Recommendation: (a). Plans are history, and their links are how a reader goes from a decision to what it produced; changing a target changes no decision. (c) rewrites history.

   **Answer:** (a): link targets only, never prose; fix the broken `#inference-profiles` link (the responsible person, 2026-10-08).
4. **`docs/web/` and `docs/plans/`.** Options:
   - (a) Keep both as they are. Their paths are rules in `AGENTS.md`, in the code (`WEB_DIR`, the plan path `select` gives tasks) and in what Codeman gives other repositories' agents.
   - (b) Move them too, such as `docs/third-party/`, changing `AGENTS.md`, the code, the prompts and every target repository's convention.

   Recommendation: (a). Nothing in them is disorganized: one plan per file, one page per file.

   **Answer:** (a), both stay (the responsible person, 2026-10-08).
5. **Anchors and URLs outside the repository** (the templates' copies in target repositories, errors printed by older pinned versions, bookmarks). Options:
   - (a) Leave a stub at each old path: its old headings, each followed by a link to the section's new place. Every old link keeps working; five files that only point elsewhere, which look like documentation and must be kept current (the link checker covers them).
   - (b) No stubs. Update every reference in the repository, including the templates' URLs, the code comments and the backend's error; old copies of the templates point to a missing file until they are copied again. From now on, the link checker keeps every in-repository reference, code comments and template URLs included, pointing at an existing heading.
   - (c) (b), and make the templates' doc URLs version-pinned (`blob/COMMIT_SHA/docs/...`), replaced with the SHA at install time like the action's, so each copy links the docs of the version it runs and later moves never break it. Changes installation's step 2 (it would also cover `settings.yml`) and `templates.test.ts`.

   Recommendation: (b). Codeman has one user, whose templates are copied again at each upgrade (installation already asks for it), so a one-time break costs little; stubs would be a second index to maintain. (c) is worth it once Codeman has outside users, as its own plan.

   **Answer:** (b): no stubs; update every in-repository reference (the responsible person, 2026-10-08).
6. **`AGENTS.md`'s Documentation rules.** Options:
   - (a) No change. `docs/README.md` (decision 2) shows the layout; `AGENTS.md` keeps working rules only.
   - (b) Add one generic rule to "Documentation", which Codeman also gives other repositories' agents: "Give each subject its own file in `docs/`, grouped in directories by subject; when a file grows to cover several subjects, split it. Keep the index of `docs/` current when adding, moving or removing a file." A repository whose `AGENTS.md` says otherwise still wins for its conventions (`src/rules.ts`).
   - (c) A Codeman-only line before the first `##` of `AGENTS.md`, which is not sent to other repositories, naming the tree.

   Recommendation: (b). Without a rule, agents keep appending to whichever file is at hand, which is how `architecture.md` grew; the rule is generic, so it holds for any repository. (c) is project knowledge, which belongs in `docs/README.md`.

   **Answer:** (b): one generic Documentation rule, which must hold for any repository, since `AGENTS.md`'s `##` sections go to the agents Codeman runs elsewhere (the responsible person, 2026-10-08).
7. **A link checker** (an in-house test, no dependency). Options:
   - (a) `src/docs.test.ts`, on `node:test`, over the tracked files (`git ls-files`, so `logs/` and `node_modules/` are never read): every relative Markdown link in `README.md`, `AGENTS.md` and `docs/` resolves to a file, and its anchor to a heading of that file, by GitHub's rules (lowercase; punctuation other than `-` and `_` removed; spaces to `-`; `-1`, `-2` for repeats). It skips code blocks and spans, URLs with a scheme, site-absolute paths (`/en/...`), and the pages under `docs/web/` that are full copies (with `license`), which keep their source's links. It also checks every `docs/<path>.md#<anchor>` named in `src/`, `templates/`, `docker/` and `action.yml`, and the templates' `https://github.com/codenergy-dev/codeman/blob/main/<path>#<anchor>` URLs, against the tree. A few unit tests on fixtures show that it fails on a missing file and on a missing anchor.
   - (b) (a), for `README.md` and `docs/` only (no code comments, no template URLs).
   - (c) No checker; rely on review.

   Recommendation: (a). The move changes about 350 references; only a test keeps them right afterwards, and the code comments and the public template URL are exactly the references a review misses.

   **Answer:** (a), the in-house link checker, no dependency (the responsible person, 2026-10-08).
8. **Overlaps found while mapping.** The same statements live in several files:
   - How profiles work is told twice, as reference (`architecture.md` "Profiles") and as how-to (installation's "Profiles"), with the same statements on conditions, order, layers and commands.
   - The old setting names are listed in both `architecture.md` (line 362) and `installation.md` (lines 129–137).
   - Firestore's free quota is stated in installation's step 4, architecture's "Backend" and dependencies' "Cloud Firestore".
   - The rule that a provider's settings go with it is stated in architecture's "Providers" (line 372) and "Profiles" (line 427), and in installation's "Profiles" (line 244).
   - Installation's "Profiles" says `parallel-tasks` "is not available yet" (line 239), while `parallel-tasks` exists (`settings.ts`, from 1 to 10) and installation's step 5 describes it.

   Options: (a) move them as they are and leave them for a later plan; (b) resolve them in this plan, keeping each statement in one place and linking to it from the others.

   Recommendation: (b), since the move already touches every one of those paragraphs.

   **Answer:** (b) (the responsible person, 2026-10-08): profiles' reference stays in `settings/profiles.md`, and `installation/profiles.md` keeps only the how-to steps and links to it; one list of old setting names, in `installation/upgrading.md`, linked from `settings/reference.md`; Firestore's free quota in one place (`backend/backend.md`, "Cost"), linked from the others; the provider-settings rule in `settings/provider-settings-across-layers.md`, linked from the others; and the outdated `parallel-tasks` line fixed.
9. **The worked examples' home.** Options: (a) their own file, `settings/provider-settings-across-layers.md`, as proposed; (b) a section of `settings/profiles.md`.

   Recommendation: (a): the rule spans layers as well as profiles, so it is its own subject.

   **Answer:** (a) (the responsible person, 2026-10-08).

## Steps

Content moves without rewording, except: links (targets and, where a link named "architecture" now points to another file, its text), the H1 of each new file, promoted heading levels, the sentence of line 372 (moved to the new page), `security/overview.md`'s first sentence (it names the three files), the root `README.md`'s "Learn more" list, the new page, and the overlaps of decision 8.

1. **Move the content.** With a script (kept outside the repository), copy each line range of [the mapping](#section-by-section-mapping) to its new file, add the H1s, promote headings, and remove the five old files. Done when a one-off comparison shows every non-blank line of the five old files exactly once in the new tree, ignoring link targets and heading levels, apart from the exceptions above; and no file under `docs/` other than the new tree, `plans/` and `web/` exists. **Done on 2026-10-08**: a script in the session's scratchpad copied the mapped line ranges, added the H1s and promoted headings; the five old files are removed. H1s: `Task lifecycle`, `Stages`, `Commands`, `Comments`, `Runs and jobs`, `The agent`, `What the agent may change`, `Settings`, `Providers`, `Profiles` (both), `OpenRouter`, `Self-hosted inference`, `Pods`, `Serverless`, `Budget`, `Spend`, `Backend`, `Data layout`, `Installation` (setup), `Shared settings`, `Self-hosted inference on Runpod`, `Upgrading`, `Security`, `Secrets`, `Risks`, `Platforms`; `development/guide.md` and `development/dependencies.md` keep theirs. Four headings were added where a part had none: `## The spend table` and `## Self-hosted runs` in `budget/spend.md`, `## Old setting names` and `## Workflow files copied before the backend` in `installation/upgrading.md`. The comparison found all 746 non-blank lines once, except `# Architecture`, whose intro went to `runs/runs-and-jobs.md`.
2. **Fix the links in the moved content.** Same-file anchors that now cross files, links to the five old files, and links to other paths whose depth changed (`../templates/` to `../../templates/`, `plans/` to `../plans/`, `web/` to `../web/`). Done when the link checker (step 8) passes for `docs/` outside `plans/`. **Done on 2026-10-08**: the same script rewrote every relative link by where its target went. Links named after a file that now point elsewhere got the name of their target: installation's encryption secret to [OpenRouter](../inference/openrouter.md) (key encryption is there, not in the budget), its backend link, Runpod's "how it works", the secrets table's jobs link and dependencies' sandbox link; `security/overview.md`'s first sentence names the three security files. Two targets were made more precise: the task key's row in `security/secrets.md` also links OpenRouter's page (expiry, encryption), and installation's "security for the secrets" links `security/secrets.md`.
3. **Write the new page**, `settings/provider-settings-across-layers.md`, with [its intended content](#the-new-page-settingsprovider-settings-across-layersmd). Link it from `settings/providers.md` (where line 372 was), `settings/profiles.md` ("Which applies") and `installation/profiles.md` (its last paragraph). Done when each example's outcome and error is asserted by a test in `src/settings.test.ts`: add those the existing tests lack (example 2's dropped `pod-reuse` and kept `task-budget`, and its top-level model error; example 3's profile without `provider`; example 4's Serverless and pod cases that pass the check). **Done on 2026-10-08**: the page holds the rule as a numbered list, why, the model in a section of its own (`#the-model`, the one place the following plan on profiles that switch provider changes), the four examples and the summary table; it is in the index. `src/settings.test.ts` has a `describe` block with one test per example, on the exact settings, asserting every outcome and error above, including the ones the existing tests lacked. The links replace the rule's three statements (decision 8): line 372 in `settings/providers.md`, the sentence in `settings/profiles.md`'s "Which applies", and the sentence in `installation/profiles.md`'s last paragraph.
4. **Resolve the overlaps**, per decision 8: `installation/profiles.md` keeps the how-to steps, without the statements `settings/profiles.md` makes, and links to it; `settings/reference.md` links to the list of old names in `installation/upgrading.md`, which gains what only architecture's sentence said; Firestore's quota is stated only in `backend/backend.md`; `settings/providers.md`, `settings/profiles.md` and `installation/profiles.md` link to the new page for the provider-settings rule; installation's `parallel-tasks` line says what the condition does. Done when a search finds each statement once, and the comparison of step 1 lists only these merges.
5. **Write the index**, per decision 2, and the root `README.md`'s "Learn more". Done when the index lists every file under `docs/` except `plans/` and `web/` (which it lists as directories), once each. **Done on 2026-10-08**: [`docs/README.md`](../README.md) lists every file once, by reader, and `plans/` and `web/` as directories. The root README's "Learn more" links the index, settings, the task lifecycle and stages, security and development.
6. **Update every reference outside the moved content**: `README.md` (9 links); `templates/codeman.yml`, `templates/codeman-task.yml`, `templates/settings.yml` (4); the code comments and strings in `src/` (26 in 22 files, including `src/store/backend.ts`'s `SETUP` and its assertion in `src/store/backend.test.ts`, and `src/inference/selfhosted.ts`'s error); `docker/pod/Dockerfile` (1); `docs/web/npm/package-metadata.md` (1); the plans per decision 3 (79 links in 28 files, and the broken `#inference-profiles`). Done when `git grep -nE "docs/(architecture|installation|security|dependencies|development)\.md|\]\((\.\./)*(architecture|installation|security|dependencies|development)\.md"` finds nothing outside `docs/plans/` prose and code spans, and the link checker passes. **Done on 2026-10-08**. Code comments point to the file of their subject (the gateway's to `inference/self-hosted.md#the-gateway`, the pods' to `inference/pods.md`, Serverless's to `inference/serverless.md`, the store's to `backend/backend.md#the-store`, the layout's to `backend/data-layout.md`, `main.ts` to `runs/runs-and-jobs.md#jobs`); the pod image's error and `ollama.ts` to `installation/runpod.md#pods`; `SETUP` to `installation/setup.md#4-set-up-the-backend`. Templates: setup URL to `docs/installation/setup.md`, settings reference to `docs/settings/reference.md`, and `settings.yml`'s "secrets each needs" to `docs/settings/providers.md`, which lists them per provider. Plans: whole-file links to `architecture.md` go to the index (its content is now spread over many files), the other old files' to `installation/setup.md`, `security/overview.md`, `development/guide.md` and `development/dependencies.md`; four links go where their content now is (two OpenRouter mentions to `inference/openrouter.md`, the spend table's to `budget/spend.md#the-spend-table`, the old names' list to `installation/upgrading.md#old-setting-names`), and `#inference-profiles` to `settings/profiles.md`. The `git grep` finds nothing.
7. **Update the doc-reading test**: `src/inference/providers.test.ts` reads `docs/settings/providers.md`, whose providers are `##` sections. Done when it passes, and fails when a provider's documented default is changed by hand (checked once, not committed). **Done on 2026-10-08**: it reads the `##` sections whose heading starts with a provider's name in code; changing `pod-reuse`'s default to `run` by hand made it fail (not committed).
8. **Add the link checker**, per decision 7. Done when it passes on the new tree, and its fixture tests fail on a missing file and a missing anchor.
9. **`AGENTS.md`**, per decision 6. Done when `src/rules.test.ts` passes and the rules the agent job writes include the new line.
10. **Rebuild and check.** `npm run build` (the backend's and the pod image's error strings change in `dist/index.js`; `dist/gateway.js` must not change), then `npm run check`. Done when it passes and `git status -- dist/` shows only `dist/index.js`.
11. **Close the plan**: each step's outcome recorded here, status `completed`. Commits are authorized for this plan (the responsible person, 2026-10-08): the plan first, then each step or coherent group of steps; no push.

## End-to-end check

On the plan's branch, pushed with authorization:

1. **Browse.** On GitHub, open `docs/README.md`, follow every link, and read three files end to end (`settings/provider-settings-across-layers.md`, `budget/budget.md`, `installation/setup.md`): each reads alone, its links land on the right heading, and no section is missing compared with the five old files at `2a23d6a`.
2. **The settings template URL.** Open the URL in `templates/settings.yml`, with `main` replaced by the branch: it lands on the settings' heading. After the merge, the URL as written does.
3. **The backend's error.** `src/store/backend.test.ts` asserts the new path; the path, opened on GitHub, lands on step 4 of setup.
4. **Links.** `npm test` passes; changing one anchor in a doc by hand makes the link checker fail, naming the file, the line and the link.
5. **The examples.** Paste example 1's settings into the test repository's `.codeman/settings.yml` (with its real endpoint) and run `select` once: its log names `serverless-review` for a review run, and the run's settings have no `gpu`. Optional: costs nothing until `open-key`.

## Out of scope

- Rewording, shortening or correcting the moved content, beyond the overlaps of decision 8.
- Requiring a `model` in a profile or layer that switches provider: a following plan. The new page keeps that rule in one section, so the change touches one place.
- Making the model check provider-aware beyond its form (example 4's caveat): a code change, for its own plan.
- Version-pinned doc URLs in the templates (decision 5, option c).
- `docs/web/` and `docs/plans/` layout (decision 4), and the third-party links inside `docs/web/` copies.
- `logs/`, which is never touched.
