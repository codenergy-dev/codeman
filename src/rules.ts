import { readFileSync } from "node:fs";

/**
 * Codeman's `AGENTS.md`, read from the action's own checkout: from `src/` in tests and from
 * `dist/` in the action, both one level below it.
 */
export const RULES_FILE = new URL("../AGENTS.md", import.meta.url);

/** A `##` section of the rules, with its heading. */
export interface RuleBlock {
  heading: string;
  text: string;
}

/** How Codeman's rules apply to an agent that runs alone, inside Codeman's flow. Always included. */
export const UNDER_CODEMAN = `## Working under Codeman

The rules below are Codeman's way of working. They were written for agents that work with a person; you run alone, inside Codeman. Apply them this way:

- The repository's own \`AGENTS.md\` (or \`CLAUDE.md\`), if it has one, wins for its conventions: where documentation lives, which languages to use, the commit style. These rules fill in what it does not say. The rules in your task file always hold: the plan's path and format, the output file, the paths you may change, and no secrets.
- Nobody can answer you during a run. Where these rules say to ask, to stop, or to wait for authorization: when planning, list it as a decision in the plan; in a later stage, go on only if the approved plan and its answered decisions cover it, and otherwise report \`decisions\` or \`blocked\`, as your task file allows.
- Do not commit or push. Codeman commits what you leave in the working tree, with the \`commitMessage\` you report; write it as these rules describe commit messages.
- Codeman creates each task's plan at the path your task file names, and records its decisions and answers. Keep the plan current as these rules say.
- When the plan approved a new dependency, report your audit of it in your summary.`;

/** Splits Markdown rules into their `##` sections. Text before the first one is left out. */
export function ruleBlocks(markdown: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  for (const part of markdown.split(/^(?=## )/m).slice(1)) {
    const heading = part.slice(3, part.indexOf("\n") === -1 ? undefined : part.indexOf("\n"));
    blocks.push({ heading: heading.trim(), text: part.trim() });
  }
  return blocks;
}

/** Three-word sequences of a text, ignoring case, punctuation and Markdown. */
function trigrams(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set<string>();
  for (let index = 0; index + 2 < words.length; index++) {
    result.add(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);
  }
  return result;
}

/** Share of the block's three-word sequences that also appear in `text`, from 0 to 1. */
export function coverage(block: string, text: string): number {
  const wanted = trigrams(block);
  if (wanted.size === 0) return 1;
  const present = trigrams(text);
  let found = 0;
  for (const trigram of wanted) if (present.has(trigram)) found++;
  return found / wanted.size;
}

/** At or above this coverage, the repository already has a block, maybe lightly edited. */
export const COVERED = 0.6;

/**
 * The rules file for the agent: how to apply Codeman's rules, then each of its blocks that the
 * repository's own instructions do not already contain.
 */
export function agentRules(
  rules: string,
  repositoryRules: string | undefined,
): { text: string; omitted: string[] } {
  const blocks = ruleBlocks(rules);
  const omitted = repositoryRules
    ? blocks.filter((block) => coverage(block.text, repositoryRules) >= COVERED)
    : [];
  const kept = blocks.filter((block) => !omitted.includes(block));
  const text = [
    "# Codeman's working rules",
    UNDER_CODEMAN,
    ...kept.map((block) => block.text),
    ...(omitted.length > 0
      ? [
          `The repository's own instructions already cover the rest of Codeman's rules: ${omitted.map((block) => block.heading).join(", ")}.`,
        ]
      : []),
  ].join("\n\n");
  return { text: `${text}\n`, omitted: omitted.map((block) => block.heading) };
}

export function readRules(): string {
  return readFileSync(RULES_FILE, "utf8");
}
