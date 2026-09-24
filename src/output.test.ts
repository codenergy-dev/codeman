import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlanOutput } from "./output.ts";

const decision = (id: number) => ({
  id,
  title: `Decision ${id}`,
  question: "Which one?",
  options: [
    { key: "a", label: "First" },
    { key: "b", label: "Second" },
  ],
  recommendation: "a",
});

const parse = (value: unknown) => parsePlanOutput(JSON.stringify(value));

test("accepts a valid output", () => {
  const result = parse({ summary: " Adds x. ", decisions: [decision(1), decision(2)] });
  assert.ok(result.ok);
  assert.equal(result.ok && result.value.summary, "Adds x.");
  assert.equal(result.ok && result.value.decisions.length, 2);
});

test("accepts a plan without decisions", () => {
  assert.ok(parse({ summary: "Clear issue.", decisions: [] }).ok);
});

test("rejects malformed output", () => {
  const cases: unknown[] = [
    "not an object",
    { decisions: [] },
    { summary: "s", decisions: {} },
    { summary: "s", decisions: [decision(2)] },
    { summary: "s", decisions: [{ ...decision(1), options: [{ key: "a", label: "only" }] }] },
    {
      summary: "s",
      decisions: [{ ...decision(1), options: [{ key: "b", label: "x" }, decision(1).options[1]] }],
    },
    { summary: "s", decisions: [{ ...decision(1), recommendation: "c" }] },
    { summary: "s", decisions: [{ ...decision(1), title: "" }] },
    { summary: "x".repeat(2001), decisions: [] },
    { summary: "s", decisions: Array.from({ length: 11 }, (_, i) => decision(i + 1)) },
  ];
  for (const value of cases) assert.equal(parse(value).ok, false, JSON.stringify(value));
  assert.equal(parsePlanOutput("{").ok, false);
});
