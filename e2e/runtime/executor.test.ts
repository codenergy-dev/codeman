import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { actionArgv, type StopSignal, stepArgv, stopStep } from "./executor.ts";

/** The Docker executor's parts that need no Docker: its argv and how it stops a step. */

test("a cancelled step gets SIGINT, SIGTERM 7.5 s later, then SIGKILL 2.5 s later", async () => {
  const sent: string[] = [];
  let clock = 0;
  const signals = await stopStep(
    async (signal) => {
      sent.push(`${clock} ${signal}`);
    },
    () => false,
    async (ms) => {
      clock += ms;
    },
  );
  assert.deepEqual(signals, ["INT", "TERM", "KILL"]);
  assert.deepEqual(sent, ["0 INT", "7500 TERM", "10000 KILL"]);
});

test("a step that ends at SIGINT gets no SIGTERM, but what it left gets SIGKILL", async () => {
  const sent: StopSignal[] = [];
  let ended = false;
  let clock = 0;
  await stopStep(
    async (signal) => {
      sent.push(signal);
      if (signal === "INT") ended = true;
    },
    () => ended,
    async (ms) => {
      clock += ms;
    },
  );
  assert.deepEqual(sent, ["INT", "KILL"]);
  assert.equal(clock, 0);
});

test("a step records its process ID before it runs, and keeps its argv and env", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeman-e2e-step-"));
  try {
    const pidFile = join(dir, "step.pid");
    const [file = "", ...args] = stepArgv(pidFile, [
      "node",
      "-e",
      'console.log(JSON.stringify([process.pid, process.argv[1], process.env["INPUT_TEMPLATE-VERSION"]]))',
      "one two",
    ]);
    const ran = spawnSync(file, args, {
      encoding: "utf8",
      env: { ...process.env, "INPUT_TEMPLATE-VERSION": "1" },
    });
    assert.equal(ran.status, 0, ran.stderr);
    const [pid, word, version] = JSON.parse(ran.stdout) as [number, string, string];
    // exec keeps the process: the recorded ID is the command's own.
    assert.equal(readFileSync(pidFile, "utf8").trim(), String(pid));
    assert.equal(word, "one two");
    // An input's variable, whose name has a hyphen, reaches the command.
    assert.equal(version, "1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codeman's action copies the bundle into its checkout and runs the runner's Node", () => {
  const argv = actionArgv("/home/runner/work/app/app/.codeman/action/");
  assert.equal(argv[0], "bash");
  assert.match(
    argv[2] ?? "",
    /exec \/opt\/hostedtoolcache\/node\/24\.21\.0\/x64\/bin\/node "\$a\/dist\/index\.js"/,
  );
  assert.equal(argv.at(-1), "/home/runner/work/app/app/.codeman/action/");
});
