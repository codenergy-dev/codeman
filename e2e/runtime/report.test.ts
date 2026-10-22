import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { memoryProblem } from "./compose.ts";
import { matches } from "./expect.ts";
import { TAIL, Timeline, writePass, writeReport } from "./report.ts";

test("a failure's report holds every part, and its message ends with the last events and the path", () => {
  let now = 1_000;
  const timeline = new Timeline(() => now);
  for (let index = 1; index <= 30; index++) {
    now += 500;
    timeline.add("job", `event ${index}`);
  }
  const root = mkdtempSync(join(tmpdir(), "codeman-e2e-report-"));
  const dir = join(root, "happy-path", "plan");
  const message = writeReport(
    dir,
    {
      scenario: "happy-path/plan",
      error: "expect: i1: labels codeman:done\n- i1 lacks the label codeman:done.",
      timeline,
      jobs: { "001-run9-Select tasks.log": "Select tasks: success\n" },
      fakes: { github: { requests: [{ method: "GET" }] }, llm: { turns: [] } },
      store: { "organizations/acme/runs/1-1-1": { cost: 0.02 } },
      engine: {},
      violations: { github: [] },
    },
    root,
  );
  for (const file of [
    "README.md",
    "timeline.txt",
    "timeline.json",
    "jobs/001-run9-Select-tasks.log",
    "fakes/github-requests.json",
    "fakes/llm-turns.json",
    "store.json",
    "engine.json",
    "violations.json",
  ]) {
    assert.ok(existsSync(join(dir, file)), file);
  }
  assert.equal(readFileSync(join(dir, "timeline.txt"), "utf8").trim().split("\n").length, 30);
  const lines = message.split("\n");
  assert.equal(lines[0], "expect: i1: labels codeman:done");
  assert.ok(message.includes(`The timeline's last ${TAIL} events:`));
  assert.ok(message.includes("event 30"));
  assert.ok(message.includes(`event ${30 - TAIL + 1}`));
  assert.ok(!message.includes(`event ${30 - TAIL}\n`));
  assert.equal(lines.at(-1), "The report: happy-path/plan/");
  assert.match(
    lines.find((line) => line.includes("event 30")) ?? "",
    /^\s+15\.0s {2}job {8}event 30$/,
  );
});

test("a pass keeps its timeline and its jobs' logs", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeman-e2e-pass-"));
  const timeline = new Timeline();
  timeline.add("pass", "happy-path/plan");
  writePass(dir, timeline, { "001-x.log": "x\n" });
  assert.match(readFileSync(join(dir, "timeline.txt"), "utf8"), /pass {7}happy-path\/plan/);
  assert.equal(readFileSync(join(dir, "jobs", "001-x.log"), "utf8"), "x\n");
});

test("patterns: scalars, ranges, objects with some fields, and lists in order", () => {
  assert.equal(matches({ kind: "equals", value: 3 }, 3), undefined);
  assert.equal(matches({ kind: "equals", value: "3" }, 3), undefined);
  assert.match(matches({ kind: "equals", value: "a" }, "b") ?? "", /"b", not "a"/);
  assert.equal(matches({ kind: "range", atLeast: 1, atMost: 2 }, 1.5), undefined);
  assert.match(matches({ kind: "range", atLeast: undefined, atMost: 2 }, 3) ?? "", /above 2/);
  const object = { kind: "object" as const, fields: { a: { kind: "equals" as const, value: 1 } } };
  assert.equal(matches(object, { a: 1, b: 2 }), undefined);
  assert.match(matches(object, { a: 2 }) ?? "", /^a: 2, not 1/);
  const list = { kind: "list" as const, items: [{ kind: "equals" as const, value: "x" }] };
  assert.equal(matches(list, ["x"]), undefined);
  assert.match(matches(list, ["x", "y"]) ?? "", /2 items, not 1/);
});

test("a vllm scenario is refused on a VM with too little memory, by name, the others are not", () => {
  const gib = 2 ** 30;
  const plain = { id: "happy-path/openrouter-plan-only", profiles: [] };
  const ollama = { id: "parallel/four-tasks-one-pod", profiles: ["ollama" as const] };
  const vllm = { id: "parallel/vllm-two-seats", profiles: ["vllm" as const] };
  assert.equal(memoryProblem([plain, ollama], 7.65 * gib), undefined);
  assert.equal(
    memoryProblem([plain, ollama, vllm], 7.65 * gib),
    "Docker has 7.7 GiB of memory, too little for a scenario: parallel/vllm-two-seats needs about 8.0 GiB, with the vllm profile. Raise Docker Desktop's memory (Settings, Resources) to 10 GB or more, or select scenarios without it.",
  );
  // One scenario at a time: an Ollama and a vLLM scenario fit where each fits alone.
  assert.equal(memoryProblem([ollama, vllm], 9.7 * gib), undefined);
  assert.match(
    memoryProblem([vllm, { ...vllm, id: "budgets/x" }], 3 * gib) ?? "",
    /too little for 2 scenarios: parallel\/vllm-two-seats needs about 8\.0 GiB.*; budgets\/x needs/,
  );
});
