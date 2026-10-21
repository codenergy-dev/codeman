import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hasGit } from "../../fakes/github/git.ts";
import { ProcessExecutor } from "./executor.ts";
import {
  FileCommandError,
  parseKeyValues,
  readCommands,
  readStepFiles,
  stepFiles,
} from "./files.ts";
import { byName, dispatch, setup } from "./testing.ts";

const skip = !hasGit()
  ? "git is not on the PATH"
  : spawnSync("bash", ["-c", "true"]).status !== 0
    ? "bash is not on the PATH"
    : false;

test("key-value files take NAME=value lines and heredocs, and refuse anything else", () => {
  assert.deepEqual(
    [...parseKeyValues("a=1\nb=x=y\n\nc<<EOF\nline 1\r\nline 2\nEOF\nd=\n")],
    [
      ["a", "1"],
      ["b", "x=y"],
      ["c", "line 1\nline 2"],
      ["d", ""],
    ],
  );
  // As the runner's parser, which checks the line rather than the name.
  assert.deepEqual([...parseKeyValues("=1\n")], [["", "1"]]);
  assert.throws(() => parseKeyValues("novalue\n"), FileCommandError);
  assert.throws(() => parseKeyValues("a<<\n"), /delimiter must not be empty/);
  assert.throws(() => parseKeyValues("a<<EOF\nnever closed\n"), /Matching delimiter not found/);
});

test("a malformed file keeps the pairs before its error and fails the step; NODE_OPTIONS is only left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeman-files-"));
  try {
    const files = stepFiles(dir, "/job/_temp/_runner_file_commands");
    writeFileSync(files.host.output, "first=1\nbroken\nlater=2\n");
    writeFileSync(files.host.env, "node_options=--require /tmp/x.js\nKEPT=yes\n");
    writeFileSync(files.host.path, "/a\n\n/b \n");
    const found = readStepFiles(files.host);
    assert.deepEqual([...found.outputs], [["first", "1"]]);
    assert.deepEqual([...found.env], [["KEPT", "yes"]]);
    assert.deepEqual(found.paths, ["/a", "/b "]);
    assert.equal(found.failed, true);
    assert.deepEqual(found.errors, [
      "Unable to process file command 'output' successfully.",
      "Invalid format 'broken'",
      "Can't store NODE_OPTIONS output parameter using '$GITHUB_ENV' command.",
    ]);
    writeFileSync(files.host.output, "");
    assert.equal(
      readStepFiles(files.host).failed,
      false,
      "a blocked name alone does not fail the step",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("printed commands are parsed and refused as the runner does", () => {
  const found = readCommands(
    [
      "::add-mask::hidden",
      "::add-mask::two%0Alines",
      "::add-mask::   ",
      "::set-output name=x::a%0Ab%0a ",
      "::set-output::nameless",
      "  ::SET-ENV name=EVIL::1",
      "::not-a-command::ignored",
      "::stop-commands::",
      "::stop-commands::error",
      "::stop-commands::pause-1234",
      "::add-path::/evil",
      "::PAUSE-1234::",
      "::add-path::/evil",
      "::error file=a.ts::broke",
    ].join("\n"),
  );
  assert.deepEqual(found.masks, ["hidden", "two\nlines", "two", "lines"]);
  assert.deepEqual(found.warnings, [
    "Can't add secret mask for empty string in ##[add-mask] command.",
  ]);
  // Data keeps trailing spaces, and only upper-case escapes are decoded.
  assert.deepEqual([...found.outputs], [["x", "a\nb%0a "]]);
  assert.deepEqual(found.refused, [
    "set-output",
    "set-env",
    "stop-commands",
    "stop-commands",
    "add-path",
  ]);
  assert.ok(found.errors.includes("broke"));
  assert.ok(found.errors.includes("Required field 'name' is missing in ##[set-output] command."));
  assert.ok(found.errors.some((line) => line.startsWith("The `set-env` command is disabled.")));
  assert.ok(found.errors.some((line) => line.startsWith("You cannot use a endToken")));
});

test("GITHUB_OUTPUT, GITHUB_ENV, GITHUB_PATH and GITHUB_STEP_SUMMARY reach the next steps as on GitHub", {
  skip,
}, async () => {
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
jobs:
  a:
    runs-on: ubuntu-latest
    outputs:
      multi: \${{ steps.one.outputs.multi }}
      env: \${{ steps.two.outputs.env }}
    steps:
      - id: one
        shell: bash
        run: |
          echo "plain=1" >> "$GITHUB_OUTPUT"
          { echo "multi<<END"; echo "first"; echo "second"; echo "END"; } >> "$GITHUB_OUTPUT"
          echo "FROM_FILE=yes" >> "$GITHUB_ENV"
          echo "GITHUB_SHA=forged" >> "$GITHUB_ENV"
          mkdir -p "$RUNNER_TEMP/bin" && printf '#!/bin/sh\\necho tool-ran\\n' > "$RUNNER_TEMP/bin/e2e-tool" && chmod +x "$RUNNER_TEMP/bin/e2e-tool"
          echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"
          echo "## Summary" >> "$GITHUB_STEP_SUMMARY"
      - id: two
        run: |
          echo "env=$FROM_FILE-\${{ env.FROM_FILE }}-$(e2e-tool)-$GITHUB_SHA" >> "$GITHUB_OUTPUT"
`,
    },
    new ProcessExecutor(),
  );
  const result = await dispatch(simulator);
  const a = byName(result).a;
  assert.equal(a?.result, "success", a?.log);
  assert.equal(a?.outputs.multi, "first\nsecond");
  assert.equal(a?.outputs.env, `yes-yes-tool-ran-${a?.env.GITHUB_SHA}`);
});

test("::set-env:: and ::add-path:: fail their step and reach no later step; masks hide values", {
  skip,
}, async () => {
  const { simulator } = await setup(
    {
      ".github/workflows/main.yml": `on: workflow_dispatch
jobs:
  a:
    runs-on: ubuntu-latest
    outputs:
      seen: \${{ steps.after.outputs.seen }}
      masked: \${{ steps.mask.outputs.value }}
    steps:
      - id: mask
        run: |
          echo "::add-mask::sensitive-42"
          echo "value=sensitive-42" >> "$GITHUB_OUTPUT"
          echo "printed sensitive-42 and \${{ secrets.TOP_SECRET }}"
      - id: evil
        continue-on-error: true
        run: |
          echo "::set-env name=EVIL::1"
          echo "::add-path::/evil"
      - id: blocked
        run: |
          echo "NODE_OPTIONS=--require /tmp/evil.js" >> "$GITHUB_ENV"
          echo "::stop-commands::e2e-pause-token"
          echo "::set-env name=EVIL::2"
          echo "::e2e-pause-token::"
      - id: after
        run: |
          echo "seen=[$EVIL][$PATH]" >> "$GITHUB_OUTPUT"
          echo "node=[$NODE_OPTIONS]" >> "$GITHUB_OUTPUT"
`,
    },
    new ProcessExecutor(),
  );
  const a = byName(await dispatch(simulator)).a;
  assert.equal(a?.steps[1]?.outcome, "failure");
  // NODE_OPTIONS in GITHUB_ENV is left out without failing the step, and a command between
  // stop-commands and its token is not processed.
  assert.equal(a?.steps[2]?.outcome, "success", a?.log);
  assert.match(a?.log ?? "", /Can't store NODE_OPTIONS output parameter/);
  assert.equal(a?.steps[3]?.outputs.node, "[]");
  assert.match(a?.log ?? "", /The `set-env` command is disabled/);
  assert.match(a?.outputs.seen ?? "", /^\[\]\[/);
  assert.ok(!a?.outputs.seen?.includes("/evil"));
  assert.equal(a?.outputs.masked, undefined, "an output holding a masked value is not sent");
  // The step's header shows its script's first line before the mask exists, as on GitHub.
  const printed = (a?.log ?? "").split("\n").filter((line) => !line.startsWith("##[group]"));
  assert.ok(!printed.join("\n").includes("sensitive-42"));
  assert.ok(!a?.log.includes("s3cr3t-value"));
  assert.match(a?.log ?? "", /printed \*\*\* and \*\*\*/);
});
