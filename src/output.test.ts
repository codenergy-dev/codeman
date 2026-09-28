import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlanOutput, parseStageOutput } from "./output.ts";

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

test("reads the conversation's language, and ignores an invalid one", () => {
  const language = (value: unknown) => {
    const result = parse({ summary: "s", decisions: [], language: value });
    return result.ok ? result.value.language : "rejected";
  };
  assert.equal(language("pt-BR"), "pt-BR");
  assert.equal(language("Portuguese"), undefined);
  assert.equal(language(3), undefined);
  assert.equal(language(undefined), undefined);
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
    { summary: "x".repeat(4001), decisions: [] },
    { summary: "s", decisions: Array.from({ length: 11 }, (_, i) => decision(i + 1)) },
  ];
  for (const value of cases) assert.equal(parse(value).ok, false, JSON.stringify(value));
  assert.equal(parsePlanOutput("{").ok, false);
});

test("reads a stage result", () => {
  const parsed = parseStageOutput(
    JSON.stringify({
      status: "done",
      summary: "Added a limiter.",
      commitMessage: `${"Add rate limiting to every public endpoint of the API ".repeat(2)}\n\nWhy.`,
    }),
    "code",
  );
  assert.ok(parsed.ok);
  assert.equal(parsed.value.status, "done");
  const [subject, blank, body] = parsed.value.commitMessage?.split("\n") ?? [];
  assert.equal(subject?.length, 72);
  assert.deepEqual([blank, body], ["", "Why."]);
  const plain = parseStageOutput(
    JSON.stringify({ status: "done", summary: "Nothing new." }),
    "test",
  );
  assert.ok(plain.ok && plain.value.commitMessage === undefined);
});

test("each stage reports only its own statuses, with reasons where needed", () => {
  const out = (status: string, extra: object = {}) =>
    JSON.stringify({ status, summary: "s", ...extra });
  assert.equal(parseStageOutput(out("skipped"), "design").ok, false, "skipping needs a reason");
  assert.ok(parseStageOutput(out("skipped", { reason: "No screens." }), "design").ok);
  assert.equal(parseStageOutput(out("changes", { reason: "x" }), "code").ok, false);
  assert.ok(parseStageOutput(out("changes", { reason: "Fix the null check." }), "review").ok);
  assert.equal(
    parseStageOutput(out("partial"), "review").ok,
    false,
    "review never leaves work half done",
  );
  assert.equal(
    parseStageOutput(
      out("awaiting-workflow", { reason: "x", workflows: [".github/workflows/a.yml"] }),
      "design",
    ).ok,
    false,
  );
  assert.equal(parseStageOutput(out("blocked"), "code").ok, false, "blocked needs a reason");
  assert.ok(parseStageOutput(out("blocked", { reason: "Which API?" }), "code").ok);
});

test("design and review may ask decisions", () => {
  const decision = {
    id: 1,
    title: "Layout",
    question: "Which layout?",
    options: [
      { key: "a", label: "Cards" },
      { key: "b", label: "Table" },
    ],
    recommendation: "a",
  };
  const parsed = parseStageOutput(
    JSON.stringify({ status: "decisions", summary: "Two drafts.", decisions: [decision] }),
    "design",
  );
  assert.ok(parsed.ok && parsed.value.decisions?.length === 1);
  assert.equal(
    parseStageOutput(JSON.stringify({ status: "decisions", summary: "s", decisions: [] }), "design")
      .ok,
    false,
  );
  assert.equal(
    parseStageOutput(
      JSON.stringify({ status: "decisions", summary: "s", decisions: [decision] }),
      "code",
    ).ok,
    false,
  );
});

test("rejects malformed stage results", () => {
  const results = [
    "not json",
    "[]",
    JSON.stringify({ status: "finished", summary: "x" }),
    JSON.stringify({ status: "done", summary: "" }),
    JSON.stringify({ status: "done", summary: "x", commitMessage: "x".repeat(2001) }),
  ].map((text) => parseStageOutput(text, "code"));
  for (const result of results) assert.equal(result.ok, false);
});

test("an awaiting-workflow result names workflow files", () => {
  const base = {
    status: "awaiting-workflow",
    summary: "Needs a macOS build.",
    commitMessage: "Add an iOS build workflow",
    reason: "Build the app and upload the simulator logs.",
  };
  const parsed = parseStageOutput(
    JSON.stringify({
      ...base,
      workflows: [".github/workflows/ios.yml", ".github/workflows/ios.yml"],
    }),
    "code",
  );
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.workflows, [".github/workflows/ios.yml"]);
  for (const workflows of [
    undefined,
    [],
    ["ci.yml"],
    [".github/workflows/a/b.yml"],
    [".github/workflows/../x.yml"],
  ]) {
    assert.equal(parseStageOutput(JSON.stringify({ ...base, workflows }), "code").ok, false);
  }
});
