---
status: completed
created_at: 2026-10-02T21:10:00-03:00
updated_at: 2026-10-02T22:00:00-03:00
commit: 1094766
---

# Third-party docs

## Goal

The documentation of the third-party services a repository uses lives in the repository, under `docs/web/`, with how each page was fetched. Codeman's own repository gets this catalog for the services it uses, and Codeman gets a new agent, `web`, that adds and refreshes these pages in the repositories it works on, when the routing agent sends a task to it. The status comment lists the pages that are getting old, so maintainers choose when to refresh them.

This plan comes after [`2026-10-02-routing-agent`](2026-10-02-routing-agent.md), which decides when `web` runs, and before [`2026-10-02-self-hosted-inference`](2026-10-02-self-hosted-inference.md), whose first step can then record Runpod's and Ollama's pages here.

## Context

Codeman already calls GitHub's REST and GraphQL APIs, OpenRouter's key and analytics APIs and the npm registry, and drives OpenCode through its configuration. The self-hosted inference plan adds Runpod, Ollama and vLLM. What Codeman relies on from each is scattered across the code's comments, the plans and `docs/`, and checking it again means finding the pages again. While writing the last plans, several facts (a metric's name, a filter, a billing field) came from reading those pages, and nothing kept them.

The format, as asked by the responsible person:

- Each page is a Markdown file under `docs/web/**/`, named after the slug of its title.
- Front matter: `title`, `url`, `created_at` and `updated_at` (ISO 8601), and `tool`: the path of a file in `docs/web/tools/` that says how the page is fetched and converted.
- Then the page's content, converted to Markdown.
- Tools in `docs/web/tools/*.md` are instructions: generic ones (for any site) are named after what they do, and specialized ones after the third party.

What constrains it:

- **Copyright.** Codeman's repository is public. Committing a page's full text redistributes it. GitHub's documentation is licensed CC BY 4.0, which allows that with attribution; OpenRouter's terms reserve its materials to OpenRouter and its licensors; Runpod's documentation states no license that was found. Many target repositories are private, but some are public too.
- **Fidelity and cost.** An LLM that retypes a page spends output tokens on every line and may change it. A command that saves the source does neither. Many documentation sites serve Markdown already: OpenRouter's and Runpod's pages answer with Markdown when `.md` is appended to their URL, and GitHub's documentation lives as Markdown in a public repository.
- **Untrusted text.** A third-party page is text nobody at the repository wrote. Committed under `docs/web/`, every later agent may read it. It is data, like the [other untrusted input](../security/risks.md#2-prompt-injection-through-what-the-agent-reads), and it reaches the default branch only through a pull request a maintainer reviews.
- **Agent rules.** The `##` sections of `AGENTS.md` are Codeman's working rules in every repository it works on ([agent rules](../runs/agent.md#agent-rules)). A rule about `docs/web/` there applies to all of them.
- **Size.** Each file Codeman commits has at most `max-file-bytes` (1 MiB by default). Long reference pages may need splitting.
- **Reading pages for the status comment** costs an API call per file. The task record therefore keeps each page's `updated_at` by path, and reads again only the files whose blob changed.

## Decisions

Answered on 2026-10-02 by the responsible person: the recommendations of decisions 1, 2 and 6; decisions 3, 4 and 5 with changes, recorded under each.

1. **Pages whose license does not allow copying.** Options:
   - (a) Copy every page in full.
   - (b) Copy in full only pages whose license allows it, with a `license` field in the front matter. For the others, the file keeps the same front matter and, in place of the content, the facts the repository relies on, in its own words, each pointing to the section it comes from.
   - (c) Keep fetched content out of git (ignored), and commit only the tools.

   Recommendation: (b). It keeps a catalog every agent can read without redistributing what the publisher reserves. (a) puts that risk on every public repository Codeman works on. (c) loses the catalog between runs and between people. It adds one field to the format asked for.

   **Answer:** (b).
2. **Layout.** Options:
   - (a) Pages in `docs/web/<third-party>/<slug>.md`, so two "Authentication" pages do not collide. Tools in `docs/web/tools/<slug>.md`, with a front matter of `title`, `url` (the site it covers; none for a generic tool), `created_at` and `updated_at`, and no `tool`.
   - (b) Every page directly in `docs/web/`, with the third party in the slug when titles collide.

   Recommendation: (a). The third party is visible in the path, and the format asked for already allows subdirectories (`docs/web/**/*.md`).

   **Answer:** (a).
3. **How content is fetched.** Options:
   - (a) Only from a Markdown source: a `.md` variant of the URL, `llms.txt`, a Markdown response to `Accept: text/markdown`, or the documentation's own repository. The agent saves it with a command and never retypes it. A page without a Markdown source is recorded as in decision 1b, with the facts only.
   - (b) Also HTML, converted by a small converter written in Codeman.
   - (c) Also HTML, converted by a third-party library, after an audit.

   Recommendation: (a). The services Codeman uses all have a Markdown source, and an HTML converter is real work for pages nobody needs yet. (b) or (c) can follow when one is needed.

   **Answer:** (a), and a page without a Markdown source is still worth recording: the agent writes, in its own words, what is relevant to the task, as for a page whose license does not allow copying. So a page holds either its source, saved with a command, or the agent's own text; never a retyped copy.
4. **When the `web` agent runs.** Options:
   - (a) First, before planning: it reads the issue, finds the third parties the task involves, and adds or refreshes their pages, so the planning agent writes decisions from them. It is also a stage that the router ([`2026-10-02-routing-agent`](2026-10-02-routing-agent.md)) may choose after planning, when the plan turns out to need more.
   - (b) Only as a stage after planning, before design.
   - (c) Only on demand, with a new command.

   Recommendation: (a). Planning is where the facts matter most: these plans themselves needed them before their decisions could be written. A task with no third party costs one short run that reports `skipped`.

   **Answer:** (b), chosen by the router. Planning stays the first agent; the router, which runs after planning, decides whether a task needs `web`, as it decides every other stage. This plan therefore depends on the routing plan. `web` comes first among the stages, before design, and the router may also choose it after a `fix` or a review that asks for changes, as it may any stage.
5. **Refreshing.** Options:
   - (a) `updated_at` is the last time the page was fetched, whether or not its content changed. The `web` agent refreshes the pages a task relies on when they are older than 30 days.
   - (b) `updated_at` changes only when the content changes, and pages are fetched again on every task that relies on them.
   - (c) Pages are only added, never refreshed.

   Recommendation: (a). The age of a page tells how far to trust it, at the cost of a one-line change in a pull request now and then.

   **Answer:** (a) for `updated_at`, without refreshing on its own. Codeman lists, in the task's status comment, the pages older than 30 days, from their front matter, with no LLM. A maintainer decides when to refresh them, by asking for it in a task; the `web` agent refreshes a page only when a maintainer asked for it or when it is missing.
6. **Who writes `docs/web/`.** Options:
   - (a) In Codeman's runs, only the `web` agent; every other stage reads it as data, and its changes there are dropped.
   - (b) Any stage.

   Recommendation: (a). One agent brings third-party text into the repository, so a reviewer knows where to look for it. Outside Codeman, such as a person's own agent, the rule in `AGENTS.md` applies as written.

   **Answer:** (a).

## Steps

### Codeman's own catalog

1. A `## Third-party documentation` section in `AGENTS.md`: before relying on a third-party service, read its pages in `docs/web/` and add what is missing, following the format and decisions 1 to 3; refresh a page when the person responsible asks for it. Done when the section is short, holds for any repository, and Codeman's rules test still finds every section.
2. Tools: a generic one (Markdown sources in the order of decision 3, and how to write a page in the agent's own words when there is none or its license does not allow copying), and specialized ones for GitHub's documentation, OpenRouter's and OpenCode's, each with its Markdown source and license. Done when each tool, followed by hand, fetches one of its pages.
3. Pages for what Codeman uses today, following the tools: GitHub's REST endpoints for issues, comments, labels, pull requests, reviews, the Git database, contents, collaborators, Actions (runs, jobs, logs, artifacts, dispatch) and App installation tokens, and the GraphQL mutation that marks a pull request ready; OpenRouter's keys API, analytics query and analytics meta; npm's package metadata; OpenCode's configuration and permissions. Done when each external call in `src/` maps to a page.
4. [`docs/dependencies.md`](../development/dependencies.md) links each service to its pages, and [`docs/development.md`](../development/guide.md) says what `docs/web/` holds. Done when both are updated.

### The `web` agent

5. The `web` stage, first in the order of stages, with its label, `codeman:researching`. The router may choose it like any stage (decision 4); without a route, as in records from before routing, the task goes on to design as today. Done when `select`, `flow` and the router's `output` tests cover a route with and without `web`.
6. Its prompt and output: it reads the plan, the router's brief, the issue and maintainer comments, the tools and the pages present; it adds the pages the task needs and refreshes the ones a maintainer asked for (decision 5); it reports `done` with the pages added and refreshed, or `skipped` with the reason. Done when `prompt` and `output` tests cover both.
7. The change policy for it: only `docs/web/**/*.md` is committed, and each file's front matter is checked: the fields, ISO 8601 dates, a `tool` that exists, a file name that is the slug of its title, and the `license` rule of decision 1. Other stages' changes under `docs/web/` are dropped (decision 6). Done when `policy` and `apply` tests cover a valid page, each invalid field and a page from another stage.
8. Every stage's prompt says that `docs/web/` is third-party text, to treat as data. Done when `prompt` tests show it.
9. Pages getting old (decision 5): on each run that updates the status comment, Codeman reads the front matter of the files under `docs/web/` at the head of the task branch (the default branch before the branch exists), skipping the tools, and lists the pages whose `updated_at` is older than 30 days, grouped by third party, with their age and how to ask for a refresh. The record keeps each page's `updated_at` by blob, so unchanged files are not read again; a front matter that cannot be read is listed as such. Titles and paths are rendered inert. Done when `status` tests cover no pages, fresh and old pages, an unreadable front matter and the comment's size limit, in both catalogs.
10. Update [`docs/architecture.md`](../README.md) (states, stages, change policy, status comment), [`docs/security.md`](../security/overview.md) (third-party text committed to the repository) and the README's flow, in English, and the i18n catalogs in both languages. Done when they describe the `web` agent and the list of old pages.
11. Rebuild `dist/`, run `npm run check`. Done when it passes.
12. The responsible person runs, on the test repository, a task that uses a third-party API and one that uses none, and asks for a refresh of an old page. Done when the router sends only the first to `web`, its pages are valid, and the refresh updates `updated_at`.

## Outcome

Steps 1 to 11 are done; step 12 is left to the responsible person, on the test repository.

- **Catalog.** `docs/web/` holds 4 tools and 32 pages: 19 of GitHub's REST reference, copied in full (CC BY 4.0); GraphQL's `markPullRequestReadyForReview`, in our own words, because GitHub's list of mutations is too large to keep; 7 of OpenRouter's, in our own words (its terms reserve its materials, and the OpenAPI description's MIT license is the API's, not the documentation's); 4 of OpenCode's, copied in full (MIT); and npm's package metadata, in our own words (its repository states no license). A test checks that every file follows the format.
- **Names.** A slug has at most 80 characters, from Codeman's `slugify`. Specialized tools are titled with the third party's name ("GitHub"), so their files are named after it. A page in our own words has no `license` field.
- **Web stage.** It is the first of the stages (`codeman:researching`), and the router chooses it like any other. It gets Codeman's generic tool in `.codeman/fetch-markdown.md`. `apply` drops its changes outside `docs/web/` (but the plan), the pages and tools that fail the format, and other stages' changes under `docs/web/`.
- **Old pages.** `apply` reads the catalog on the task branch at the end of every run, reading again only the blobs that changed, and keeps it in the record; `select`'s panel at the start of a run shows the record's list as it is.
- The `updated_at` of the three plans implemented today were first written with guessed times, later than the clock; they now hold the times of their commits.

## Out of scope

- Converting HTML pages into full copies (decision 3, options b and c).
- Refreshing pages without a maintainer asking, and a setting for the 30 days.
- A command to fetch a given page.
- Restricting the agent's network ([security roadmap](../security/overview.md#roadmap) item 1).
- Searching or indexing `docs/web/`.
- Runpod's, Ollama's and vLLM's pages: [`2026-10-02-self-hosted-inference`](2026-10-02-self-hosted-inference.md) records them in its first step.
