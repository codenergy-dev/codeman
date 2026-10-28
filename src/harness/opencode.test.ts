import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

test("with self-hosted inference, the only provider is the gateway's, and the token stays out of argv", () => {
  const command = openCode.command({
    executable: "/opt/codeman/opencode",
    model: "qwen3-coder:30b",
    apiKey: "run-token",
    provider: { baseUrl: "https://pod1-8080.proxy.runpod.net/v1", contextLength: 65536 },
    prompt: "Read .codeman/task.md",
  });
  assert.deepEqual(command.args.slice(0, 5), [
    "run",
    "--format",
    "json",
    "--model",
    "codeman/qwen3-coder:30b",
  ]);
  assert.ok(!command.args.join(" ").includes("run-token"));
  assert.equal(command.env.OPENROUTER_API_KEY, undefined);
  const config = JSON.parse(command.env.OPENCODE_CONFIG_CONTENT ?? "") as {
    enabled_providers: string[];
    model: string;
    provider: Record<
      string,
      { npm: string; options: Record<string, string>; models: Record<string, unknown> }
    >;
  };
  assert.deepEqual(config.enabled_providers, ["codeman"]);
  assert.equal(config.model, "codeman/qwen3-coder:30b");
  assert.deepEqual(Object.keys(config.provider), ["codeman"]);
  assert.equal(config.provider.codeman?.npm, "@ai-sdk/openai-compatible");
  assert.deepEqual(config.provider.codeman?.options, {
    baseURL: "https://pod1-8080.proxy.runpod.net/v1",
    apiKey: "run-token",
  });
  assert.deepEqual(config.provider.codeman?.models["qwen3-coder:30b"], {
    name: "qwen3-coder:30b",
    limit: { context: 65536, output: 16384 },
  });
});

test("a self-hosted model that reads images gets image input; any other, text only", () => {
  const provider = { baseUrl: "https://pod1-8080.proxy.runpod.net/v1", apiKey: "run-token" };
  const model = (config: Record<string, unknown>) =>
    (config.provider as { codeman: { models: Record<string, unknown> } }).codeman.models["m/v"];
  assert.deepEqual(model(openCodeConfig("m/v", undefined, { ...provider, vision: true })), {
    name: "m/v",
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  });
  // Unknown to OpenCode's catalog, a model without modalities reads text only.
  assert.deepEqual(model(openCodeConfig("m/v", undefined, provider)), { name: "m/v" });
  assert.deepEqual(model(openCodeConfig("m/v", undefined, { ...provider, vision: false })), {
    name: "m/v",
  });
});

test("only the e2e build turns OpenCode's model catalog fetch off", () => {
  const options = { executable: "/opt/codeman/opencode", model: "a/b", apiKey: "k", prompt: "p" };
  assert.equal(openCode.command(options).env.OPENCODE_DISABLE_MODELS_FETCH, undefined);
  // The e2e build's flag, in a process of its own, so this one keeps it off.
  const script = `globalThis.__CODEMAN_E2E__ = true;
const { openCode } = await import(${JSON.stringify(new URL("./opencode.ts", import.meta.url).href)});
console.log(JSON.stringify(openCode.command(${JSON.stringify(options)}).env));`;
  const env = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, CODEMAN_E2E_ENDPOINTS: "{}" },
      encoding: "utf8",
    }),
  ) as Record<string, string>;
  assert.equal(env.OPENCODE_DISABLE_MODELS_FETCH, "1");
  assert.equal(env.OPENROUTER_API_KEY, "k");
});
