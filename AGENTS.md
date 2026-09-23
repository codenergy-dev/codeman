# AGENTS.md

Instructions for AI agents working in this repository. Humans should start with `README.md`.

These rules apply to every task. If a task seems to require breaking one of them, stop and ask.

## Language

Write all code, comments, commit messages and documentation in English, even when the conversation happens in another language.

## Documentation

Each file has one audience:

- `README.md` is for humans. Keep it didactic and natural: what the project is, why it exists, how to get started, with short examples. Do not try to cover everything; link to `docs/` for details.
- `AGENTS.md` is for agents. It holds working rules, not project knowledge.
- `docs/` is the single source of truth for project knowledge: architecture, decisions, conventions, operations.

Rules:

- Do not create documentation outside `docs/` (except `README.md` and `AGENTS.md`).
- Before writing, check whether the information already exists. Update or link to it; never duplicate it.
- When code changes behavior described in `docs/`, update `docs/` in the same change.
- Write objectively, clearly and without ambiguity. Prefer short sections and concrete statements. Do not be exhaustive: document what a reader needs to understand and act, and leave out what the code already says.

## Plans

Write a plan before any non-trivial work, and keep it current while working.

### Location and name

`plans/YYYY-MM-DD-plan-title.md`, where the date is the day the plan was created and the title is short, lowercase and hyphenated.

Example: `plans/2026-09-23-add-rate-limiting.md`

### Front matter

```yaml
---
status: pending        # pending | in progress | completed | blocked
reason: "..."          # required only if status is blocked
created_at: 2026-09-23T14:18:00-03:00   # ISO 8601
updated_at: 2026-09-23T14:18:00-03:00   # ISO 8601
commit: 1a2b3c4        # HEAD commit when the plan was written
---
```

### Body

A plan contains, at minimum:

- **Goal**: the outcome, in one or two sentences.
- **Context**: why this work is needed and what constrains it.
- **Decisions**: open questions that need an answer from the responsible person before work starts, each with options and a recommendation. Record the answer once given.
- **Steps**: ordered, verifiable steps, each with a clear done criterion.
- **Out of scope**: what this plan deliberately does not do.

### Lifecycle

1. Write the plan with status `pending` and ask for review.
2. Do not start implementation while decisions are open.
3. Set `in progress` when work starts. Update `updated_at` on every change to the plan.
4. If blocked, set `blocked` and explain why in `reason`.
5. If reality diverges from the plan, update the plan first, then the code. Significant changes to scope or approach need review again.
6. Set `completed` when every step is done. Never delete plans; they are the project's history.

## Commits and pushes

- Suggest a commit message; do not commit on your own. Use the imperative mood, a concise subject line (up to 72 characters) and a body that explains why when it is not obvious.
- Commit or push only with explicit authorization from the responsible person. Authorization covers the action it was given for, not future ones.
- Never rewrite published history (force push, rebase of shared branches) without explicit authorization.

## Third-party code and services

Security is a priority. Every package, action, binary, API or service is code you did not write running with your permissions.

Before adding one, audit it and report:

- What it does and why it is needed.
- Whether a small in-house implementation or the standard library would do. When the need is small, prefer writing it.
- Maintenance status, maintainers, license and known vulnerabilities.
- Transitive dependencies, install scripts and the permissions it requires.

Then:

- Adding, removing or upgrading a dependency is a critical decision: ask first.
- Pin exact versions and commit lockfiles. Pin GitHub Actions to a full commit SHA.
- Never pipe remote scripts into a shell. Download, verify checksums or signatures, then run.
- Never commit secrets, tokens or credentials. Never print them in logs. Use the platform's secret store.
- Grant the minimum permissions needed.

## Ask before critical decisions

Stop and ask before:

- Adding, removing or upgrading dependencies or external services.
- Changing public interfaces, data formats or storage schemas.
- Deleting files or data, or doing anything that cannot be easily undone.
- Changing security settings, permissions, secrets or CI/CD.
- Anything that incurs cost or uses paid resources.
- Deviating from an approved plan.

When asking, give the options, their trade-offs and your recommendation. If something is unclear, ask rather than assume.