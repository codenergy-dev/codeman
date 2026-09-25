import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentEnv, agentPath, launcher } from "./sandbox.ts";

const AGENT_ENV = agentEnv("/usr/bin:/bin");

test("the agent gets only its own environment and the harness's variables", () => {
  const result = spawnSync(
    "/bin/bash",
    ["-c", launcher(AGENT_ENV), "codeman-agent", "API_KEY CONFIG", "/", "/usr/bin/env"],
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

test("the agent's PATH keeps the job's tools, except those in the runner's home", () => {
  assert.equal(
    agentPath(
      "/home/runner/.cargo/bin:/opt/hostedtoolcache/node/24/x64/bin:relative:/home/runner:/usr/bin:/it's",
      "/home/runner",
    ),
    "/opt/hostedtoolcache/node/24/x64/bin:/usr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/bin",
  );
  assert.equal(agentPath("/home/runner2/bin", "/home/runner").split(":")[0], "/home/runner2/bin");
});
