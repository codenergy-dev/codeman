import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Fetch } from "../budget.ts";
import { Ledger } from "../ledger.ts";
import { select } from "../steps/select.ts";
import { FakePlatform, fakeServices } from "../testing/fake-platform.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { backendStore } from "./backend.ts";

const settings = {
  "firebase-project": "codeman-ops",
  "workload-identity-provider":
    "projects/123456789/locations/global/workloadIdentityPools/codeman/providers/github",
  "service-account": "codeman@codeman-ops.iam.gserviceaccount.com",
};

const workdir = mkdtempSync(join(tmpdir(), "codeman-backend-"));
after(() => rmSync(workdir, { recursive: true, force: true }));

test("without the backend's settings, a step fails and names the variables to set", () => {
  assert.throws(
    () => backendStore(new FakeRuntime()),
    /^Error: Codeman's backend is not set up: this step has no `CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER`, `CODEMAN_SERVICE_ACCOUNT`\. Set these variables in the repository or the organization, as docs\/installation\.md#4-set-up-the-backend says/,
  );
  const runtime = new FakeRuntime({ inputs: { ...settings, "service-account": " " } });
  assert.throws(
    () => backendStore(runtime),
    /this step has no `CODEMAN_SERVICE_ACCOUNT`\. Set this variable/,
  );
  const wrong = new FakeRuntime({
    inputs: { ...settings, "workload-identity-provider": "github" },
  });
  assert.throws(
    () => backendStore(wrong),
    /backend settings are wrong: "github" is not a Workload/,
  );
  const project = new FakeRuntime({ inputs: { ...settings, "firebase-project": "My Project" } });
  assert.throws(() => backendStore(project), /backend settings are wrong: "My Project" is not a/);
});

test("with its settings, the store reaches Firestore as the service account, with the job's OIDC token", async () => {
  const runtime = new FakeRuntime({ inputs: settings });
  const urls: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    urls.push(url);
    if (url.startsWith("https://sts.")) return Response.json({ access_token: "federated" });
    if (url.startsWith("https://iamcredentials.")) {
      return Response.json({ accessToken: "access", expireTime: "2099-01-01T00:00:00Z" });
    }
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer access");
    return Response.json([{ missing: "x" }]);
  }) as Fetch;
  const store = backendStore(runtime, fetchFn);
  assert.deepEqual(urls, [], "no token until the first request");
  assert.equal(await store.get("organizations/o"), undefined);
  assert.deepEqual(runtime.idTokens, [
    `https://iam.googleapis.com/${settings["workload-identity-provider"]}`,
  ]);
  assert.equal(
    urls.at(-1),
    "https://firestore.googleapis.com/v1/projects/codeman-ops/databases/(default)/documents:batchGet",
  );
  assert.deepEqual(runtime.masked, ["oidc-token-1", "federated", "access"]);
});

test("select fails before it marks any task when the backend is not set up", async () => {
  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  platform.maintainers.add("alice");
  const number = platform.openIssue("alice", "Add a cache", "Cache responses.");
  const runtime = new FakeRuntime({ inputs: { workdir } });
  const services = {
    ...fakeServices(platform, runtime),
    store: () => backendStore(runtime),
    ledger: (job: string) => new Ledger(backendStore(runtime), { runtime, job }),
  };
  await assert.rejects(select(services), /Codeman's backend is not set up/);
  assert.deepEqual(platform.issues.get(number)?.labels, ["codeman"]);
  assert.deepEqual(platform.comments.get(number), []);
});
