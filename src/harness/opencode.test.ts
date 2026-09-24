import assert from "node:assert/strict";
import { test } from "node:test";
import { openCode, openCodeConfig } from "./opencode.ts";

test("passes the key only through the environment", () => {
  const command = openCode.command({
    executable: "/opt/codeman/opencode",
    model: "deepseek/deepseek-v4.1-flash",
    apiKey: "sk-or-v1-secret",
    prompt: "Read .codeman/task.md",
  });
  assert.equal(command.file, "/opt/codeman/opencode");
  assert.deepEqual(command.args, [
    "run",
    "--format",
    "json",
    "--model",
    "openrouter/deepseek/deepseek-v4.1-flash",
    "Read .codeman/task.md",
  ]);
  assert.ok(!command.args.join(" ").includes("sk-or"));
  assert.equal(command.env.OPENROUTER_API_KEY, "sk-or-v1-secret");
  assert.deepEqual(
    JSON.parse(command.env.OPENCODE_CONFIG_CONTENT ?? ""),
    openCodeConfig("deepseek/deepseek-v4.1-flash"),
  );
});

test("locks the configuration down", () => {
  const config = openCodeConfig("a/b") as {
    autoupdate: boolean;
    share: string;
    enabled_providers: string[];
    permission: Record<string, string>;
  };
  assert.equal(config.autoupdate, false);
  assert.equal(config.share, "disabled");
  assert.deepEqual(config.enabled_providers, ["openrouter"]);
  for (const name of ["webfetch", "websearch", "external_directory", "question", "doom_loop"]) {
    assert.equal(config.permission[name], "deny", name);
  }
  assert.ok(!Object.values(config.permission).includes("ask"));
});
