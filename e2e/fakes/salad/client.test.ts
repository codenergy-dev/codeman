import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import { waitUntilReady } from "../../../src/inference/gpu.ts";
import { Salad } from "../../../src/inference/salad.ts";
import { MemoryLauncher } from "../runpod/memory-launcher.ts";
import { SaladFake } from "./salad.ts";

/**
 * Codeman's own Salad client against the fake, as the e2e build wires it: `redirects` swaps
 * Salad's origin for the fake's, and `gpu` points pods' URLs at the fake's Container Gateway.
 */

const KEY = "salad_e2e";
const ACCOUNT = { key: KEY, organization: "acme", project: "codeman" };
const launcher = new MemoryLauncher();
const salad = new SaladFake(
  { keys: [KEY], organization: ACCOUNT.organization, project: ACCOUNT.project },
  { launcher },
);
let origin: string;
let client: Salad;
before(async () => {
  origin = await salad.server.listen();
  const e2e = redirects({
    CODEMAN_E2E_ENDPOINTS: JSON.stringify({
      salad: origin,
      saladPods: `${origin}/pods/{id}/{port}`,
    }),
  });
  client = e2e.gpu(new Salad(ACCOUNT, e2e.fetch));
});
after(async () => {
  await launcher.close();
  await salad.server.close();
});

const spec = (env: Record<string, string>) => ({
  name: "codeman-acme-settings",
  image: "ghcr.io/codenergy-dev/codeman-ollama@sha256:abc",
  env,
  port: 8080,
  gpuType: "RTX 4090 (24 GB)",
  diskGb: 40,
  hosts: ["community" as const],
  priority: "high",
});

test("Codeman's client creates, finds, reaches and deletes a group on the fake", async () => {
  const pods = client.pods;
  assert.equal(await pods.price("RTX 4090 (24 GB)", "community"), 0.44 / 3600);
  assert.equal(await pods.price("RTX 4090 (24 GB)", "community", "batch"), 0.16 / 3600);
  assert.equal(await pods.memory?.("RTX 4090 (24 GB)"), 24);
  await assert.rejects(pods.price("RTX 4090 (24 GB)", "secure"), /community hosts/);
  await assert.rejects(pods.price("RTX 4090"), /no GPU class "RTX 4090"/);

  const env = { CODEMAN_NONCE: "n1", CODEMAN_POOL: "acme", CODEMAN_ADMIN_SHA256: "ab".repeat(32) };
  const created = await pods.create(spec(env));
  assert.match(created.id, /^codeman-[0-9a-f]{16}$/);
  assert.equal(created.host, "community");
  assert.equal(created.pricePerSecond, 0.44 / 3600);

  const ready = await waitUntilReady(
    pods,
    created.id,
    async () => (await fetch(`${await pods.url(created.id, 8080)}/health`)).ok,
    { timeoutMs: 5_000, intervalMs: 20, wait: (ms) => new Promise((r) => setTimeout(r, ms)) },
  );
  assert.equal(ready.status, "running");
  assert.equal(ready.gpuType, "RTX 4090 (24 GB)");
  const echoed = await fetch(`${await pods.url(created.id, 8080)}/env`);
  assert.deepEqual(await echoed.json(), env);

  const [group] = salad.groups();
  assert.equal(group?.restartPolicy, "never");
  assert.equal(group?.priority, "high");
  assert.equal(group?.replicas, 1);
  assert.deepEqual(group?.networking, {
    protocol: "http",
    port: 8080,
    auth: false,
    load_balancer: "least_number_of_connections",
    single_connection_limit: false,
    client_request_timeout: 100_000,
    server_response_timeout: 100_000,
  });
  assert.equal(launcher.launched.at(-1)?.cloud, "COMMUNITY");

  assert.deepEqual(
    (await pods.list({ CODEMAN_POOL: "acme" })).map((pod) => pod.id),
    [created.id],
  );
  assert.deepEqual(await pods.list({ CODEMAN_POOL: "other" }), []);

  await pods.terminate(created.id);
  assert.equal(await pods.get(created.id), undefined);
  assert.deepEqual(await pods.list({}), []);
  // A group already gone is not an error.
  await pods.terminate(created.id);
  assert.deepEqual(launcher.terminated, [created.id]);
  assert.equal(salad.groups()[0]?.deleted, true);
});

test("the fake refuses a wrong key, organization or project", async () => {
  const fetchJson = (path: string, key = KEY) =>
    fetch(`${origin}/api/public${path}`, { headers: { "Salad-Api-Key": key } });
  assert.equal((await fetchJson("/organizations/acme/gpu-classes", "wrong")).status, 401);
  assert.equal((await fetchJson("/organizations/other/gpu-classes")).status, 404);
  assert.equal((await fetchJson("/organizations/acme/projects/other/containers")).status, 404);
  const other = new Salad({ ...ACCOUNT, project: "other" }, redirectTo(origin));
  await assert.rejects(other.pods.list({}), /failed with 404: Not Found — project not found/);
});

test("the Container Gateway answers 404 for a group that does not run", async () => {
  const answer = await fetch(`${origin}/pods/codeman-0000000000000000/8080/health`);
  assert.equal(answer.status, 404);
});

function redirectTo(target: string): typeof fetch {
  return redirects({ CODEMAN_E2E_ENDPOINTS: JSON.stringify({ salad: target }) })
    .fetch as typeof fetch;
}
