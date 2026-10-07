import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fetch } from "../budget.ts";
import { identityProblem, serviceAccountTokens } from "./google.ts";

const identity = {
  provider: "projects/123456789/locations/global/workloadIdentityPools/codeman/providers/github",
  serviceAccount: "codeman@codeman-ops.iam.gserviceaccount.com",
};

function fakeFetch(responses: Response[]): {
  fetch: Fetch;
  calls: { url: string; init: RequestInit; body: Record<string, unknown> }[];
} {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    return responses.shift() ?? new Response("{}", { status: 500 });
  }) as Fetch;
  return { fetch: fetchFn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sts = (token: string) =>
  json({ access_token: token, issued_token_type: "x", token_type: "Bearer", expires_in: 3600 });
const account = (token: string, expireTime: string) => json({ accessToken: token, expireTime });

test("exchanges the job's OIDC token for the service account's, and keeps it until it nearly expires", async () => {
  const { fetch, calls } = fakeFetch([
    sts("federated-1"),
    account("access-1", "2026-10-07T13:00:00Z"),
    sts("federated-2"),
    account("access-2", "2026-10-07T14:00:00Z"),
  ]);
  const audiences: string[] = [];
  const masked: string[] = [];
  let now = Date.parse("2026-10-07T12:00:00Z");
  const token = serviceAccountTokens(identity, {
    idToken: async (audience) => {
      audiences.push(audience);
      return `github-oidc-${audiences.length}`;
    },
    mask: (secret) => masked.push(secret),
    fetch,
    now: () => now,
  });
  const [first, again] = await Promise.all([token(), token()]);
  assert.equal(first, "access-1");
  assert.equal(again, "access-1", "requests at once share one exchange");
  assert.deepEqual(audiences, [`https://iam.googleapis.com/${identity.provider}`]);

  const [exchange, impersonate] = calls;
  assert.equal(exchange?.url, "https://sts.googleapis.com/v1/token");
  assert.equal(new Headers(exchange?.init.headers).get("authorization"), null);
  assert.deepEqual(exchange?.body, {
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: `//iam.googleapis.com/${identity.provider}`,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    subjectToken: "github-oidc-1",
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
  });
  assert.equal(
    impersonate?.url,
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/codeman%40codeman-ops.iam.gserviceaccount.com:generateAccessToken",
  );
  assert.equal(new Headers(impersonate?.init.headers).get("authorization"), "Bearer federated-1");
  assert.deepEqual(impersonate?.body, {
    scope: ["https://www.googleapis.com/auth/datastore"],
    lifetime: "3600s",
  });
  assert.deepEqual(masked, ["federated-1", "access-1"]);

  now = Date.parse("2026-10-07T12:54:00Z");
  assert.equal(await token(), "access-1");
  now = Date.parse("2026-10-07T12:56:00Z");
  assert.equal(await token(), "access-2", "renewed within 5 minutes of its expiry");
  assert.equal(calls.length, 4);
});

test("a refusal says which service refused and why, without any token", async () => {
  const refusal = (responses: Response[]) => {
    const { fetch } = fakeFetch(responses);
    return serviceAccountTokens(identity, {
      idToken: async () => "github-oidc-secret",
      mask: () => {},
      fetch,
    })();
  };
  await assert.rejects(
    refusal([
      json(
        {
          error: "unauthorized_client",
          error_description: "The given credential is rejected by the attribute condition.",
        },
        400,
      ),
    ]),
    (error: Error) =>
      error.message ===
        "Google's STS refused the request with 400: unauthorized_client: The given credential is rejected by the attribute condition." &&
      !error.message.includes("github-oidc-secret"),
  );
  await assert.rejects(
    refusal([
      sts("federated-secret"),
      json(
        {
          error: {
            code: 403,
            message: "Permission 'iam.serviceAccounts.getAccessToken' denied on resource.",
            status: "PERMISSION_DENIED",
          },
        },
        403,
      ),
    ]),
    (error: Error) =>
      error.message ===
        "IAM Credentials refused the request with 403: PERMISSION_DENIED: Permission 'iam.serviceAccounts.getAccessToken' denied on resource." &&
      !error.message.includes("federated-secret"),
  );
  await assert.rejects(refusal([json({})]), /Google's STS answered without a token/);
});

test("the provider and the service account must have their forms", () => {
  assert.equal(identityProblem(identity), undefined);
  assert.match(
    identityProblem({ ...identity, provider: "codeman/github" }) ?? "",
    /not a Workload Identity provider: it has the form projects\/<project number>/,
  );
  assert.match(
    identityProblem({ ...identity, serviceAccount: "someone@example.com" }) ?? "",
    /not a service account's email/,
  );
  assert.throws(
    () =>
      serviceAccountTokens(
        { ...identity, provider: "x" },
        { idToken: async () => "", mask: () => {} },
      ),
    /not a Workload Identity provider/,
  );
});
