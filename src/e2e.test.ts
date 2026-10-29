import assert from "node:assert/strict";
import { test } from "node:test";
import { E2E, redirects } from "./e2e.ts";
import { Runpod } from "./inference/runpod.ts";
import { Salad } from "./inference/salad.ts";

const env = (endpoints: unknown) => ({ CODEMAN_E2E_ENDPOINTS: JSON.stringify(endpoints) });

function recording(): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, urls };
}

test("the sources, built without the e2e flag, redirect nothing", async () => {
  assert.equal(E2E, undefined);
  process.env.CODEMAN_E2E_ENDPOINTS = JSON.stringify({ runpod: "http://fake:1" });
  try {
    // A new instance of the module, evaluated with the variable set.
    const fresh = await import(new URL("./e2e.ts?with-variable", import.meta.url).href);
    assert.equal(fresh.E2E, undefined);
  } finally {
    delete process.env.CODEMAN_E2E_ENDPOINTS;
  }
});

test("fetch sends the overridden services' requests to their fakes, and no other", async () => {
  const { fetch: fetchFn, urls } = recording();
  const { fetch: redirected } = redirects(
    env({ openRouter: "http://openrouter:8080", firestore: "https://firestore.test:8443" }),
    fetchFn,
  );
  await redirected("https://openrouter.ai/api/v1/keys?include_disabled=true");
  await redirected(new URL("https://firestore.googleapis.com/v1/projects/p/databases/(default)"));
  await redirected("https://huggingface.co/api/models/a/b");
  await redirected("http://pod-8000.local/health");
  assert.deepEqual(urls, [
    "http://openrouter:8080/api/v1/keys?include_disabled=true",
    "https://firestore.test:8443/v1/projects/p/databases/(default)",
    "https://huggingface.co/api/models/a/b",
    "http://pod-8000.local/health",
  ]);
});

test("Runpod's API, pods and Serverless queues go to the fakes", async () => {
  const { fetch: fetchFn, urls } = recording();
  const e2e = redirects(
    env({
      runpod: "http://runpod:9000",
      runpodServerless: "http://runpod:9001",
      runpodPods: "http://runpod:9002/pods/{id}-{port}",
    }),
    fetchFn,
  );
  const runpod = e2e.gpu(new Runpod("key", e2e.fetch));
  await runpod.pods.get("abc");
  assert.deepEqual(urls, ["http://runpod:9000/v2/pods/abc"]);
  assert.equal(await runpod.pods.url("abc", 8000), "http://runpod:9002/pods/abc-8000");
  assert.equal(runpod.serverless.queueUrl("e1"), "http://runpod:9001/v2/e1");
});

test("Salad's API and Container Gateway go to the fakes, and its pods take the local images", async () => {
  const { fetch: fetchFn, urls } = recording();
  const e2e = redirects(
    env({
      salad: "http://salad:9000",
      runpodPods: "http://runpod:9002/pods/{id}/{port}",
      saladPods: "http://salad:9000/pods/{id}/{port}",
    }),
    fetchFn,
  );
  const salad = e2e.gpu(new Salad({ key: "key", organization: "o", project: "p" }, e2e.fetch));
  await salad.pods.get("codeman-1");
  assert.deepEqual(urls, [
    "http://salad:9000/api/public/organizations/o/projects/p/containers/codeman-1",
  ]);
  assert.equal(await salad.pods.url("codeman-1", 8080), "http://salad:9000/pods/codeman-1/8080");
  assert.equal(salad.pods.unservedImages, undefined);
});

test("without an override, a service keeps its production URL", async () => {
  const e2e = redirects(env({ runpod: "http://runpod:9000" }));
  const runpod = e2e.gpu(new Runpod("key", e2e.fetch));
  assert.equal(await runpod.pods.url("abc", 8000), "https://abc-8000.proxy.runpod.net");
  assert.equal(runpod.serverless.queueUrl("e1"), "https://api.runpod.ai/v2/e1");
});

test("the variable must be a JSON object of known keys and URLs", () => {
  const invalid: [Record<string, string | undefined>, RegExp][] = [
    [{}, /needs CODEMAN_E2E_ENDPOINTS/],
    [{ CODEMAN_E2E_ENDPOINTS: "{" }, /is not JSON/],
    [{ CODEMAN_E2E_ENDPOINTS: "[]" }, /must be an object/],
    [env({ github: "http://fake:1" }), /unknown endpoint "github"/],
    [env({ runpod: 9000 }), /runpod must be an http\(s\) origin/],
    [env({ runpod: "runpod:9000" }), /runpod must be an http\(s\) origin/],
    [env({ runpod: "ftp://runpod:9000" }), /runpod must be an http\(s\) origin/],
    [env({ runpod: "http://runpod:9000/" }), /runpod must be an http\(s\) origin/],
    [env({ runpod: "http://runpod:9000/v2" }), /runpod must be an http\(s\) origin/],
    [env({ runpod: "http://user:secret@runpod:9000" }), /runpod must be an http\(s\) origin/],
    [env({ runpodPods: "http://runpod:9002/pods/{id}" }), /runpodPods must be/],
    [env({ runpodPods: "http://runpod:9002/{id}-{port}/" }), /runpodPods must be/],
    [env({ runpodPods: "http://runpod:9002/{id}-{port}?a=b" }), /runpodPods must be/],
    [env({ runpodPods: "file:///{id}-{port}" }), /runpodPods must be/],
    [env({ saladPods: "http://salad:9000/pods/{id}" }), /saladPods must be/],
  ];
  for (const [variables, error] of invalid) {
    assert.throws(() => redirects(variables), error, JSON.stringify(variables));
  }
  assert.deepEqual(redirects(env({})).endpoints, {});
});
