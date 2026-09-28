---
status: completed
created_at: 2026-09-28T17:27:00-03:00
updated_at: 2026-09-28T19:10:00-03:00
commit: 0feea50
---

# Conversation language

## Goal

Codeman talks to maintainers in the task's language. If an issue is written in Brazilian Portuguese, every text Codeman writes on the issue and its pull request is in Brazilian Portuguese: the fixed texts of the status and run comments (headings, notes, instructions, table headers), those of the pull request's description, and the texts the agent writes for maintainers.

## Context

Codeman's fixed texts are in English, spread over `src/status.ts`, `src/spend.ts`, `src/pull.ts`, `src/steps/apply.ts` and `src/steps/select.ts` (about 60 messages). The agent's summaries and decisions already come out in the issue's language, because the models follow it, but no prompt asks for it.

This plan does not change the languages that `AGENTS.md`, or the target repository's own rules, set for code, comments, commit messages and documentation. See `docs/plans/2026-09-28-agent-rules.md`, decision 4.

Stays as it is:

- `/codeman` commands, labels (`codeman:blocked`), file paths, and the hidden record.
- The workflow's logs and summaries, which are for whoever debugs the workflow.

## Decisions

Answer these before work starts.

Answered on 2026-09-28: the recommendation of each, (a). Also asked: the pull request's title becomes the issue's title, instead of the code stage's commit subject. It keeps the language of whoever wrote the issue, and the same title finds both.

1. **How Codeman knows the language.** Options:
   - (a) The planning agent reports it: `language` in `output.json`, as a BCP 47 tag (`pt-BR`), chosen from the issue's title, body and maintainer comments. Codeman keeps it in the task record. A setting overrides it: `language` in `.codeman/settings.yml` for the repository (default `auto`), or `/codeman set language <tag>` for one task.
   - (b) A deterministic detector on the issue's text. A good one is a dependency (such as `franc`, with language models in its code), and a small in-house one would only tell a few languages apart, badly on short issues.
   - (c) The setting only, with no detection.

   Recommendation: (a). The model reads the issue anyway and tells languages apart better than a small detector. It costs no extra call.
2. **Before the plan.** The first update ("Codeman is reading the issue and writing a plan") comes before the agent has said the language. Options:
   - (a) Use the setting's language, or English with `auto`. The planning run's own comment is already in the task's language.
   - (b) Detect the language in `select` with a simple heuristic, only for that message.

   Recommendation: (a). That text is replaced within minutes, and the run comment that stays is already right.
3. **Which languages, and who translates.** Options:
   - (a) Message catalogs in the code: English and Brazilian Portuguese first, checked by the type checker so no message is missing. A language without a catalog falls back to English. `pt-PT` and other variants use their base language's catalog when there is one. Adding a language is adding a catalog.
   - (b) The agent translates the fixed texts into the task's language. Any language works, but the texts would come from a model that read untrusted input, so they would have to be shown as inert text, which breaks their links, commands and formatting.

   Recommendation: (a). The fixed texts carry commands and links that must stay exact.
4. **Numbers and dates.** Options:
   - (a) Format them for the language as well: `US$ 0,12` and `28/09/2026 19:40 UTC` in Brazilian Portuguese.
   - (b) Keep them as they are.

   Recommendation: (a). Node's `Intl` does it, with no dependency.

## Steps

1. A `Messages` type and the `en` and `pt-BR` catalogs in `src/i18n/`, with a `messages(tag)` function that falls back as in decision 3. Done when the type checker requires every message in each catalog, and tests cover the fallbacks.
2. Move every fixed text of the status comment, run comments, spend table, pull request and review comment into the catalogs; the functions that render them take the messages. Done when the tests pass in both languages.
3. The `language` setting, `/codeman set language <tag>`, and `language` in the planning output. Done when tests cover precedence and invalid tags.
4. Prompts: the agent writes `summary`, `reason`, decisions and reports in the task's language, and files by the repository's rules. Done when the prompt tests check it.
5. The pull request's title is the issue's title. Done when the pull request tests check it.
6. Update `docs/architecture.md` (Settings, Commands, Status and run comments), `templates/settings.yml` and the README.
7. Rebuild `dist/`, run the tests and Biome. Done when all pass.
8. The responsible person runs a task from an issue in Brazilian Portuguese and checks its comments and pull request.

## Out of scope

- Catalogs beyond English and Brazilian Portuguese.
- Translating the workflow's logs, the labels or the commands.
- Changing the language that code, commit messages and documentation are written in.

## Outcome

Steps 1 to 7 are done. `src/i18n/` holds the `Messages` type and the `en` and `pt-BR` catalogs; the renderers take the task's messages. Problems with commands (`src/problems.ts`) and the reasons apply drops a change (`DropReason` in `src/policy.ts`) became data, rendered in the task's language. The key job's reasons are built in apply from the amounts, so they are translated too.

Refined while working: technical details of an invalid agent result (such as "output.json is not valid JSON") and of a missing record stay in English, after a translated sentence. They are for whoever debugs the run. Step 8 is left to the responsible person.
