import assert from "node:assert/strict";
import { test } from "node:test";
import { parseImplementOutput, parsePlanOutput } from "./output.ts";

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

test("reads an implementation result", () => {
  const parsed = parseImplementOutput(
    JSON.stringify({
      status: "done",
      summary: "Added a limiter.",
      commitMessage: `${"Add rate limiting to every public endpoint of the API ".repeat(2)}\n\nWhy.`,
    }),
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.value.status, "done");
  const [subject, blank, body] = parsed.value.commitMessage.split("\n");
  assert.equal(subject?.length, 72);
  assert.deepEqual([blank, body], ["", "Why."]);
});

test("a blocked result needs a reason", () => {
  const base = { status: "blocked", summary: "Stopped.", commitMessage: "Stop" };
  assert.equal(parseImplementOutput(JSON.stringify(base)).ok, false);
  const parsed = parseImplementOutput(JSON.stringify({ ...base, reason: "Which API?" }));
  assert.ok(parsed.ok && parsed.value.reason === "Which API?");
});

test("rejects malformed implementation results", () => {
  const results = [
    "not json",
    "[]",
    JSON.stringify({ status: "finished", summary: "x", commitMessage: "x" }),
    JSON.stringify({ status: "done", summary: "", commitMessage: "x" }),
    JSON.stringify({ status: "done", summary: "x" }),
    JSON.stringify({ status: "done", summary: "x", commitMessage: "x".repeat(2001) }),
  ].map(parseImplementOutput);
  for (const result of results) assert.equal(result.ok, false);
});
