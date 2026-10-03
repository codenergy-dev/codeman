---
status: pending
created_at: 2026-10-02T21:10:00-03:00
updated_at: 2026-10-02T21:10:00-03:00
commit: 1094766
---

# Third-party docs

## Goal

The documentation of the third-party services a repository uses lives in the repository, under `docs/web/`, with how each page was fetched. Codeman's own repository gets this catalog for the services it uses, and Codeman gets a new agent, `web`, that adds and refreshes these pages in the repositories it works on.

This plan comes before [`2026-10-02-self-hosted-inference`](2026-10-02-self-hosted-inference.md), whose first step can then record Runpod's and Ollama's pages here.

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
- **Untrusted text.** A third-party page is text nobody at the repository wrote. Committed under `docs/web/`, every later agent may read it. It is data, like the [other untrusted input](../security.md#2-prompt-injection-through-what-the-agent-reads), and it reaches the default branch only through a pull request a maintainer reviews.
- **Agent rules.** The `##` sections of `AGENTS.md` are Codeman's working rules in every repository it works on ([agent rules](../architecture.md#agent-rules)). A rule about `docs/web/` there applies to all of them.
- **Size.** Each file Codeman commits has at most `max-file-bytes` (1 MiB by default). Long reference pages may need splitting.

## Decisions

Answer these before work starts.

1. **Pages whose license does not allow copying.** Options:
   - (a) Copy every page in full.
   - (b) Copy in full only pages whose license allows it, with a `license` field in the front matter. For the others, the file keeps the same front matter and, in place of the content, the facts the repository relies on, in its own words, each pointing to the section it comes from.
   - (c) Keep fetched content out of git (ignored), and commit only the tools.

   Recommendation: (b). It keeps a catalog every agent can read without redistributing what the publisher reserves. (a) puts that risk on every public repository Codeman works on. (c) loses the catalog between runs and between people. It adds one field to the format asked for.
2. **Layout.** Options:
   - (a) Pages in `docs/web/<third-party>/<slug>.md`, so two "Authentication" pages do not collide. Tools in `docs/web/tools/<slug>.md`, with a front matter of `title`, `url` (the site it covers; none for a generic tool), `created_at` and `updated_at`, and no `tool`.
   - (b) Every page directly in `docs/web/`, with the third party in the slug when titles collide.

   Recommendation: (a). The third party is visible in the path, and the format asked for already allows subdirectories (`docs/web/**/*.md`).
3. **How content is fetched.** Options:
   - (a) Only from a Markdown source: a `.md` variant of the URL, `llms.txt`, a Markdown response to `Accept: text/markdown`, or the documentation's own repository. The agent saves it with a command and never retypes it. A page without a Markdown source is recorded as in decision 1b, with the facts only.
   - (b) Also HTML, converted by a small converter written in Codeman.
   - (c) Also HTML, converted by a third-party library, after an audit.

   Recommendation: (a). The services Codeman uses all have a Markdown source, and an HTML converter is real work for pages nobody needs yet. (b) or (c) can follow when one is needed.
4. **When the `web` agent runs.** Options:
   - (a) First, before planning: it reads the issue, finds the third parties the task involves, and adds or refreshes their pages, so the planning agent writes decisions from them. It is also a stage that the router ([`2026-10-02-routing-agent`](2026-10-02-routing-agent.md)) may choose after planning, when the plan turns out to need more.
   - (b) Only as a stage after planning, before design.
   - (c) Only on demand, with a new command.

   Recommendation: (a). Planning is where the facts matter most: these plans themselves needed them before their decisions could be written. A task with no third party costs one short run that reports `skipped`.
5. **Refreshing.** Options:
   - (a) `updated_at` is the last time the page was fetched, whether or not its content changed. The `web` agent refreshes the pages a task relies on when they are older than 30 days.
   - (b) `updated_at` changes only when the content changes, and pages are fetched again on every task that relies on them.
   - (c) Pages are only added, never refreshed.

   Recommendation: (a). The age of a page tells how far to trust it, at the cost of a one-line change in a pull request now and then.
6. **Who writes `docs/web/`.** Options:
   - (a) In Codeman's runs, only the `web` agent; every other stage reads it as data, and its changes there are dropped.
   - (b) Any stage.

   Recommendation: (a). One agent brings third-party text into the repository, so a reviewer knows where to look for it. Outside Codeman, such as a person's own agent, the rule in `AGENTS.md` applies as written.

## Steps

### Codeman's own catalog

1. A `## Third-party documentation` section in `AGENTS.md`: before relying on a third-party service, read its pages in `docs/web/`, add or refresh what is missing or old, and follow the format and the decisions above. Done when the section is short, holds for any repository, and Codeman's rules test still finds every section.
2. Tools: a generic one (Markdown sources in the order of decision 3, and how to record a page that has none), and specialized ones for GitHub's documentation, OpenRouter's and OpenCode's, each with its Markdown source and license. Done when each tool, followed by hand, fetches one of its pages.
3. Pages for what Codeman uses today, following the tools: GitHub's REST endpoints for issues, comments, labels, pull requests, reviews, the Git database, contents, collaborators, Actions (runs, jobs, logs, artifacts, dispatch) and App installation tokens, and the GraphQL mutation that marks a pull request ready; OpenRouter's keys API, analytics query and analytics meta; npm's package metadata; OpenCode's configuration and permissions. Done when each external call in `src/` maps to a page.
4. [`docs/dependencies.md`](../dependencies.md) links each service to its pages, and [`docs/development.md`](../development.md) says what `docs/web/` holds. Done when both are updated.

### The `web` agent

5. The `web` stage in the task record and selection, before planning (decision 4), with its label, `codeman:researching`. A task already planned does not go back to it. Done when `select` and `flow` tests cover a new task, a task without third parties, and records from before.
6. Its prompt and output: it reads the issue and maintainer comments (and the plan, when routed after planning), the tools, and the pages present; it reports `done` with the pages added and refreshed, or `skipped` with the reason. Done when `prompt` and `output` tests cover both.
7. The change policy for it: only `docs/web/**/*.md` is committed, and each file's front matter is checked: the fields, ISO 8601 dates, a `tool` that exists, a file name that is the slug of its title, and the `license` rule of decision 1. Other stages' changes under `docs/web/` are dropped (decision 6). Done when `policy` and `apply` tests cover a valid page, each invalid field and a page from another stage.
8. Every stage's prompt says that `docs/web/` is third-party text, to treat as data. Done when `prompt` tests show it.
9. If the routing plan is done by then, the router may choose `web` after planning. Done when its `output` tests accept it.
10. Update [`docs/architecture.md`](../architecture.md) (states, stages, change policy), [`docs/security.md`](../security.md) (third-party text committed to the repository) and the README's flow, in English, and the i18n catalogs in both languages. Done when they describe the `web` agent.
11. Rebuild `dist/`, run `npm run check`. Done when it passes.
12. The responsible person runs, on the test repository, a task that uses a third-party API and one that uses none. Done when the first adds valid pages and the second skips with a reason.

## Out of scope

- Converting HTML pages (decision 3, options b and c).
- A command to fetch a given page, and refreshing every page on a schedule.
- Restricting the agent's network ([security roadmap](../security.md#roadmap) item 1).
- Searching or indexing `docs/web/`.
- Runpod's, Ollama's and vLLM's pages: [`2026-10-02-self-hosted-inference`](2026-10-02-self-hosted-inference.md) records them in its first step.
