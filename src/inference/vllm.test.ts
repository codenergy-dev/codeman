import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isHuggingFaceId,
  parseVllmSettings,
  REFUSED_VLLM_SETTINGS,
  VLLM_REASONING_PARSERS,
  VLLM_SETTINGS,
  VLLM_SPECULATIVE_METHODS,
  VLLM_TOOL_PARSERS,
  VLLM_VERSION,
  type VllmValue,
  vllmArguments,
  vllmBlockProblem,
  vllmSetting,
} from "./vllm.ts";

/** A page of docs/web/vllm/ at the pinned version. */
function recorded(path: string): string {
  const slug = `${path}-at-v${VLLM_VERSION}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return readFileSync(`docs/web/vllm/${slug}.md`, "utf8");
}

test("Hugging Face IDs are a namespace and a name", () => {
  for (const id of ["unsloth/Qwen3.8-27B-NVFP4", "Qwen/Qwen3-0.6B", "a/b", "org_x/m.v2"]) {
    assert.ok(isHuggingFaceId(id), id);
  }
  for (const id of [
    "Qwen3-0.6B",
    "a/b/c",
    "/b",
    "a/",
    "-a/b",
    "a/b.",
    "a--b/c",
    "a/b..c",
    "a b/c",
  ]) {
    assert.ok(!isHuggingFaceId(id), id);
  }
  assert.ok(!isHuggingFaceId(`a/${"b".repeat(97)}`));
});

test("each key is its argument in kebab-case, and no key is both accepted and refused", () => {
  for (const [key, { argument }] of Object.entries(VLLM_SETTINGS)) {
    if (key.startsWith("speculative-")) continue;
    assert.equal(argument, `--${key}`);
  }
  for (const key of Object.keys(REFUSED_VLLM_SETTINGS)) {
    assert.equal(VLLM_SETTINGS[key], undefined, key);
  }
});

test("the settings become vLLM's arguments, sorted, speculative decoding as its JSON", () => {
  assert.deepEqual(
    vllmArguments({
      "tool-call-parser": "qwen3_xml",
      "speculative-tokens": "03",
      "speculative-method": "mtp",
      "max-num-seqs": "4",
      "language-model-only": "true",
      "enable-prefix-caching": "false",
      "gpu-memory-utilization": "0.90",
    }),
    [
      "--enable-prefix-caching".replace("--", "--no-"),
      "--gpu-memory-utilization",
      "0.9",
      "--language-model-only",
      "--max-num-seqs",
      "4",
      "--tool-call-parser",
      "qwen3_xml",
      "--speculative-config",
      '{"method":"mtp","num_speculative_tokens":3}',
    ],
  );
  assert.deepEqual(
    vllmArguments({
      "speculative-method": "eagle3",
      "speculative-tokens": "2",
      "speculative-model": "org/drafter",
    }),
    [
      "--speculative-config",
      '{"method":"eagle3","num_speculative_tokens":2,"model":"org/drafter"}',
    ],
  );
  assert.deepEqual(vllmArguments(undefined), []);
  assert.throws(() => vllmArguments({ host: "0.0.0.0" }), /cannot set `host`/);
  assert.throws(() => vllmArguments({ "speculative-tokens": "3" }), /go with `speculative-method`/);
});

test("speculative decoding needs a method, its tokens, and a draft model only for those that use one", () => {
  assert.equal(vllmBlockProblem(undefined), undefined);
  assert.equal(
    vllmBlockProblem({ "speculative-method": "mtp", "speculative-tokens": "3" }),
    undefined,
  );
  assert.match(
    vllmBlockProblem({ "speculative-method": "mtp" }) ?? "",
    /needs `speculative-tokens`/,
  );
  assert.match(
    vllmBlockProblem({ "speculative-method": "draft_model", "speculative-tokens": "3" }) ?? "",
    /`speculative-method: draft_model` needs `speculative-model`/,
  );
  assert.match(
    vllmBlockProblem({
      "speculative-method": "ngram",
      "speculative-tokens": "3",
      "speculative-model": "a/b",
    }) ?? "",
    /takes no `speculative-model`/,
  );
  assert.match(vllmBlockProblem({ "speculative-model": "a/b" }) ?? "", /go with/);
});

test("values are checked and given as vLLM takes them", () => {
  assert.deepEqual(vllmSetting("max-model-len", "0131072"), { ok: true, value: "131072" });
  assert.deepEqual(vllmSetting("gpu-memory-utilization", "1"), { ok: true, value: "1" });
  assert.deepEqual(vllmSetting("gpu-memory-utilization", "1.0"), { ok: true, value: "1" });
  for (const text of ["0", "1.01", "-0.5", "0,9", "", "1e-1"]) {
    assert.equal(vllmSetting("gpu-memory-utilization", text).ok, false, text);
  }
  assert.equal(vllmSetting("max-model-len", "128k").ok, false, "whole numbers only");
  assert.equal(vllmSetting("max-model-len", "-1").ok, false, "Codeman fits it");
  assert.equal(vllmSetting("ssl-ciphers", "x").ok, false);
});

test("the gateway reads CODEMAN_VLLM: only the listed keys, with valid values that go together", () => {
  assert.deepEqual(parseVllmSettings(undefined), { ok: true, value: {} });
  assert.deepEqual(parseVllmSettings('{"max-num-seqs":"04","tool-call-parser":"hermes"}'), {
    ok: true,
    value: { "max-num-seqs": "4", "tool-call-parser": "hermes" },
  });
  assert.deepEqual(parseVllmSettings('{"host":"0.0.0.0"}'), {
    ok: false,
    error: "CODEMAN_VLLM sets `host`, which Codeman does not.",
  });
  assert.deepEqual(parseVllmSettings('{"max-num-seqs":4}'), {
    ok: false,
    error: "CODEMAN_VLLM sets `max-num-seqs`, which Codeman does not.",
  });
  assert.deepEqual(parseVllmSettings('{"max-num-seqs":"0"}'), {
    ok: false,
    error: "CODEMAN_VLLM: `vllm`'s `max-num-seqs` must be a whole number, at least 1.",
  });
  assert.match(
    (parseVllmSettings('{"speculative-method":"mtp"}') as { error: string }).error,
    /^CODEMAN_VLLM: `vllm`'s `speculative-method` needs/,
  );
  assert.equal(parseVllmSettings("[]").ok, false);
  assert.equal(parseVllmSettings("{").ok, false);
});

test("the parsers and methods are those of the recorded source of the pinned vLLM", () => {
  const names = (page: string, registry: string) =>
    [
      ...(page.split(`${registry} = {`)[1]?.split(/^}/m)[0] ?? "").matchAll(/^ {4}"([^"]+)": \(/gm),
    ].map((match) => match[1]);
  assert.deepEqual(
    names(recorded("vllm/tool_parsers/__init__.py"), "_TOOL_PARSERS_TO_REGISTER"),
    VLLM_TOOL_PARSERS,
  );
  assert.deepEqual(
    names(recorded("vllm/reasoning/__init__.py"), "_REASONING_PARSERS_TO_REGISTER"),
    VLLM_REASONING_PARSERS,
  );
  const methods = recorded("vllm/config/speculative.py").split("## Methods\n")[1] ?? "";
  for (const method of VLLM_SPECULATIVE_METHODS)
    assert.ok(methods.includes(`\`${method}\``), method);
  assert.ok(!VLLM_SPECULATIVE_METHODS.includes("custom_class"), "it loads code");
  const cache = recorded("vllm/config/cache.py");
  const dtypes = cache.split("CacheDType = Literal[")[1]?.split("]")[0] ?? "";
  const kvCache = VLLM_SETTINGS["kv-cache-dtype"]?.value;
  assert.ok(kvCache?.kind === "choice");
  for (const dtype of kvCache.values) assert.ok(dtypes.includes(`"${dtype}"`), dtype);
  const server = recorded("vllm/entrypoints/launchers/cli_args.py");
  for (const key of [
    "host",
    "port",
    "uds",
    "api-key",
    "allowed-origins",
    "root-path",
    "middleware",
  ]) {
    assert.ok(server.includes(`    ${key.replaceAll("-", "_")}:`), key);
  }
});

test("the docs list the accepted and refused keys of the code, for the pod image's vLLM", () => {
  const docs = readFileSync("docs/settings/vllm.md", "utf8");
  const section = (heading: string) => docs.split(`## ${heading}\n`)[1]?.split(/^## /m)[0] ?? "";
  const rows = [
    ...section("Accepted keys").matchAll(/^\| `([a-z-]+)` \| `([a-z-]+)` \| ([^|]+) \|/gm),
  ].map((match) => [match[1], match[2], (match[3] ?? "").trim()]);
  const parsers: Record<string, string> = {
    "tool-call-parser": `One of vLLM ${VLLM_VERSION}'s tool call parsers`,
    "reasoning-parser": `One of vLLM ${VLLM_VERSION}'s reasoning parsers`,
  };
  const described = (key: string, value: VllmValue) => {
    switch (value.kind) {
      case "count":
        return `Whole number, at least ${value.min}`;
      case "fraction":
        return "Number above 0, at most 1";
      case "boolean":
        return "`true` or `false`";
      case "model":
        return "A Hugging Face model ID";
      case "choice":
        return (
          parsers[key] ??
          `${value.values
            .slice(0, -1)
            .map((v) => `\`${v}\``)
            .join(", ")} or \`${value.values.at(-1)}\``
        );
    }
  };
  assert.deepEqual(
    rows,
    Object.entries(VLLM_SETTINGS).map(([key, { argument, value }]) => [
      key,
      argument.startsWith("--") ? argument : "--speculative-config",
      described(key, value),
    ]),
  );
  const refused = section("Refused keys");
  const listed = [...refused.matchAll(/^\| ([^|]+) \| ([^|]+) \|/gm)].slice(2);
  const keys = listed.flatMap((match) =>
    [...(match[1] ?? "").matchAll(/`([a-z-]+)`/g)].map((key) => key[1]),
  );
  assert.deepEqual(keys.sort(), Object.keys(REFUSED_VLLM_SETTINGS).sort());
  for (const [key, why] of Object.entries(REFUSED_VLLM_SETTINGS)) {
    const row = listed.find((match) => match[1]?.includes(`\`${key}\``));
    assert.equal(row?.[2]?.trim(), why.charAt(0).toUpperCase() + why.slice(1), key);
  }
  assert.ok(section("Accepted keys").includes(`vLLM ${VLLM_VERSION}`));
});
