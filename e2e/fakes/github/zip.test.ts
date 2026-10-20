import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hasGit } from "./git.ts";
import { workflowInfo } from "./workflows.ts";
import { readZip, writeZip } from "./zip.ts";

test("a zip written in-house reads back, stored or deflated", () => {
  const entries = [
    { path: "a.txt", data: Buffer.from("a") },
    { path: "dir/big.txt", data: Buffer.from("repeat ".repeat(1000)) },
    { path: "empty", data: Buffer.alloc(0) },
  ];
  const zip = writeZip(entries);
  assert.ok(zip.length < 1000, "the repeated text is deflated");
  assert.deepEqual(
    readZip(zip).map((entry) => [entry.path, entry.data.toString()]),
    entries.map((entry) => [entry.path, entry.data.toString()]),
  );
  assert.deepEqual(writeZip(entries), zip, "the same files give the same bytes");
});

test("a zip another tool wrote reads, from its central directory", {
  skip: hasGit() ? false : "git is not on the PATH",
}, () => {
  const root = new URL("../../../", import.meta.url).pathname;
  const archive = execFileSync(
    "git",
    ["archive", "--format=zip", "HEAD", "--", "package.json", "templates"],
    {
      cwd: root,
    },
  );
  const files = new Map(readZip(archive).map((entry) => [entry.path, entry.data.toString("utf8")]));
  assert.equal(
    files.get("package.json"),
    execFileSync("git", ["show", "HEAD:package.json"], { cwd: root }).toString(),
  );
  assert.ok(files.has("templates/codeman.yml"));
});

test("a zip that leaves its root, or fails its CRC, does not read", () => {
  assert.throws(
    () => readZip(writeZip([{ path: "../evil", data: Buffer.from("x") }])),
    /leaves the archive's root/,
  );
  const zip = writeZip([{ path: "a.txt", data: Buffer.from("hello") }]);
  const at = 30 + "a.txt".length;
  zip.writeUInt8((zip.readUInt8(at) ^ 0xff) & 0xff, at);
  assert.throws(() => readZip(zip), /CRC/);
  assert.throws(() => readZip(Buffer.from("not a zip")), /Not a zip/);
});

test("reads a workflow's name, dispatch trigger and inputs as GitHub checks a dispatch", () => {
  const templates = new URL("../../../templates/", import.meta.url);
  assert.deepEqual(workflowInfo(readFileSync(new URL("codeman.yml", templates), "utf8")), {
    name: "Codeman",
    dispatch: true,
    inputs: ["model", "task-budget", "monthly-budget", "max-runs", "batch"],
  });
  const task = workflowInfo(readFileSync(new URL("codeman-task.yml", templates), "utf8"));
  assert.equal(task.dispatch, false, "codeman-task.yml is a reusable workflow");
  assert.deepEqual(workflowInfo("on: workflow_dispatch\n"), {
    name: undefined,
    dispatch: true,
    inputs: [],
  });
  assert.deepEqual(workflowInfo('name: "CI"\non: [push, workflow_dispatch]\n'), {
    name: "CI",
    dispatch: true,
    inputs: [],
  });
  assert.equal(workflowInfo("on:\n  push:\n    branches: [main]\n").dispatch, false);
});
