import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { AGENT_ENV, LAUNCHER } from "./sandbox.ts";

test("the agent gets only its own environment and the harness's variables", () => {
  const result = spawnSync(
    "/bin/bash",
    ["-c", LAUNCHER, "codeman-agent", "API_KEY CONFIG", "/", "/usr/bin/env"],
    {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        API_KEY: "sk-test",
        CONFIG: '{"a": "b c"}',
        XDG_CONFIG_HOME: "/home/runner/.config",
        RUNNER_TOOL_CACHE: "/opt/hostedtoolcache",
        GITHUB_TOKEN: "ghs_secret",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const env = Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  delete env._;
  delete env.PWD;
  delete env.SHLVL;
  delete env.OLDPWD;
  assert.deepEqual(env, { ...AGENT_ENV, API_KEY: "sk-test", CONFIG: '{"a": "b c"}' });
});
