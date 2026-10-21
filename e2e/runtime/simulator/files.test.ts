import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { hasGit } from "../../fakes/github/git.ts";
import { ProcessExecutor } from "./executor.ts";
import { FileCommandError, parseKeyValues, readCommands } from "./files.ts";
import { byName, dispatch, setup } from "./testing.ts";

const skip = !hasGit()
  ? "git is not on the PATH"
  : spawnSync("bash", ["-c", "true"]).status !== 0
    ? "bash is not on the PATH"
    : false;

test("key-value files take NAME=value lines and heredocs, and refuse anything else", () => {
  assert.deepEqual(
    [...parseKeyValues("a=1\nb=x=y\n\nc<<EOF\nline 1\r\nline 2\nEOF\nd=\n", "GITHUB_OUTPUT")],
    [
      ["a", "1"],
      ["b", "x=y"],
      ["c", "line 1\nline 2"],
      ["d", ""],
    ],
  );
  assert.throws(() => parseKeyValues("novalue\n", "GITHUB_OUTPUT"), FileCommandError);
  assert.throws(() => parseKeyValues("=1\n", "GITHUB_OUTPUT"), FileCommandError);
  assert.throws(
    () => parseKeyValues("a<<EOF\nnever closed\n", "GITHUB_ENV"),
    /Matching delimiter not found/,
  );
});

test("printed commands: masks, deprecated outputs, stop-commands, and set-env and add-path refused", () => {
  const found = readCommands(
    [
      "::add-mask::hidden",
      "::set-output name=x::a%0Ab",
      "  ::set-env name=EVIL::1",
      "::stop-commands::pause",
      "::add-path::/evil",
      "::pause::",
      "::add-path::/evil",
      "::error file=a.ts::broke",
    ].join("\n"),
  );
  assert.deepEqual(found.masks, ["hidden"]);
  assert.deepEqual([...found.outputs], [["x", "a\nb"]]);
  assert.deepEqual(found.refused, ["set-env", "add-path"]);
  assert.ok(found.errors.includes("broke"));
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
      - id: after
        run: echo "seen=[$EVIL][$PATH]" >> "$GITHUB_OUTPUT"
`,
    },
    new ProcessExecutor(),
  );
  const a = byName(await dispatch(simulator)).a;
  assert.equal(a?.steps[1]?.outcome, "failure");
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
