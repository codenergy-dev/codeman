import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { redirects } from "../../../src/e2e.ts";
import { GitHubActionsRuntime } from "../../../src/runtime/github-actions.ts";
import { serviceAccountTokens } from "../../../src/store/google.ts";
import { codemanCondition, DATASTORE, GoogleFake } from "./google.ts";
import { Issuer, OIDC_TOKEN_PATH, type RunIdentity } from "./oidc.ts";

const PROVIDER =
  "projects/123456789/locations/global/workloadIdentityPools/codeman/providers/github";
const ACCOUNT = "codeman@codeman-e2e.iam.gserviceaccount.com";
const AUDIENCE = `https://iam.googleapis.com/${PROVIDER}`;
const ACME: RunIdentity = {
  repository: "acme/app",
  repositoryId: "200",
  ownerId: "100",
  runId: "7",
};

let now = Date.parse("2026-10-20T12:00:00Z");
const google = new GoogleFake(
  {
    provider: PROVIDER,
    serviceAccounts: [ACCOUNT],
    condition: codemanCondition({ ownerIds: ["100"] }),
  },
  { now: () => now },
);
let origin = "";
before(async () => {
  origin = await google.server.listen();
});
after(() => google.server.close());
beforeEach(() => {
  google.server.reset();
  now = Date.parse("2026-10-20T12:00:00Z");
});

/** A JWT for `run`, as `getIDToken(audience)` asks for one. */
async function idToken(run: RunIdentity, audience = AUDIENCE): Promise<string> {
  const response = await fetch(
    `${origin}${OIDC_TOKEN_PATH}&audience=${encodeURIComponent(audience)}`,
    {
      headers: { authorization: `Bearer ${google.register(run)}` },
    },
  );
  assert.equal(response.status, 200);
  return ((await response.json()) as { value: string }).value;
}

async function exchange(subjectToken: string, overrides: Record<string, string> = {}) {
  const response = await fetch(`${origin}/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${PROVIDER}`,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectToken,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      ...overrides,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function impersonate(
  token: string | undefined,
  body: unknown = { scope: [DATASTORE], lifetime: "3600s" },
  account = ACCOUNT,
) {
  const response = await fetch(
    `${origin}/v1/projects/-/serviceAccounts/${encodeURIComponent(account)}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function payload(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
}

test("the issuer signs GitHub's claims for each request token's run, with keys its JWKS publishes", async () => {
  const jwt = await idToken({ ...ACME, jobWorkflowFile: "codeman-task.yml" });
  const claims = payload(jwt);
  assert.equal(claims.iss, "https://token.actions.githubusercontent.com");
  assert.equal(claims.aud, AUDIENCE);
  assert.equal(claims.sub, "repo:acme/app:ref:refs/heads/main");
  assert.equal(claims.repository_owner, "acme");
  assert.equal(claims.repository_owner_id, "100");
  assert.equal(claims.repository_id, "200");
  assert.equal(claims.run_id, "7");
  assert.equal(claims.workflow_ref, "acme/app/.github/workflows/codeman.yml@refs/heads/main");
  assert.equal(
    claims.job_workflow_ref,
    "acme/app/.github/workflows/codeman-task.yml@refs/heads/main",
  );
  assert.equal(claims.exp, Math.floor(now / 1000) + 300);

  const discovery = (await (await fetch(`${origin}/.well-known/openid-configuration`)).json()) as {
    issuer: string;
    jwks_uri: string;
  };
  assert.equal(discovery.issuer, claims.iss);
  const jwks = (await (await fetch(discovery.jwks_uri)).json()) as { keys: { kid: string }[] };
  const [header = "", body = "", signature = ""] = jwt.split(".");
  const { kid } = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  const key = jwks.keys.find((one) => one.kid === kid);
  assert.ok(key);
  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${header}.${body}`),
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(signature, "base64url"),
    ),
  );

  const unknown = await fetch(`${origin}${OIDC_TOKEN_PATH}`, {
    headers: { authorization: "Bearer nope" },
  });
  assert.equal(unknown.status, 401);
  // Without an audience, GitHub's default: the owner's URL.
  const plain = await fetch(`${origin}${OIDC_TOKEN_PATH}`, {
    headers: { authorization: `Bearer ${google.register(ACME)}` },
  });
  assert.equal(
    payload(((await plain.json()) as { value: string }).value).aud,
    "https://github.com/acme",
  );
});

test("STS refuses a token for another audience, as Google does", async () => {
  const wrong = await exchange(await idToken(ACME, "https://github.com/acme"));
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "invalid_grant");
  assert.match(
    String(wrong.body.error_description),
    /audience in ID Token \[https:\/\/github.com\/acme\] does not match/,
  );
  const otherProvider = await exchange(await idToken(ACME), {
    audience:
      "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/q",
  });
  assert.deepEqual([otherProvider.status, otherProvider.body.error], [400, "invalid_target"]);
  // The provider's name without https is a default audience too.
  const bare = await exchange(await idToken(ACME, `//iam.googleapis.com/${PROVIDER}`));
  assert.equal(bare.status, 200);
});

test("STS refuses a repository the attribute condition does not admit", async () => {
  const refusal = {
    error: "unauthorized_client",
    error_description: "The given credential is rejected by the attribute condition.",
  };
  const other = await exchange(
    await idToken({ repository: "evil/app", repositoryId: "300", ownerId: "999" }),
  );
  assert.deepEqual([other.status, other.body], [400, refusal]);
  const workflow = await exchange(await idToken({ ...ACME, workflowFile: "other.yml" }));
  assert.deepEqual(workflow.body, refusal);
  const branch = await exchange(await idToken({ ...ACME, ref: "refs/heads/feature" }));
  assert.deepEqual(branch.body, refusal);

  google.setup({
    provider: PROVIDER,
    serviceAccounts: [ACCOUNT],
    condition: codemanCondition({ ownerIds: ["100"], repositoryIds: ["201"] }),
  });
  try {
    assert.deepEqual((await exchange(await idToken(ACME))).body, refusal);
    assert.equal((await exchange(await idToken({ ...ACME, repositoryId: "201" }))).status, 200);
  } finally {
    google.setup({
      provider: PROVIDER,
      serviceAccounts: [ACCOUNT],
      condition: codemanCondition({ ownerIds: ["100"] }),
    });
  }

  google.faults({ refuseRepositories: ["acme/app"] });
  assert.deepEqual((await exchange(await idToken(ACME))).body, refusal);
  assert.equal((await exchange(await idToken({ ...ACME, repository: "acme/web" }))).status, 200);
});

test("STS refuses a forged, expired or malformed token, and a request with an Authorization header", async () => {
  const forger = new Issuer({ now: () => now });
  const forged = forger.sign({ ...payload(await idToken(ACME)) });
  assert.deepEqual((await exchange(forged)).body.error, "invalid_grant");
  const [header, , signature] = (await idToken(ACME)).split(".");
  const tampered = `${header}.${Buffer.from(JSON.stringify({ ...payload(await idToken(ACME)), repository_owner_id: "999" })).toString("base64url")}.${signature}`;
  assert.match(String((await exchange(tampered)).body.error_description), /signature/);
  assert.equal((await exchange("not-a-jwt")).body.error, "invalid_grant");

  const late = await idToken(ACME);
  now += 10 * 60_000;
  const expired = await exchange(late);
  assert.deepEqual([expired.status, expired.body.error], [400, "invalid_grant"]);
  assert.match(String(expired.body.error_description), /expired/);

  const headed = await fetch(`${origin}/v1/token`, {
    method: "POST",
    headers: { authorization: "Bearer x", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(headed.status, 400);
  assert.equal(
    (
      await exchange(await idToken(ACME), {
        subjectTokenType: "urn:ietf:params:oauth:token-type:access_token",
      })
    ).body.error,
    "invalid_request",
  );
});

test("STS takes the form-encoded body as well", async () => {
  const response = await fetch(`${origin}/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${PROVIDER}`,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token: await idToken(ACME),
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });
  assert.equal(response.status, 200);
});

test("IAM Credentials gives `owner` for a live federated token and the configured account only", async () => {
  const sts = await exchange(await idToken(ACME));
  assert.deepEqual(Object.keys(sts.body).sort(), [
    "access_token",
    "expires_in",
    "issued_token_type",
    "token_type",
  ]);
  const federated = String(sts.body.access_token);
  assert.deepEqual(await impersonate(federated), {
    status: 200,
    body: { accessToken: "owner", expireTime: "2026-10-20T13:00:00Z" },
  });

  const unauthenticated = await impersonate(undefined);
  assert.deepEqual(
    [unauthenticated.status, (unauthenticated.body.error as { status: string }).status],
    [401, "UNAUTHENTICATED"],
  );
  assert.equal((await impersonate("sts-forged")).status, 401);
  const stranger = await impersonate(
    federated,
    undefined,
    "other@codeman-e2e.iam.gserviceaccount.com",
  );
  assert.deepEqual(stranger.body, {
    error: {
      code: 403,
      message:
        "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).",
      status: "PERMISSION_DENIED",
    },
  });
  assert.equal((await impersonate(federated, { scope: [] })).status, 400);
  assert.equal(
    (await impersonate(federated, { scope: ["https://www.googleapis.com/auth/cloud-platform"] }))
      .status,
    400,
  );
  assert.equal(
    (await impersonate(federated, { scope: [DATASTORE], lifetime: "7200s" })).status,
    400,
  );

  const narrow = await exchange(await idToken(ACME), {
    scope: "https://www.googleapis.com/auth/userinfo.email",
  });
  assert.equal((await impersonate(String(narrow.body.access_token))).status, 403);

  now += 61 * 60_000;
  assert.equal((await impersonate(federated)).status, 401, "a federated token lasts an hour");
});

test("faults: a disabled account answers 403, and a short expiry shortens the token", async () => {
  const federated = String((await exchange(await idToken(ACME))).body.access_token);
  google.faults({ disabledAccounts: [ACCOUNT] });
  assert.equal((await impersonate(federated)).status, 403);
  google.faults({ expirySeconds: 60 });
  assert.equal((await impersonate(federated)).body.expireTime, "2026-10-20T12:01:00Z");
  google.server.reset();
  assert.equal((await impersonate(federated)).status, 401, "a reset forgets the federated tokens");
});

test("the control API registers runs, sets the provider up and sets faults", async () => {
  const call = (method: string, path: string, body: unknown) =>
    fetch(`${origin}/_fake/google${path}`, { method, body: JSON.stringify(body) });
  const registered = await call("POST", "/runs", {
    repository: "acme/web",
    repositoryId: "201",
    ownerId: "100",
  });
  assert.equal(registered.status, 201);
  const { token } = (await registered.json()) as { token: string };
  const jwt = await fetch(`${origin}${OIDC_TOKEN_PATH}&audience=${encodeURIComponent(AUDIENCE)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const subject = ((await jwt.json()) as { value: string }).value;
  assert.equal(payload(subject).repository, "acme/web");
  assert.equal((await call("POST", "/runs", { repository: "acme" })).status, 400);

  assert.equal((await call("PUT", "/faults", { refuseRepositories: ["acme/web"] })).status, 204);
  assert.equal((await exchange(subject)).body.error, "unauthorized_client");
  assert.equal((await call("PUT", "/faults", {})).status, 204);
  assert.equal((await exchange(subject)).status, 200);

  assert.equal((await call("PUT", "/setup", { provider: PROVIDER })).status, 400);
  const setup = {
    provider: PROVIDER,
    serviceAccounts: [ACCOUNT],
    condition: { ownerIds: ["555"] },
  };
  assert.equal((await call("PUT", "/setup", setup)).status, 204);
  assert.equal((await exchange(subject)).body.error, "unauthorized_client");
  google.setup({
    provider: PROVIDER,
    serviceAccounts: [ACCOUNT],
    condition: codemanCondition({ ownerIds: ["100"] }),
  });
});

test("Codeman's own client gets `owner` through @actions/core's OIDC request and the e2e redirects", async () => {
  const env = { ...process.env };
  // @actions/core prints workflow commands, such as each token's mask; they mean nothing here.
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: never[]) =>
    String(chunk).startsWith("::") || write.call(process.stdout, chunk, ...rest)) as typeof write;
  try {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${origin}${OIDC_TOKEN_PATH}`;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = google.register(ACME);
    const e2e = redirects({
      CODEMAN_E2E_ENDPOINTS: JSON.stringify({ googleSts: origin, googleIamCredentials: origin }),
    });
    const runtime = new GitHubActionsRuntime();
    const masked: string[] = [];
    const tokens = () =>
      serviceAccountTokens(
        { provider: PROVIDER, serviceAccount: ACCOUNT },
        {
          idToken: (audience) => runtime.idToken(audience),
          mask: (secret) => masked.push(secret),
          fetch: e2e.fetch,
          now: () => now,
        },
      );
    const exchanges = () =>
      google.server.requests.filter((request) => request.route === "POST /v1/token").length;
    const token = tokens();
    assert.equal(await token(), "owner");
    assert.equal(await token(), "owner");
    assert.equal(masked.length, 2);
    assert.equal(exchanges(), 1, "an hour's token is kept");

    // A token that expires within the client's margin is renewed on every call.
    google.faults({ expirySeconds: 60 });
    const short = tokens();
    await short();
    await short();
    assert.equal(exchanges(), 3, "a token within the client's margin is renewed");

    google.faults({ refuseRepositories: ["acme/app"] });
    await assert.rejects(
      tokens()(),
      new Error(
        "Google's STS refused the request with 400: unauthorized_client: The given credential is rejected by the attribute condition.",
      ),
    );
    google.faults({ disabledAccounts: [ACCOUNT] });
    await assert.rejects(
      tokens()(),
      /^Error: IAM Credentials refused the request with 403: PERMISSION_DENIED: Permission 'iam\.serviceAccounts\.getAccessToken' denied/,
    );
  } finally {
    process.env = env;
    process.stdout.write = write;
  }
});
