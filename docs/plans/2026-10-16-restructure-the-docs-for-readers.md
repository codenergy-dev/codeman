---
status: in progress
created_at: 2026-10-16T17:52:56-03:00
updated_at: 2026-10-17T13:20:00-03:00
commit: ebb63ac
---

# Restructure the docs for readers

## Goal

Each section of `README.md` and `docs/` carries one subject, and lets Markdown carry the structure: headings, steps, tables, callouts and diagrams. The docs become ready to be the source of Codeman's documentation site on GitHub Pages, for users and maintainers.

## Context

The docs are already split into one subject per file. The prose inside the files is the problem: single sentences and paragraphs carry several subjects at once.

Eight reviewers read the docs, each taking one group of files, and checked them against the code. A scan of the 36 files outside `docs/web/` and `docs/plans/` found:

| Measure | Count |
| --- | --- |
| Paragraphs or list items over 80 words | 105 |
| Sentences over 45 words | 99 |
| Longest block (`inference/pods.md`, step 5) | 247 words |
| Files with no `##` heading | 9 |
| Files with an H3; files with an H4 | 4; 0 |
| Diagrams, callouts, images, blockquotes | 0 |
| Tables; code blocks | 29; 50 |

The densest files are:

- `settings/vllm.md`, with 12 paragraphs over 80 words;
- `inference/pods.md`, `budget/spend.md` and `settings/ollama.md`;
- `inference/openrouter.md`, `inference/serverless.md` and `budget/budget.md`, which have no headings at all.

The same concepts are restated in several places and have drifted. For example:

- the settings layers appear in 5 places;
- the per-job credentials in 2;
- the pod images in 4;
- the pool trust statement in 3;
- the "without the block" defaults of the pod engines in 5.

Several terms carry more than one meaning:

| Term | Meanings |
| --- | --- |
| run | a workflow run, an agent run, a ledger run, a gateway run, a queue job |
| pool | a Workload Identity pool, a pool of organizations |
| provider | the Workload Identity provider, the inference provider |
| condition | the attribute condition, a profile's condition |
| version | Codeman's commit, the template version, the pinned images |

Tests read the docs, so the restructuring must keep:

- **Every link and anchor.** `src/docs.test.ts` checks relative links in `README.md`, `AGENTS.md` and `docs/`. It also checks each `docs/<path>.md#<anchor>` named in `src/`, `templates/`, `docker/` and `action.yml`. Some anchors appear in runtime error messages:
  - `settings/ollama.md#pod-images`, `settings/vllm.md#pod-images`;
  - `installation/runpod.md#pods`;
  - `installation/setup.md#4-set-up-the-backend`, which has 13 referrers.

  An anchor can be kept with an `<a id="…">`, which the test accepts.
- **`settings/providers.md`**, which `src/inference/providers.test.ts` parses:
  - the headings `` ## `openrouter` ``, `` ## `runpod-pod` `` and `` ## `runpod-serverless` ``, in that order;
  - Name and Default as the first two columns;
  - the `- **Secrets:** ` bullet;
  - no `###` before the table.
- **`settings/ollama.md` and `settings/vllm.md`**, which `src/inference/ollama.test.ts` and `vllm.test.ts` parse:
  - `## Accepted keys` and `## Refused keys`, with the same text;
  - the order of the first three columns;
  - the refusal reasons, which must equal the code's strings;
  - the version strings.
- **`## Example` in `settings/profiles.md`**, which `src/testing/settings-example.ts` reads.
- **The front matter of `docs/web/`**, a format that `src/webdocs.ts` validates. No site keys can be added there.

The [correction plan](2026-10-16-correct-the-docs-against-the-code.md) fixes the facts first. Each area here starts once its corrections are in.

## Decisions

Answered by the responsible person on 2026-10-16: the recommended option of each decision, which comes first in the list.

1. **Diagrams.**
   - a) Mermaid fences (recommended). GitHub renders them, and site generators read them with a plugin. Use SVG files only when Mermaid cannot draw the idea.
   - b) SVG images only.
   - c) Both, generated from one source.
2. **Callouts.**
   - a) GitHub alerts (recommended), limited to `> [!NOTE]`, `> [!IMPORTANT]` and `> [!WARNING]`. Word each one so it still reads as a plain blockquote, since some generators do not render alerts.
   - b) A plain `> **Note.**` blockquote.
3. **Writing conventions.**
   - a) A new page, `docs/development/documentation.md` (recommended). It holds Codeman's own conventions: when to use a list, table, steps, callout or diagram; how to keep anchors; images in `docs/<subject>/images/` with alt text; the tests that read the docs. Also add one generic bullet to the Documentation section of `AGENTS.md`: "Let Markdown carry structure: one subject per section and per sentence; steps, tables, callouts and diagrams instead of long paragraphs."

     `AGENTS.md`'s sections are given to agents working on other repositories, so that bullet changes their behavior too.
   - b) Only the new page, with no change to `AGENTS.md`.
4. **A glossary.**
   - a) `docs/glossary.md`, linked from the index and from a term's first use on each page (recommended). It defines one meaning per term and qualifies the others: workflow run, agent run, Workload Identity pool, inference provider, and so on.
   - b) A "Terms" section on each page.
5. **Shared pod-engine page.**
   - a) A new `docs/settings/pod-engines.md` (recommended). It holds what Ollama and vLLM share: the block, parallel requests, context and the GPU, the cache of fits, from settings to the pod, common errors, and pod images. The engine pages keep their keys and their own fit, and every existing heading.
   - b) Keep the duplication.
6. **Splits and renames in `installation/`.**
   - a) Recommended:
     - move "A pool of organizations" from `setup.md` to `installation/pool.md`, and keep its anchor with an `<a id>`;
     - rename `installation/profiles.md` to `installation/mixing-providers.md`, titled "Mixing providers", since two pages are titled "Profiles" today;
     - update every referrer.
   - b) Keep both files as they are.
7. **Upgrade notes.**
   - a) Keep one `upgrading.md` (recommended). Open it with "Find your version", "How to upgrade" and a changes table (since, change, commit, who, action, breaking). Give every entry a Since / Who is affected / Breaking block, with "What to do" and "How to verify". Move the upgrade notes scattered in other pages, such as `codeman:in-progress`, older images and older records, into it.
   - b) One file per upgrade under `installation/upgrades/`. This moves 4 referenced anchors.
8. **Internals in user pages.**
   - a) Keep internals in the same page, under a "How it works" heading after the user-facing sections (recommended).
   - b) In `<details>` blocks, which hide them from a site's search.
   - c) In separate maintainer pages.
9. **What the site publishes** (only the docs side; the generator is out of scope).
   - a) Recommended:
     - publish `docs/` without `docs/plans/` and `docs/web/`;
     - have the build rewrite links that leave the published tree to GitHub blob URLs;
     - keep every source link relative, so `src/docs.test.ts` keeps checking it;
     - keep `docs/README.md` as the single source of the navigation order, with no per-file navigation front matter.
   - b) Also publish `docs/plans/` as a "History" section.

## Steps

Every step keeps `npm test` passing and updates `docs/README.md` when a file is added, moved or renamed.

A step is done when, in the files it touches:

- no paragraph or list item outside tables and code exceeds about 80 words;
- no sentence exceeds about 45 words;
- each section carries one subject;
- every fact that was there before is still there or linked;
- each diagram matches the code it draws.

The detailed proposals are in the reviews of 2026-10-16: outlines, conversions, diagram drafts and before/after rewrites. Each step names the parts to apply. The reviews are kept in `docs/plans/2026-10-16-restructure-the-docs-for-readers/` while the work lasts. They are working notes, not committed. The facts they contain are checked again against the code when applied.

1. **Conventions.** Apply decisions 1-3 and 8: write `docs/development/documentation.md`, and change `AGENTS.md` if decision 3a is chosen.
2. **Glossary** (decision 4). Write `docs/glossary.md`. Use its terms in the steps that follow.
3. **Index and landing.** Rewrite `docs/README.md` as the site's landing page:
   - one sentence on what Codeman is, and "New to Codeman? Read the README, then follow Installation";
   - groups by reader goal: Get started, Work with tasks, Configure, Costs, Operate, Security, How it works, Contribute;
   - for each group, a table of `Page | Read it to …`, with descriptions of at most about 10 words.
4. **Onboarding:** `README.md`, `installation/setup.md`, `installation/shared-settings.md`, `installation/mixing-providers.md`, `installation/pool.md`.
   - Diagrams:
     - the moving parts (GitHub App, workflows, backend, OpenRouter and Runpod);
     - the setup order;
     - the first task, as a sequence;
     - backend access through OIDC.
   - In `setup.md`, add:
     - "Before you start": prerequisites, and choosing the commit;
     - credentials tables;
     - "Choose the attribute condition" as a table;
     - a new step "6. Check the setup": a manual run with no labeled issue, its expected log line, and an error-to-fix table;
     - "Try it" as a table of you do / Codeman does / you should see;
     - "Next steps".
   - In the README, replace the copyable but partial `on:` block with a link.
5. **Settings:** `settings/reference.md`, `providers.md`, `profiles.md`, `provider-settings-across-layers.md`.
   - In `reference.md`:
     - make `#layers` the only place that explains precedence, with a diagram, a table of the layers and a worked example;
     - give the settings tables Type, Default and Allowed values columns;
     - add a "Where each setting can be set" matrix;
     - give the file format "accepts" and "rejects" lists.
   - In `providers.md`, add an at-a-glance table.
   - In `profiles.md`:
     - put "Which applies" first, with its diagram;
     - add a results table for `## Example`;
     - move the tip "a profile without `stages` goes last" here.
   - In `provider-settings-across-layers.md`, put the summary table first and add a flowchart of the rule.
   - Replace every other copy of the layers with a link.
6. **Pod engines:** `settings/pod-engines.md` (new), `settings/ollama.md`, `settings/vllm.md`, `installation/runpod.md`.
   - In `pod-engines.md`, add:
     - an engine matrix;
     - a parallel-requests flowchart, with a worked example;
     - a sequence diagram from settings to the pod.
   - In both `#memory` sections:
     - the fits as flowcharts;
     - the formulas in code blocks;
     - the steps numbered, with a worked example;
     - the failures as tables.
   - In `vllm.md`, put the start times in a table.
   - Make `runpod.md` a checklist:
     - a "You need" list;
     - a table of the endpoint's console fields;
     - a troubleshooting table;
     - behavior described in `inference/` linked, not repeated.
7. **Tasks and runs:** `tasks/*.md`, `runs/*.md`.
   - Diagrams:
     - the lifecycle labels, as a state diagram;
     - the stages and routing, as a flowchart;
     - one run of one task, as a sequence that replaces the ASCII job graph;
     - a batch across repositories;
     - on-demand workflows;
     - the change policy;
     - the agent job.
   - Tables:
     - a status-by-stage matrix, and the outcomes;
     - the commands, by state;
     - a "Blocked, and how to go on" table of cause and remedy;
     - the triggers;
     - "counts as moved", for the next run;
     - data between jobs.
   - Give `agent.md` subsections: Time limit, Sealing, Collecting.
8. **Security:** `security/*.md`.
   - In `overview.md`:
     - the threat model as an `[!IMPORTANT]` callout;
     - a trust-boundaries diagram;
     - a table of who can read Codeman's secrets;
     - checklist items with one setting each, under subheadings;
     - the roadmap as a table.
   - In `secrets.md`:
     - a summary matrix;
     - a matrix of the permissions each job requests, which `runs/runs-and-jobs.md` then links to;
     - one section per secret: Used by / Why it is safe / Gap / Mitigation;
     - a variables table.
   - In `risks.md`, add a summary table with severity, give each risk its own subsections, and add an untrusted-input table.
   - In `forks.md`, add a matrix of who gets what, and a backend-admission diagram.
   - Move "A public App and a pool" to `risks.md` as risk 8, and update its 5 referrers.
9. **Inference, budget and backend:** `inference/*.md`, `budget/*.md`, `backend/*.md`.
   - Diagrams:
     - the states of a ledger run;
     - the pod registry;
     - the lease lifecycle;
     - opening a pod run;
     - the Serverless request path;
     - reservation and refusal;
     - backend access;
     - the inference layers.
   - Tables:
     - the three budgets;
     - the reconciliation formula, with an example;
     - the outcomes of `open-key`;
     - the timers;
     - the orphan sweep;
     - the Serverless endpoint checks and billed states, with a worked split;
     - what spend counts where;
     - the ledger writes by job.
   - Restructure `data-layout.md` as:
     - a tree;
     - a collections table: path, written by, read by, lifetime;
     - a field table per collection.
   - `inference/openrouter.md` has a full before/after rewrite in the review.
10. **Operations:** `installation/backend-maintenance.md`, `installation/upgrading.md`.
    - In `backend-maintenance.md`, add:
      - "Before you start", with a check that no run is in progress;
      - a quick-reference table;
      - "Emergency stop", as a table of levers with a diagram;
      - "When jobs cannot reach the backend", as a table of log lines;
      - the same shape for each resource: read, disable, delete, restore;
      - the expected outputs, and a rollback next to each change;
      - the condition change as a flowchart.
    - Restructure `upgrading.md` per decision 7.
11. **Development:** `development/*.md`.
    - In `guide.md`, add:
      - a tests table;
      - "What CI checks";
      - the source layout as tables;
      - a short "Releasing" section;
      - the pod images as Publish / Make public / Pin / Keep older images listed, with diagrams;
      - flowcharts of the template-version check and the emulator.
    - In `platforms.md`, add a wiring diagram.
    - In `dependencies.md`, add an inventory table and an audit log table, and give every dependency the same sub-bullets. Merge the "Adding a key" sections of the engine pages into it.
12. **Final check.** Done when:
    - `npm test` passes;
    - the scan's counts are near zero for long paragraphs and sentences;
    - every Mermaid diagram renders on GitHub;
    - `docs/README.md` lists every file.

## Out of scope

- Correcting facts. That is the [correction plan](2026-10-16-correct-the-docs-against-the-code.md).
- Choosing a site generator, adding it as a dependency, and the GitHub Pages workflow. That is a separate plan: it adds a dependency and CI.
- Pointing the templates' links at the site instead of GitHub, which would change a public interface.
- The content of `docs/web/` and `docs/plans/`.
- Translations.
