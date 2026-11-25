import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findCommand, listenEverywhere, providerTermination } from "./host.ts";

test("a pod that Runpod gave its ID and key asks Runpod to terminate it", async () => {
  const terminated: string[] = [];
  const keys: string[] = [];
  const terminate = providerTermination(
    { RUNPOD_POD_ID: "abc", RUNPOD_API_KEY: "pod-key" },
    (key) => {
      keys.push(key);
      return { pods: { terminate: async (id: string) => void terminated.push(id) } } as never;
    },
  );
  await terminate?.();
  assert.deepEqual(terminated, ["abc"]);
  assert.deepEqual(keys, ["pod-key"]);
});

test("a pod given no key by its provider has no way but to exit", () => {
  assert.equal(providerTermination({}), undefined);
  assert.equal(providerTermination({ RUNPOD_POD_ID: "abc" }), undefined);
});

test("the gateway listens on IPv6 and IPv4, or on IPv4 alone without IPv6", async () => {
  const hosts: string[] = [];
  assert.equal(await listenEverywhere(async (host) => hosts.push(host)), 1);
  assert.deepEqual(hosts, ["::"]);
  const fallback: string[] = [];
  await listenEverywhere(async (host) => {
    fallback.push(host);
    if (host === "::") throw Object.assign(new Error("no IPv6"), { code: "EAFNOSUPPORT" });
  });
  assert.deepEqual(fallback, ["::", "0.0.0.0"]);
  await assert.rejects(
    listenEverywhere(async () => {
      throw Object.assign(new Error("in use"), { code: "EADDRINUSE" });
    }),
    /in use/,
  );
});

test("the gateway finds its engine's command on the image's PATH, executable only", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeman-host-"));
  try {
    const [empty, bin] = [join(root, "empty"), join(root, "bin")];
    await Promise.all([mkdir(empty), mkdir(bin)]);
    await writeFile(join(bin, "ollama"), "#!/bin/sh\n");
    await chmod(join(bin, "ollama"), 0o755);
    await writeFile(join(bin, "vllm"), "not executable");
    const env = { PATH: `${empty}::${bin}` };
    assert.equal(await findCommand("ollama", env), join(bin, "ollama"));
    assert.equal(await findCommand("vllm", env), undefined, "not executable");
    assert.equal(await findCommand("ollama", {}), undefined, "no PATH");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
