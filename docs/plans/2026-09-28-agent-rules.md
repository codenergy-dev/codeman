---
status: completed
created_at: 2026-09-28T17:26:00-03:00
updated_at: 2026-09-28T18:05:00-03:00
commit: 0feea50
---

# Codeman's working rules for the agent

## Goal

Every agent Codeman runs follows Codeman's way of working, as `AGENTS.md` describes it for this repository: documentation in `docs/`, plans in `docs/plans/`, English for code and documentation, careful dependencies, no secrets. The harness loads these rules as instructions, next to the target repository's own `AGENTS.md`, without duplicating what that file already says.

## Context

Target repositories may have no `AGENTS.md`, or one with other rules. Today the prompts say "follow `AGENTS.md` if the repository has one", and carry only the rules Codeman needs to work (plan format, output file, protected paths).

Codeman's `AGENTS.md` cannot be copied as is. Some of its rules assume a human conversation that the agent does not have:

- "Suggest a commit message; do not commit": Codeman commits, from the agent's `commitMessage`.
- "Stop and ask before critical decisions": the agent asks by reporting `decisions` (plan, design, review) or `blocked`.
- The plan lifecycle: Codeman owns the status and the decisions, through the status comment.

How OpenCode 1.18 loads instructions (https://opencode.ai/docs/rules/):

- One project file (`AGENTS.md` or `CLAUDE.md`, found from the working directory up) and one global file (`~/.config/opencode/AGENTS.md`).
- The files listed in the configuration's `instructions` field. These are added to the `AGENTS.md` files, not used in their place.

Codeman already passes its configuration in `OPENCODE_CONFIG_CONTENT`, so it can list a file there.

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a).

Refined while working, within decisions 1 and 2: the blocks are the `##` sections of Codeman's own `AGENTS.md`, read at run time from the action's checkout, so the rules are written once. A short block that is always included says how they apply under Codeman (no human to ask, no commits, who wins). A block is left out when the repository's `AGENTS.md` (or `CLAUDE.md`) already contains most of its text, wherever it is: 60% or more of the block's three-word sequences, normalized for case and punctuation. That finds copies whose headings changed too.

1. **How the rules reach the agent.** Options:
   - (a) A file outside the working tree, in the agent user's home, listed in the harness configuration's `instructions`. The repository's `AGENTS.md` stays untouched, and the rules never end up in a commit.
   - (b) Write `AGENTS.md` into the working tree: create it, or append Codeman's rules to the existing one. The harness loads it as it is. The agent sees a changed `AGENTS.md`, and apply must drop that change, or a repository that allows the path gets the appended rules committed.

   Recommendation: (a). Same effect for the agent, and nothing to undo. Each harness gets the file's path and loads it its own way, so the choice does not tie Codeman to OpenCode.
2. **Duplicates.** A repository's `AGENTS.md` may already hold the same rules, as Codeman's own does, or a lightly edited copy. Options:
   - (a) Split Codeman's rules into blocks (Language, Documentation, Plans, Commits, Dependencies and security, Decisions). Leave out each block that the repository's `AGENTS.md` already covers: a section with the same heading whose text is similar enough (word overlap, normalized for case and punctuation, at or above a threshold such as 60%). The threshold is chosen from tests with edited copies.
   - (b) Always add every block. Duplicates cost about 1,500 tokens per run and change nothing else.
   - (c) Leave out everything when the repository's `AGENTS.md` has a Codeman marker.

   Recommendation: (a), as asked. It is deterministic and handles edited copies. (c) fails on copies without the marker.
3. **When the rules conflict with the repository's.** For example, the repository keeps documentation in `documentation/`, or writes it in Portuguese. Options:
   - (a) The repository's `AGENTS.md` wins for its own conventions: where documentation lives, languages, commit style. Codeman's rules fill in what it does not say. Rules that Codeman's own flow depends on always hold: the plan's path and format, the output file, no commits, and no secrets.
   - (b) Codeman's rules always win.

   Recommendation: (a). The maintainers wrote their rules for their repository, and Codeman's flow is protected either way.
4. **The plan's language.** The plan prompt says "write the plan in the language of the issue, unless `AGENTS.md` says otherwise". Codeman's rules say documentation is in English, and a plan is documentation. Options:
   - (a) Plans follow the documentation rules: English by default, or the repository's language if its `AGENTS.md` says so. What the agent says to the maintainers (summary, decisions, reports) follows the conversation's language; see `docs/plans/2026-09-28-conversation-language.md`.
   - (b) Plans stay in the issue's language.

   Recommendation: (a). The plan lives in the repository with the rest of its documentation.

## Steps

1. `src/rules.ts` reads Codeman's `AGENTS.md` into blocks, one per `##` section, and adds the block on working under Codeman (see Context). Done when a unit test checks the blocks and the rendered file.
2. `selectRules(repoAgents)`: the blocks the repository's `AGENTS.md` does not already cover (decision 2). Done when tests cover no file, an identical copy, a lightly edited copy, and an unrelated file with the same headings.
3. The agent job reads the repository's `AGENTS.md` (or `CLAUDE.md`) from the checkout, writes the selected rules to the agent's home, and passes the path to the harness. `HarnessOptions` gets an `instructions` path, and OpenCode lists it in `instructions`. Done when the OpenCode configuration test checks it.
4. Prompts: say which rules win (decision 3), and change the plan prompt's language rule (decision 4). Remove from the prompts what the rules now say. Done when the prompt tests are updated.
5. Update `docs/architecture.md` (Agent sandbox, or a new "Agent rules" section) with what the rules cover and how duplicates are left out, and say in `AGENTS.md` that its sections also reach Codeman's agents.
6. Rebuild `dist/`, run the tests and Biome. Done when all pass.
7. The responsible person runs a task on the test repository and checks, in the agent's log, that OpenCode loaded the rules, and that the plan follows them.

## Out of scope

- A setting to turn Codeman's rules off or to replace them.
- Changing the target repository's `AGENTS.md`.

## Outcome

Steps 1 to 6 are done. `src/rules.ts` builds the rules file from Codeman's `AGENTS.md`; the agent job writes it to `.codeman/rules.md` in the agent's copy, which apply never commits, and passes its path to the harness. The prompts point to the rules, and plans are written in the documentation's language. Step 7 is left to the responsible person: it also confirms that OpenCode 1.18.32 loads an absolute path from `instructions`, which its documentation does not show. If it does not, the plan reopens.
