import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { FakeServer, HttpError, json } from "./http.ts";

const fake = new FakeServer("test");
fake.route("GET", "/repos/{owner}/{repo}", (request) => json(request.params));
fake.route("GET", "/repos/{owner}/{repo}/git/refs/{ref*}", (request) => json(request.params));
fake.route("POST", "/v1/accounts/{account}:token", (request) =>
  json({ account: request.params.account, body: request.json(), bearer: request.bearer }, 201),
);
fake.route("GET", "/teapot", () => {
  throw new HttpError(418, { message: "I'm a teapot." });
});
fake.route("GET", "/stream", (_request, response) => {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end("data: 1\n\n");
  return undefined;
});
let origin = "";
before(async () => {
  origin = await fake.listen({ controlToken: "control" });
});
after(() => fake.close());

const control = (method: string, path: string, body?: unknown) =>
  fetch(`${origin}/_fake${path}`, {
    method,
    headers: { authorization: "Bearer control" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("routes by method and path, with each part decoded", async () => {
  fake.reset();
  assert.deepEqual(await (await fetch(`${origin}/repos/acme/app`)).json(), {
    owner: "acme",
    repo: "app",
  });
  assert.deepEqual(await (await fetch(`${origin}/repos/acme/app/git/refs/heads/a%2Fb`)).json(), {
    owner: "acme",
    repo: "app",
    ref: "heads/a/b",
  });
  const posted = await fetch(`${origin}/v1/accounts/a%40b.test:token`, {
    method: "POST",
    headers: { authorization: "Bearer t1" },
    body: JSON.stringify({ scope: ["s"] }),
  });
  assert.equal(posted.status, 201);
  assert.deepEqual(await posted.json(), {
    account: "a@b.test",
    body: { scope: ["s"] },
    bearer: "t1",
  });
  assert.equal((await fetch(`${origin}/repos/acme/app`, { method: "DELETE" })).status, 404);
  const invalid = await fetch(`${origin}/v1/accounts/a:token`, { method: "POST", body: "{" });
  assert.equal(invalid.status, 400);
  const teapot = await fetch(`${origin}/teapot`);
  assert.deepEqual([teapot.status, await teapot.json()], [418, { message: "I'm a teapot." }]);
  assert.equal(await (await fetch(`${origin}/stream`)).text(), "data: 1\n\n");
});

test("logs each request with its route and status, but not the control API's", async () => {
  fake.reset();
  await fetch(`${origin}/repos/acme/app?per_page=1`);
  await fetch(`${origin}/nowhere`);
  await control("GET", "/requests");
  assert.deepEqual(
    fake.requests.map(({ method, path, query, route, status }) => ({
      method,
      path,
      query,
      route,
      status,
    })),
    [
      {
        method: "GET",
        path: "/repos/acme/app",
        query: "?per_page=1",
        route: "GET /repos/{owner}/{repo}",
        status: 200,
      },
      { method: "GET", path: "/nowhere", query: "", route: undefined, status: 404 },
    ],
  );
  const logged = (await (await control("GET", "/requests")).json()) as { path: string }[];
  assert.deepEqual(
    logged.map((request) => request.path),
    ["/repos/acme/app", "/nowhere"],
  );
});

test("a fault answers in place of a route, waits, or drops the connection, as many times as asked", async () => {
  fake.reset();
  fake.fault({ method: "GET", path: "/repos/{owner}/{repo}", status: 503, times: 2 });
  assert.equal((await fetch(`${origin}/repos/acme/app`)).status, 503);
  assert.deepEqual(await (await fetch(`${origin}/repos/acme/app`)).json(), {
    message: "Injected fault.",
  });
  assert.equal((await fetch(`${origin}/repos/acme/app`)).status, 200);

  fake.fault({ path: "/repos/acme/{repo}", delayMs: 100, times: 1 });
  const start = Date.now();
  assert.equal((await fetch(`${origin}/repos/acme/app`)).status, 200);
  assert.ok(Date.now() - start >= 90);

  fake.fault({ path: "/repos/acme/app", drop: true });
  await assert.rejects(fetch(`${origin}/repos/acme/app`));
  assert.equal(fake.requests.at(-1)?.status, 0);
  fake.clearFaults();
  assert.equal((await fetch(`${origin}/repos/acme/app`)).status, 200);
});

test("the control API needs its token, and sets faults and resets the fake", async () => {
  fake.reset();
  assert.equal((await fetch(`${origin}/_fake/reset`, { method: "POST" })).status, 401);
  assert.equal((await control("POST", "/faults", { status: 500 })).status, 400);
  const body = { message: "Server Error" };
  assert.equal(
    (await control("POST", "/faults", { path: "/repos/{o}/{r}", status: 500, body })).status,
    204,
  );
  const failed = await fetch(`${origin}/repos/acme/app`);
  assert.deepEqual([failed.status, await failed.json()], [500, body]);
  let resets = 0;
  fake.onReset(() => resets++);
  assert.equal((await control("POST", "/reset")).status, 204);
  assert.equal(resets, 1);
  assert.deepEqual(fake.requests, []);
  assert.equal((await fetch(`${origin}/repos/acme/app`)).status, 200);
});
