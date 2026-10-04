import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { expiry, type PodPolicy, podSettings, prepareOllama } from "./pod.ts";

const policy: PodPolicy = { startBy: 1_000_000, keptIdleMs: 900_000, runIdleMs: 1_800_000 };

test("a pod that never served terminates at its start limit", () => {
  const state = { ready: false, serving: false, deadline: undefined, lastActivity: 0 };
  assert.equal(expiry(state, policy, 999_999), undefined);
  assert.match(expiry(state, policy, 1_000_000) ?? "", /not served in time/);
});

test("a run's pod terminates at the run's deadline, or when its agent goes silent", () => {
  const serving = { ready: true, serving: true, deadline: 5_000_000, lastActivity: 4_000_000 };
  assert.equal(expiry(serving, policy, 4_999_999), undefined);
  assert.match(expiry(serving, policy, 5_000_000) ?? "", /budget is spent/);
  const silent = { ...serving, deadline: 99_000_000 };
  assert.equal(expiry(silent, policy, 4_000_000 + 1_799_999), undefined);
  assert.match(expiry(silent, policy, 4_000_000 + 1_800_000) ?? "", /no request/);
});

test("a kept pod waits for its task's next run up to its idle limit", () => {
  const kept = { ready: true, serving: false, deadline: undefined, lastActivity: 2_000_000 };
  assert.equal(expiry(kept, policy, 2_899_999), undefined);
  assert.match(expiry(kept, policy, 2_900_000) ?? "", /no run came/);
});

test("reads the pod's settings from its environment", () => {
  const settings = podSettings({
    CODEMAN_MODEL: "qwen3-coder:30b",
    CODEMAN_ADMIN_SHA256: "a".repeat(64),
    CODEMAN_START_BY: "2026-10-03T12:25:00Z",
    CODEMAN_KEPT_IDLE_MINUTES: "15",
    RUNPOD_POD_ID: "abc",
    RUNPOD_API_KEY: "pod-key",
  });
  assert.equal(settings.policy.startBy, Date.parse("2026-10-03T12:25:00Z"));
  assert.equal(settings.policy.keptIdleMs, 900_000);
  assert.equal(settings.policy.runIdleMs, 1_800_000);
  assert.equal(settings.podId, "abc");
  assert.throws(() => podSettings({ CODEMAN_MODEL: "m" }), /required/);
});

test("pulls the model, restarts Ollama with its context length and loads it", async () => {
  const calls: string[] = [];
  const server: Server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push(`${request.method} ${request.url} ${body}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url === "/api/pull") {
      response.write('{"status":"pulling manifest"}\n{"status":"downloading","completed":5}\n');
      response.end('{"status":"success"}\n');
      return;
    }
    response.end(
      request.url === "/api/show"
        ? JSON.stringify({ model_info: { "qwen3moe.context_length": 262144 } })
        : "{}",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const restarts: (number | undefined)[] = [];
  const contextLength = await prepareOllama(
    { url, restart: async (length) => void restarts.push(length) },
    "qwen3-coder:30b",
    () => undefined,
  );
  server.close();
  assert.equal(contextLength, 262144);
  assert.deepEqual(restarts, [262144]);
  assert.deepEqual(
    calls.map((call) => call.split(" ").slice(0, 2).join(" ")),
    [
      "GET /api/version",
      "POST /api/pull",
      "POST /api/show",
      "GET /api/version",
      "POST /api/generate",
    ],
  );
  assert.match(calls[1] ?? "", /"model":"qwen3-coder:30b","stream":true/);
  assert.match(calls[4] ?? "", /"keep_alive":-1/);
});

test("a pull that reports an error stops the pod's start", async () => {
  const server: Server = createServer((request, response) => {
    response.writeHead(200);
    response.end(
      request.url === "/api/pull" ? '{"error":"pull model manifest: file does not exist"}\n' : "{}",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await assert.rejects(
    prepareOllama({ url, restart: async () => undefined }, "nope", () => undefined),
    /could not pull nope: pull model manifest/,
  );
  server.close();
});
