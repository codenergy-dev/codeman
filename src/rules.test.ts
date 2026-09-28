import assert from "node:assert/strict";
import { test } from "node:test";
import { agentRules, COVERED, coverage, readRules, ruleBlocks, UNDER_CODEMAN } from "./rules.ts";

const rules = readRules();

test("the rules are the sections of Codeman's AGENTS.md", () => {
  const headings = ruleBlocks(rules).map((block) => block.heading);
  assert.ok(headings.includes("Language"));
  assert.ok(headings.includes("Plans"));
  assert.ok(headings.includes("Ask before critical decisions"));
  assert.ok(!ruleBlocks(rules).some((block) => block.text.startsWith("# AGENTS.md")));
});

test("a repository without instructions gets every rule, after how to apply them", () => {
  const { text, omitted } = agentRules(rules, undefined);
  assert.deepEqual(omitted, []);
  assert.ok(text.startsWith("# Codeman's working rules\n\n## Working under Codeman"));
  assert.ok(text.indexOf(UNDER_CODEMAN) < text.indexOf("## Language"));
  for (const block of ruleBlocks(rules)) assert.ok(text.includes(block.text), block.heading);
});

test("a copy of the rules, even lightly edited, is not repeated", () => {
  assert.equal(agentRules(rules, rules).omitted.length, ruleBlocks(rules).length);

  const edited = rules
    .replace(/## Plans/, "## Planning")
    .replace(/in English/g, "in English (US)")
    .replace(/Write a plan before any non-trivial work/, "Always write a plan first")
    .replace(/## Commits and pushes[\s\S]*?(?=## Third-party)/, "");
  const { text, omitted } = agentRules(rules, edited);
  assert.ok(omitted.includes("Plans"), "a renamed and edited section");
  assert.ok(omitted.includes("Language"));
  assert.ok(!omitted.includes("Commits and pushes"), "a removed section is added");
  assert.ok(text.includes("## Working under Codeman"), "always included");
  assert.match(text, /already cover the rest of Codeman's rules: .*Plans/);
});

test("an unrelated file with the same headings does not count", () => {
  const unrelated = [
    "# AGENTS.md",
    "## Language",
    "Use TypeScript with strict mode. Prefer small functions.",
    "## Plans",
    "Keep a TODO list in the issue and tick it off as you go.",
    "## Documentation",
    "Document every exported function with JSDoc.",
  ].join("\n\n");
  assert.deepEqual(agentRules(rules, unrelated).omitted, []);
  for (const block of ruleBlocks(rules)) assert.ok(coverage(block.text, unrelated) < COVERED);
});

test("coverage ignores case, punctuation and Markdown", () => {
  assert.equal(coverage("Write **all** code in English.", "write all code, in english"), 1);
  assert.equal(coverage("one two three four", "five six seven"), 0);
});
