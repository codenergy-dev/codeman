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

test("loads Codeman's rules as instructions, next to the repository's AGENTS.md", () => {
  const command = openCode.command({
    executable: "/opt/codeman/opencode",
    model: "a/b",
    apiKey: "k",
    prompt: "p",
    instructions: "/home/codeman-agent/work/.codeman/rules.md",
  });
  const config = JSON.parse(command.env.OPENCODE_CONFIG_CONTENT ?? "") as {
    instructions?: string[];
  };
  assert.deepEqual(config.instructions, ["/home/codeman-agent/work/.codeman/rules.md"]);
  assert.equal("instructions" in openCodeConfig("a/b"), false);
});

test("continues the last session when resuming", () => {
  const command = openCode.command({
    executable: "/opt/codeman/opencode",
    model: "a/b",
    apiKey: "k",
    prompt: "Fix it.",
    resume: true,
  });
  assert.deepEqual(command.args, [
    "run",
    "--format",
    "json",
    "--model",
    "openrouter/a/b",
    "--continue",
    "Fix it.",
  ]);
});
