import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import { backendStore } from "../../../src/store/backend.ts";
import { Firestore } from "../../../src/store/firestore.ts";
import { emulatorJar, startEmulator } from "../../../src/testing/emulator.ts";
import { FakeRuntime } from "../../../src/testing/fake-runtime.ts";
import { codemanCondition, GoogleFake } from "./google.ts";
import { OIDC_TOKEN_PATH } from "./oidc.ts";

/**
 * The fake's `owner` token on Firebase's Firestore emulator, with Codeman's security rules, which
 * deny every client: the token path of the e2e build reaches the store. Skipped without the
 * emulator in Firebase's cache and Java, as src/store/emulator.test.ts is.
 */
const PROVIDER =
  "projects/123456789/locations/global/workloadIdentityPools/codeman/providers/github";
const ACCOUNT = "codeman@codeman-e2e.iam.gserviceaccount.com";
const jar = emulatorJar();
const skip = jar ? false : "no Firestore emulator in Firebase's cache, or no Java";

const google = new GoogleFake({
  provider: PROVIDER,
  serviceAccounts: [ACCOUNT],
  condition: codemanCondition({ ownerIds: ["100"] }),
});
let origin = "";
let emulator: { host: string; process: ChildProcess } | undefined;
before(async () => {
  if (!jar) return;
  origin = await google.server.listen();
  emulator = await startEmulator(jar, ["--rules", "firebase/firestore.rules"]);
});
after(async () => {
  emulator?.process.kill();
  await google.server.close();
});

test("the backend store reaches the emulator past its rules with the fake's token", {
  skip,
}, async () => {
  const project = `codeman-e2e-${randomBytes(4).toString("hex")}`;
  const requestToken = google.register({
    repository: "acme/app",
    repositoryId: "200",
    ownerId: "100",
  });
  const e2e = redirects({
    CODEMAN_E2E_ENDPOINTS: JSON.stringify({
      googleSts: origin,
      googleIamCredentials: origin,
      firestore: `http://${emulator?.host}`,
    }),
  });
  const runtime = new FakeRuntime({
    inputs: {
      "firebase-project": project,
      "workload-identity-provider": PROVIDER,
      "service-account": ACCOUNT,
    },
  });
  // The job's OIDC token, as @actions/core's getIDToken asks the issuer for it.
  runtime.idToken = async (audience) => {
    const url = `${origin}${OIDC_TOKEN_PATH}&audience=${encodeURIComponent(audience)}`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${requestToken}` } });
    return ((await response.json()) as { value: string }).value;
  };
  const store = backendStore(runtime, e2e.fetch);
  await store.write([{ op: "create", path: "organizations/acme", fields: { name: "acme" } }]);
  assert.deepEqual((await store.get("organizations/acme"))?.fields, { name: "acme" });

  // The rules hold for any other token.
  const client = new Firestore({
    project,
    baseUrl: `http://${emulator?.host}`,
    token: async () => "not-owner",
  });
  await assert.rejects(client.get("organizations/acme"));
});
