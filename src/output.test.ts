import assert from "node:assert/strict";
import { test } from "node:test";
import {
  outputLimits,
  outputProblems,
  parsePlanOutput as parsePlan,
  parseRouteOutput,
  parseStageOutput as parseStage,
} from "./output.ts";
import { GITHUB } from "./platform/github/conventions.ts";
import { DEFAULTS } from "./settings.ts";
import type { Stage } from "./stages.ts";

const limits = outputLimits(DEFAULTS);
const parsePlanOutput = (text: string) => parsePlan(text, limits);
const parseStageOutput = (text: string, stage: Stage) =>
  parseStage(text, stage, limits, GITHUB.workflows);

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

test("cuts a text only beyond twice its limit, and reports the cut", () => {
  const label = (length: number) =>
    parse({
      summary: "s",
      decisions: [
        {
          ...decision(1),
          options: [
            { key: "a", label: "x".repeat(length) },
            { key: "b", label: "y" },
          ],
        },
      ],
    });
  const within = label(limits.label * 2);
  assert.ok(within.ok);
  assert.equal(within.value.decisions[0]?.options[0]?.label.length, limits.label * 2);
  assert.deepEqual(within.value.cuts, []);

  const over = label(412);
  assert.ok(over.ok);
  const cut = over.value.decisions[0]?.options[0]?.label ?? "";
  assert.equal(cut.length, limits.label * 2);
  assert.ok(cut.endsWith("…"));
  assert.deepEqual(over.value.cuts, [
    { field: "decisions[0].options[0].label", length: 412, limit: limits.label },
  ]);
});

test("cuts the summary, the reason and the commit message too", () => {
  const plan = parse({ summary: "x".repeat(limits.summary * 2 + 1), decisions: [] });
  assert.ok(plan.ok && plan.value.summary.length === limits.summary * 2);
  const stage = parseStageOutput(
    JSON.stringify({
      status: "blocked",
      summary: "s",
      reason: "r".repeat(limits.summary * 2 + 1),
      commitMessage: "c".repeat(3000),
    }),
    "code",
  );
  assert.ok(stage.ok);
  assert.deepEqual(
    stage.value.cuts.map((cut) => cut.field),
    ["commitMessage", "reason"],
  );
});

test("counts follow the settings, without a margin", () => {
  const tight = outputLimits({ ...DEFAULTS, "max-decisions": 2, "max-options": 2 });
  const plan = (decisions: unknown[]) =>
    parsePlan(JSON.stringify({ summary: "s", decisions }), tight);
  assert.ok(plan([decision(1), decision(2)]).ok);
  const many = plan([decision(1), decision(2), decision(3)]);
  assert.ok(!many.ok && many.error === "decisions must be a list of at most 2.");
  const three = {
    ...decision(1),
    options: [...decision(1).options, { key: "c", label: "Third" }],
  };
  const options = plan([three]);
  assert.ok(!options.ok && options.error === "decisions[0].options must have 2 to 2 items.");
});

test("all decisions together must fit in a comment", () => {
  const long = (id: number) => ({
    ...decision(id),
    question: "q".repeat(limits.question * 2),
    options: ["a", "b", "c", "d"].map((key) => ({ key, label: "l".repeat(limits.label * 2) })),
  });
  const fits = parse({ summary: "s", decisions: [1, 2, 3, 4, 5].map(long) });
  assert.ok(fits.ok);
  const wide = outputLimits({ ...DEFAULTS, "max-question-chars": 1500, "max-label-chars": 300 });
  const tooMuch = parsePlan(
    JSON.stringify({
      summary: "s",
      decisions: Array.from({ length: 10 }, (_, index) => ({
        ...long(index + 1),
        question: "q".repeat(3000),
        options: ["a", "b", "c", "d"].map((key) => ({ key, label: "l".repeat(600) })),
      })),
    }),
    wide,
  );
  assert.ok(!tooMuch.ok);
  assert.match(tooMuch.error, /in total; the limit is 25000\.$/);
});

test("lists what the agent must fix, with the limits it was told", () => {
  assert.deepEqual(outputProblems(undefined, undefined, limits, GITHUB.workflows), [
    "output.json is missing.",
  ]);
  assert.deepEqual(outputProblems("{", "code", limits, GITHUB.workflows), [
    "output.json is not valid JSON.",
  ]);
  assert.deepEqual(
    outputProblems(
      JSON.stringify({ summary: "x".repeat(5000), decisions: [] }),
      undefined,
      limits,
      GITHUB.workflows,
    ),
    [`summary has 5000 characters; the limit is ${limits.summary}.`],
  );
  assert.deepEqual(
    outputProblems(
      JSON.stringify({ summary: "x".repeat(3000), decisions: [] }),
      undefined,
      limits,
      GITHUB.workflows,
    ),
    [],
    "within the margin",
  );
  assert.deepEqual(
    outputProblems(
      JSON.stringify({ status: "done", summary: "s" }),
      "review",
      limits,
      GITHUB.workflows,
    ),
    [],
  );
});

test("a revised plan's decisions start after the settled ones", () => {
  const text = (ids: number[]) => JSON.stringify({ summary: "s", decisions: ids.map(decision) });
  const revised = parsePlan(text([3, 4]), limits, 3);
  assert.deepEqual(revised.ok && revised.value.decisions.map((d) => d.id), [3, 4]);
  assert.deepEqual(parsePlan(text([1, 2]), limits, 3), {
    ok: false,
    error: "decisions[0].id must be 3.",
  });
  assert.deepEqual(outputProblems(text([1]), undefined, limits, GITHUB.workflows, 3), [
    "decisions[0].id must be 3.",
  ]);
});

const route = (value: Record<string, unknown>) => parseRouteOutput(JSON.stringify(value), limits);
const left = (...stages: Stage[]) => stages.map((stage) => ({ stage, reason: `No ${stage}.` }));

test("a route lists stages in order with briefs, ends with review, and leaves the others out with reasons", () => {
  const parsed = route({
    summary: "Code and review.",
    route: [
      { stage: "code", brief: "Rename it." },
      { stage: "review", brief: "Check the rename." },
    ],
    skipped: left("web", "design", "test"),
  });
  assert.ok(parsed.ok);
  assert.deepEqual(
    parsed.value.route.map((step) => step.stage),
    ["code", "review"],
  );
  assert.deepEqual(
    parsed.value.skipped.map((step) => step.stage),
    ["web", "design", "test"],
  );
  const alone = route({
    summary: "Nothing to do but review.",
    route: [{ stage: "review", brief: "The request is already done: judge it." }],
    skipped: left("web", "design", "code", "test"),
  });
  assert.ok(alone.ok, "review alone is a route");
});

test("a route rejects one without review, out of order, listed twice, missing or without a reason", () => {
  const review = { stage: "review", brief: "r" };
  const cases: [Record<string, unknown>, RegExp][] = [
    [
      { route: [{ stage: "code", brief: "c" }], skipped: left("web", "design", "test", "review") },
      /route must end with review/,
    ],
    [{ route: [], skipped: left("web", "design", "code", "test", "review") }, /end with review/],
    [{ skipped: left("web", "design", "code", "test", "review") }, /route must be a list/],
    [
      { route: [review, { stage: "code", brief: "c" }], skipped: left("web", "design", "test") },
      /order of stages/,
    ],
    [
      {
        route: [{ stage: "code", brief: "c" }, review],
        skipped: left("web", "code", "design", "test"),
      },
      /code is listed twice/,
    ],
    [
      { route: [{ stage: "code", brief: "c" }, review], skipped: left("design") },
      /missing: web, test/,
    ],
    [
      {
        route: [{ stage: "code", brief: "c" }, review],
        skipped: [...left("web", "design"), { stage: "test" }],
      },
      /skipped\[2\]\.reason must be a non-empty string/,
    ],
    [
      {
        route: [{ stage: "plan", brief: "p" }, review],
        skipped: left("web", "design", "code", "test"),
      },
      /route\[0\]\.stage must be one of web, design, code, test, review/,
    ],
  ];
  for (const [value, error] of cases) {
    const parsed = route({ summary: "s", ...value });
    assert.ok(!parsed.ok);
    assert.match(parsed.error, error);
  }
  assert.deepEqual(outputProblems("{}", "route", limits, GITHUB.workflows), [
    "summary must be a non-empty string.",
  ]);
});
