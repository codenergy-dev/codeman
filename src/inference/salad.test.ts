import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fetch } from "../budget.ts";
import { memoryGb, Salad } from "./salad.ts";

function near(actual: number | undefined, expected: number): void {
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-12, `${actual} ≉ ${expected}`);
}

function fakeFetch(responses: (unknown | Response)[]): {
  fetch: Fetch;
  calls: [string, RequestInit][];
} {
  const calls: [string, RequestInit][] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const body = responses.shift();
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as Fetch;
  return { fetch: fetchFn, calls };
}

const ACCOUNT = { key: "sk", organization: "acme", project: "codeman" };
const BASE = "https://api.salad.com/api/public/organizations/acme";
const CONTAINERS = `${BASE}/projects/codeman/containers`;

const classes = {
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "RTX 4090 (24 GB)",
      gpu_class_type: "community",
      prices: [
        { priority: "high", price: "0.440" },
        { priority: "medium", price: "0.347" },
        { priority: "low", price: "0.253" },
        { priority: "batch", price: "0.160" },
      ],
      min_vcpu: 1,
      max_vcpu: 16,
      min_ram: 1024,
      max_ram: 30720,
      max_storage: 268435456000,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "RTX PRO 6000 (96 GB)",
      gpu_class_type: "secure",
      prices: [{ priority: "high", price: "1.80" }],
    },
  ],
};

const group = {
  name: "codeman-0123456789abcdef",
  display_name: "codeman-acme-s",
  create_time: "2026-10-29T12:00:00Z",
  priority: "high",
  container: {
    image: "ghcr.io/x/pod@sha256:1",
    environment_variables: { CODEMAN_ORGANIZATION: "acme", CODEMAN_POD_SETTINGS: "s" },
    resources: { gpu_classes: ["11111111-1111-4111-8111-111111111111"] },
  },
  current_state: { status: "deploying", instance_status_counts: { running_count: 0 } },
  networking: { dns: "codeman-0123-abcd.salad.cloud" },
};

const spec = {
  name: "codeman-acme-s",
  image: "ghcr.io/x/pod@sha256:1",
  env: { CODEMAN_POD_SETTINGS: "s", CODEMAN_POOL: "" },
  port: 8080,
  gpuType: "RTX 4090 (24 GB)",
  diskGb: 80,
  hosts: ["community"] as const,
};

test("needs the organization and the project beside the key", () => {
  assert.throws(() => new Salad({ key: "sk" }), /CODEMAN_SALAD_ORGANIZATION/);
});

test("creates a group of one replica that never restarts, behind an open Container Gateway", async () => {
  const { fetch, calls } = fakeFetch([classes, group]);
  const created = await new Salad(ACCOUNT, fetch).pods.create(spec);
  const [listUrl, listInit] = calls[0] ?? [];
  assert.equal(listUrl, `${BASE}/gpu-classes`);
  assert.equal(new Headers(listInit?.headers).get("salad-api-key"), "sk");
  const [url, init] = calls[1] ?? [];
  assert.equal(url, CONTAINERS);
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("salad-api-key"), "sk");
  const body = JSON.parse(String(init?.body));
  assert.match(body.name, /^codeman-[0-9a-f]{16}$/);
  assert.deepEqual(
    { ...body, name: undefined },
    {
      name: undefined,
      display_name: "codeman-acme-s",
      container: {
        image: "ghcr.io/x/pod@sha256:1",
        // An empty value is left out: Salad takes values of 1 character or more.
        environment_variables: { CODEMAN_POD_SETTINGS: "s" },
        priority: "high",
        resources: {
          cpu: 8,
          // The class allows 30 GB at most.
          memory: 30720,
          gpu_classes: ["11111111-1111-4111-8111-111111111111"],
          storage_amount: 80 * 1024 ** 3,
        },
      },
      replicas: 1,
      restart_policy: "never",
      autostart_policy: true,
      networking: {
        protocol: "http",
        port: 8080,
        auth: false,
        load_balancer: "least_number_of_connections",
        single_connection_limit: false,
        client_request_timeout: 100000,
        server_response_timeout: 100000,
      },
    },
  );
  assert.equal(created.id, "codeman-0123456789abcdef");
  assert.equal(created.status, "starting");
  assert.equal(created.gpuType, "RTX 4090 (24 GB)");
  assert.equal(created.host, "community");
  near(created.pricePerSecond, 0.44 / 3600);
  assert.equal(created.createdAt.toISOString(), "2026-10-29T12:00:00.000Z");
});

test("creates at the settings' priority, with the shared memory vLLM asks for", async () => {
  const { fetch, calls } = fakeFetch([classes, { ...group, priority: "batch" }]);
  const created = await new Salad(ACCOUNT, fetch).pods.create({
    ...spec,
    priority: "batch",
    sharedMemoryGb: 8,
  });
  const body = JSON.parse(String(calls[1]?.[1]?.body));
  assert.equal(body.container.priority, "batch");
  assert.equal(body.container.resources.shm_size, 8192);
  near(created.pricePerSecond, 0.16 / 3600);
});

test("refuses a class on hosts that `hosts` does not allow, before creating anything", async () => {
  const { fetch, calls } = fakeFetch([classes]);
  await assert.rejects(
    new Salad(ACCOUNT, fetch).pods.create({ ...spec, hosts: undefined }),
    /runs on community hosts.*add `community` to `hosts`/,
  );
  assert.equal(calls.length, 1);
});

test("refuses an unknown class, priority or a disk beyond Salad's", async () => {
  const salad = new Salad(ACCOUNT, fakeFetch([classes]).fetch);
  await assert.rejects(
    salad.pods.create({ ...spec, gpuType: "RTX 9999" }),
    /no GPU class "RTX 9999"/,
  );
  await assert.rejects(
    salad.pods.create({ ...spec, priority: "on-demand" }),
    /no priority `on-demand`/,
  );
  await assert.rejects(salad.pods.create({ ...spec, diskGb: 300 }), /250 GB of disk at most/);
});

test("prices a class by name, ignoring case, per host kind and priority, reading classes once", async () => {
  const { fetch, calls } = fakeFetch([classes]);
  const salad = new Salad(ACCOUNT, fetch);
  near(await salad.pods.price("rtx 4090 (24 gb)", "community"), 0.44 / 3600);
  near(await salad.pods.price("RTX 4090 (24 GB)", "community", "low"), 0.253 / 3600);
  near(await salad.pods.price("RTX PRO 6000 (96 GB)"), 1.8 / 3600);
  await assert.rejects(salad.pods.price("RTX 4090 (24 GB)"), /runs on community hosts/);
  await assert.rejects(salad.pods.price("RTX PRO 6000 (96 GB)", "secure", "batch"), /no price/);
  assert.equal(calls.length, 1);
});

test("a failed read of the classes is read again", async () => {
  const { fetch, calls } = fakeFetch([new Response("", { status: 503 }), classes]);
  const salad = new Salad(ACCOUNT, fetch);
  await assert.rejects(salad.pods.price("RTX 4090 (24 GB)", "community"), /failed with 503/);
  near(await salad.pods.price("RTX 4090 (24 GB)", "community"), 0.44 / 3600);
  assert.equal(calls.length, 2);
});

test("reads a GPU's memory from its class's name", async () => {
  const salad = new Salad(ACCOUNT, fakeFetch([classes]).fetch);
  assert.equal(await salad.pods.memory?.("RTX 4090 (24 GB)"), 24);
  assert.equal(memoryGb("RTX 5090 Laptop (24 GB)"), 24);
  assert.equal(memoryGb("Some GPU"), undefined);
});

test("maps a group's states, running only with a running instance", async () => {
  const states: [string, number, string][] = [
    ["pending", 0, "starting"],
    ["deploying", 0, "starting"],
    ["running", 0, "starting"],
    ["running", 1, "running"],
    ["stopped", 0, "stopped"],
    ["succeeded", 0, "stopped"],
    ["failed", 0, "failed"],
    ["something-new", 0, "starting"],
  ];
  const { fetch } = fakeFetch(
    states.flatMap(([status, running, expected], index) => [
      { ...group, current_state: { status, instance_status_counts: { running_count: running } } },
      // The classes once, then a starting group's instances, which say whether a node holds it.
      ...(index === 0 ? [classes] : []),
      ...(expected === "starting" ? [{ instances: [] }] : []),
    ]),
  );
  const salad = new Salad(ACCOUNT, fetch);
  for (const [status, running, expected] of states) {
    assert.equal((await salad.pods.get(group.name))?.status, expected, `${status}, ${running}`);
  }
});

test("a starting group is allocated once a node downloads, creates or runs its instance", async () => {
  const starting = { ...group, current_state: { status: "deploying" } };
  const instances = (state: string) => ({ instances: [{ state }] });
  const { fetch, calls } = fakeFetch([
    starting,
    classes,
    instances("allocating"),
    starting,
    instances("downloading"),
    starting,
    new Response("", { status: 404 }),
    {
      ...group,
      current_state: { status: "running", instance_status_counts: { running_count: 1 } },
    },
  ]);
  const salad = new Salad(ACCOUNT, fetch);
  assert.equal((await salad.pods.get(group.name))?.allocated, false);
  assert.equal(calls[2]?.[0], `${CONTAINERS}/${group.name}/instances`);
  assert.equal((await salad.pods.get(group.name))?.allocated, true);
  assert.equal((await salad.pods.get(group.name))?.allocated, undefined, "not listed");
  const running = await salad.pods.get(group.name);
  assert.deepEqual([running?.status, running?.allocated], ["running", undefined]);
  assert.equal(calls.length, 8, "a running group's instances are not read");
});

test("a deleted group is gone, and deleting it again is not an error", async () => {
  const { fetch, calls } = fakeFetch([
    new Response("", { status: 404 }),
    new Response("", { status: 202 }),
    new Response("", { status: 404 }),
  ]);
  const salad = new Salad(ACCOUNT, fetch);
  assert.equal(await salad.pods.get(group.name), undefined);
  await salad.pods.terminate(group.name);
  await salad.pods.terminate(group.name);
  assert.equal(calls[1]?.[0], `${CONTAINERS}/${group.name}`);
  assert.equal(calls[1]?.[1]?.method, "DELETE");
});

test("the gateway's address is the group's DNS name, once Salad gives one", async () => {
  const { fetch } = fakeFetch([
    { ...group, networking: null },
    group,
    { ...group, networking: { dns: "https://already.salad.cloud" } },
  ]);
  const salad = new Salad(ACCOUNT, fetch);
  await assert.rejects(salad.pods.url(group.name, 8080), /no address/);
  assert.equal(await salad.pods.url(group.name, 8080), "https://codeman-0123-abcd.salad.cloud");
  assert.equal(await salad.pods.url(group.name, 8080), "https://already.salad.cloud");
});

test("lists the project's groups whose environment matches", async () => {
  const other = {
    ...group,
    name: "someone-else",
    container: { ...group.container, environment_variables: { APP: "x" } },
  };
  const { fetch, calls } = fakeFetch([{ items: [group, other] }, classes]);
  const pods = await new Salad(ACCOUNT, fetch).pods.list({ CODEMAN_ORGANIZATION: "acme" });
  assert.equal(calls[0]?.[0], CONTAINERS);
  assert.deepEqual(
    pods.map(({ id }) => id),
    [group.name],
  );
});

test("errors say what Salad's problem details say, never an HTML page nor the key", async () => {
  const problem = new Response(
    JSON.stringify({ type: "x", title: "Bad Request", detail: "The image is not valid." }),
    { status: 400 },
  );
  const page = new Response("<html><body>sk Gateway error</body></html>", { status: 502 });
  const salad = new Salad(ACCOUNT, fakeFetch([classes, problem, page]).fetch);
  await assert.rejects(
    salad.pods.create(spec),
    (error: Error) =>
      /failed with 400: Bad Request — The image is not valid\./.test(error.message) &&
      !error.message.includes("sk"),
  );
  await assert.rejects(
    salad.pods.get(group.name),
    (error: Error) => error.message.endsWith("failed with 502.") && !error.message.includes("html"),
  );
});

test("refuses an environment value longer than Salad takes", async () => {
  const salad = new Salad(ACCOUNT, fakeFetch([classes]).fetch);
  await assert.rejects(
    salad.pods.create({ ...spec, env: { CODEMAN_FIT: "x".repeat(1001) } }),
    /CODEMAN_FIT has 1001/,
  );
});
