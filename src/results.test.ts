import assert from "node:assert/strict";
import { test } from "node:test";
import { logTail, safeName } from "./results.ts";

test("names from workflows cannot leave their directory", () => {
  assert.equal(safeName("../../etc"), "__.._etc");
  assert.equal(safeName(".."), "_");
  assert.equal(safeName("build logs/ios"), "build_logs_ios");
  assert.equal(safeName(".hidden"), "_hidden");
  assert.equal(safeName(""), "_");
});

test("keeps the end of long logs", () => {
  assert.equal(logTail("short", 10), "short");
  const tail = logTail(`${"a".repeat(100)}END`, 10);
  assert.match(tail, /^\[\.\.\. 93 earlier bytes omitted \.\.\.\]\naaaaaaaEND$/);
});
