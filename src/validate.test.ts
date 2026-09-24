import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStatus } from "./collect.ts";
import { checkPlanResult, decodeText } from "./validate.ts";

const plan = "plans/2026-09-24-x.md";
const manifest = (changes: unknown[]) => ({
  version: 1,
  harness: "opencode",
  exitCode: 0,
  timedOut: false,
  changes,
});

test("parses git status output", () => {
  const output = [
    "?? plans/new.md",
    " M README.md",
    " D old.txt",
    " T link",
    "M  staged.txt",
    "",
  ].join("\0");
  assert.deepEqual(parseStatus(output), [
    { path: "plans/new.md", status: "added" },
    { path: "README.md", status: "modified" },
    { path: "old.txt", status: "deleted" },
    { path: "link", status: "modified" },
  ]);
});

test("accepts the plan and reports other changes as ignored", () => {
  const result = checkPlanResult(
    manifest([
      { path: plan, status: "added", type: "file", size: 100 },
      { path: "src/app.ts", status: "modified", type: "file", size: 10 },
    ]),
    plan,
  );
  assert.deepEqual(result, { ok: true, value: { ignored: ["src/app.ts"] } });
});

test("rejects a missing, deleted, non-file or oversized plan", () => {
  const cases = [
    manifest([]),
    manifest([{ path: plan, status: "deleted" }]),
    manifest([{ path: plan, status: "added", type: "symlink" }]),
    manifest([{ path: plan, status: "added", type: "file", size: 1024 * 1024 }]),
    { version: 2, changes: [] },
    undefined,
  ];
  for (const value of cases) assert.equal(checkPlanResult(value, plan).ok, false);
});

test("decodes only valid UTF-8", () => {
  assert.equal(decodeText(Buffer.from("olá", "utf8")), "olá");
  assert.equal(decodeText(Buffer.from([0xff, 0xfe, 0x00])), undefined);
});
