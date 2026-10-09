import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  OLLAMA_SETTINGS,
  OLLAMA_VERSION,
  type OllamaValue,
  ollamaEnvironment,
  ollamaSetting,
  parseOllamaVariables,
  REFUSED_OLLAMA_SETTINGS,
} from "./ollama.ts";

test("each key is its variable in kebab-case, and no key is both accepted and refused", () => {
  for (const [key, { variable }] of Object.entries(OLLAMA_SETTINGS)) {
    assert.equal(variable, `OLLAMA_${key.toUpperCase().replaceAll("-", "_")}`);
  }
  for (const key of Object.keys(REFUSED_OLLAMA_SETTINGS)) {
    assert.equal(OLLAMA_SETTINGS[key], undefined, key);
  }
});

test("the settings become the server's variables, sorted, with values as Ollama takes them", () => {
  assert.deepEqual(ollamaEnvironment({ "num-parallel": "04", "context-length": "65536" }), {
    OLLAMA_CONTEXT_LENGTH: "65536",
    OLLAMA_NUM_PARALLEL: "4",
  });
  assert.deepEqual(ollamaEnvironment(undefined), {});
  assert.throws(() => ollamaEnvironment({ host: "0.0.0.0" }), /cannot set `host`/);
  assert.deepEqual(ollamaSetting("load-timeout", "1h30m"), { ok: true, value: "1h30m" });
  assert.deepEqual(ollamaSetting("load-timeout", "300"), { ok: true, value: "300" });
  assert.equal(ollamaSetting("load-timeout", "-5m").ok, false);
  assert.equal(ollamaSetting("num-parallel", "1e3").ok, false);
  assert.equal(ollamaSetting("context-length", "99999999999999999999").ok, false);
});

test("the gateway reads CODEMAN_OLLAMA: only the listed variables, with valid values", () => {
  assert.deepEqual(parseOllamaVariables(undefined), { ok: true, value: {} });
  assert.deepEqual(parseOllamaVariables(""), { ok: true, value: {} });
  assert.deepEqual(parseOllamaVariables('{"OLLAMA_NUM_PARALLEL":"4"}'), {
    ok: true,
    value: { OLLAMA_NUM_PARALLEL: "4" },
  });
  assert.deepEqual(parseOllamaVariables('{"OLLAMA_HOST":"0.0.0.0:11434"}'), {
    ok: false,
    error: "CODEMAN_OLLAMA sets `OLLAMA_HOST`, which Codeman does not.",
  });
  assert.deepEqual(parseOllamaVariables('{"OLLAMA_NUM_PARALLEL":4}'), {
    ok: false,
    error: "CODEMAN_OLLAMA sets `OLLAMA_NUM_PARALLEL`, which Codeman does not.",
  });
  assert.deepEqual(parseOllamaVariables('{"OLLAMA_NUM_PARALLEL":"0"}'), {
    ok: false,
    error: "CODEMAN_OLLAMA: `ollama`'s `num-parallel` must be a whole number, at least 1.",
  });
  assert.equal(parseOllamaVariables("[]").ok, false);
  assert.equal(parseOllamaVariables("{").ok, false);
});

test("the docs list the accepted and refused keys of the code, for the pod image's Ollama", () => {
  const docs = readFileSync("docs/settings/ollama.md", "utf8");
  const section = (heading: string) => docs.split(`## ${heading}\n`)[1]?.split(/^## /m)[0] ?? "";
  const rows = (text: string) =>
    [...text.matchAll(/^\| `([a-z-]+)` \| `([A-Z_]+)` \| ([^|]+) \|/gm)].map((match) => [
      match[1],
      match[2],
      (match[3] ?? "").trim(),
    ]);
  const described = (value: OllamaValue) => {
    switch (value.kind) {
      case "count":
        return `Whole number, at least ${value.min}`;
      case "boolean":
        return "`true` or `false`";
      case "choice":
        return `${value.values
          .slice(0, -1)
          .map((v) => `\`${v}\``)
          .join(", ")} or \`${value.values.at(-1)}\``;
      case "duration":
        return "A duration, such as `10m` or `1h30m`, or whole seconds";
    }
  };
  assert.deepEqual(
    rows(section("Accepted keys")),
    Object.entries(OLLAMA_SETTINGS).map(([key, { variable, value }]) => [
      key,
      variable,
      described(value),
    ]),
  );
  assert.deepEqual(
    rows(section("Refused keys")).map(([key, variable]) => [key, variable]),
    Object.keys(REFUSED_OLLAMA_SETTINGS).map((key) => [
      key,
      `OLLAMA_${key.toUpperCase().replaceAll("-", "_")}`,
    ]),
  );
  for (const [key, why] of Object.entries(REFUSED_OLLAMA_SETTINGS)) {
    assert.ok(docs.includes(why.charAt(0).toUpperCase() + why.slice(1)), key);
  }
  assert.ok(section("Accepted keys").includes(`Ollama ${OLLAMA_VERSION}`));
  const dockerfile = readFileSync("docker/pod/Dockerfile", "utf8");
  assert.ok(dockerfile.includes(`FROM ollama/ollama:${OLLAMA_VERSION}@`), "the pod image's Ollama");
  assert.ok(
    existsSync(`docs/web/ollama/envconfig-config-go-at-v${OLLAMA_VERSION.replaceAll(".", "-")}.md`),
  );
});
