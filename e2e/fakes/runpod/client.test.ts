import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import { RunpodQueue } from "../../../src/gateway/queue.ts";
import { waitUntilReady } from "../../../src/inference/gpu.ts";
import { Runpod } from "../../../src/inference/runpod.ts";
import { MemoryLauncher } from "./memory-launcher.ts";
import { RunpodFake } from "./runpod.ts";

/**
 * Codeman's own Runpod client against the fake, as the e2e build wires it: `redirects` swaps
 * Runpod's origins for the fake's, and `gpu` points pods' URLs at the fake's proxy.
 */

const KEY = "rpa_e2e";
const launcher = new MemoryLauncher();
const runpod = new RunpodFake(
  {
    keys: [KEY],
    endpoints: [
      {
        id: "vllm1",
        workers: { min: 0, max: 1, idleTimeout: 5 },
        gpu: { pools: ["AMPERE_48", "ADA_24"], count: 1 },
        env: { MODEL_NAME: "Qwen/Qwen2.5-0.5B-Instruct" },
      },
    ],
  },
  { launcher },
);
let client: Runpod;
before(async () => {
  const origin = await runpod.server.listen();
  const e2e = redirects({
    CODEMAN_E2E_ENDPOINTS: JSON.stringify({
      runpod: origin,
      runpodServerless: origin,
      runpodPods: `${origin}/pods/{id}/{port}`,
    }),
  });
  client = e2e.gpu(new Runpod(KEY, e2e.fetch));
});
after(async () => {
  await launcher.close();
  await runpod.server.close();
});

test("Codeman's client creates, finds, reaches and terminates a pod on the fake", async () => {
  const pods = client.pods;
  assert.ok(pods);
  assert.equal(await pods.price("NVIDIA RTX A6000"), 0.49 / 3600);
  assert.equal(await pods.memory?.("NVIDIA RTX A6000"), 48);
  assert.deepEqual(await pods.cudaVersions?.("NVIDIA RTX A6000", "13.0"), [
    { version: "13.0", available: true },
  ]);
  await assert.rejects(pods.price("RTX A6000"), /has no GPU type "RTX A6000"/);

  const env = { CODEMAN_NONCE: "n1", CODEMAN_POOL: "acme", CODEMAN_ADMIN_SHA256: "ab".repeat(32) };
  const created = await pods.create({
    name: "codeman-acme-settings",
    image: "ghcr.io/codenergy-dev/codeman-pod@sha256:1234",
    env,
    port: 8000,
    gpuType: "NVIDIA RTX A6000",
    diskGb: 40,
    minCudaVersion: "13.0",
  });
  assert.equal(created.status, "starting");
  assert.deepEqual(launcher.launched.at(-1)?.env, env);

  const url = pods.url(created.id, 8000);
  const ready = await waitUntilReady(
    pods,
    created.id,
    async () => (await fetch(`${url}/health`)).ok,
    { timeoutMs: 1000, intervalMs: 5 },
  );
  assert.equal(ready.status, "running");
  assert.equal(ready.cudaVersion, "13.0");
  assert.equal(ready.pricePerSecond, 0.49 / 3600);
  assert.deepEqual(
    (await pods.list({ CODEMAN_NONCE: "n1" })).map((pod) => pod.id),
    [created.id],
  );
  assert.deepEqual(await pods.list({ CODEMAN_NONCE: "other" }), []);

  await pods.terminate(created.id);
  assert.equal(await pods.get(created.id), undefined);
  await pods.terminate(created.id);
  const billed = await pods.billing([created.id], new Date(Date.now() - 60_000));
  assert.ok((billed[created.id] ?? 0) > 0);
  const hours = await client.billedHours(new Date(Date.now() - 3600_000), new Date());
  assert.ok([...hours.values()].reduce((sum, amount) => sum + amount, 0) > 0);
});

test("Codeman's queue runs a Serverless job on the fake's endpoint", async () => {
  const serverless = client.serverless;
  assert.ok(serverless);
  const endpoint = await serverless.endpoint("vllm1");
  assert.deepEqual(
    { ...endpoint, env: undefined },
    {
      id: "vllm1",
      type: "QUEUE",
      workersMin: 0,
      workersMax: 1,
      idleTimeoutSeconds: 5,
      gpuCount: 1,
      env: undefined,
    },
  );
  assert.equal(await serverless.price("vllm1"), 1.22 / 3600);

  const queue = new RunpodQueue(serverless.queueUrl("vllm1"), KEY, { pollMs: 5 });
  assert.equal(await queue.workers(new AbortController().signal), "none");
  const response = await queue.send({
    method: "POST",
    path: "/v1/chat/completions",
    body: JSON.stringify({
      model: "Qwen/Qwen2.5-0.5B-Instruct",
      stream: true,
      messages: [{ role: "user", content: "hello there" }],
    }),
    signal: new AbortController().signal,
  });
  assert.equal(response.status, 200);
  assert.equal(response.contentType, "text/event-stream");
  let text = "";
  for await (const chunk of response.body) text += chunk;
  assert.match(text, /"content":"echo: hello there"/);
  assert.match(text, /"usage":\{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5\}/);
  assert.ok(text.endsWith("data: [DONE]\n\n"));
  assert.equal(await queue.workers(new AbortController().signal), "running");
  await queue.settle();
});
