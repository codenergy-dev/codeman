import { generateKeyPairSync, sign } from "node:crypto";
import type { GitHubFake } from "./github.ts";

/** What the GitHub fake's tests share: a world of one organization, and an App's JWT. */

/** One key pair for the tests' App: making one per test takes most of their time. */
const KEYS = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

/** An App's JWT, as `@octokit/auth-app` makes one: RS256, `iat` 30 s back, `exp` 10 min on. */
export function appJwt(clientId: string, privateKey: string, now = Date.now()): string {
  const seconds = Math.floor(now / 1000) - 30;
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iat: seconds, exp: seconds + 600, iss: clientId })}`;
  return `${signed}.${sign("sha256", Buffer.from(signed), privateKey).toString("base64url")}`;
}

/**
 * `acme`, owned by `olivia`, with `acme/app` (private, alice maintains it, bob triages it, carol is
 * a member without a role there) and `acme/site` (public), `stranger` outside it, and the
 * `codeman` App installed on both repositories with Codeman's permissions.
 */
export async function acme(
  fake: GitHubFake,
  files: Record<string, string> = { "README.md": "# App\n" },
) {
  for (const login of ["olivia", "alice", "bob", "carol", "stranger"]) fake.addUser(login);
  fake.addOrganization({
    login: "acme",
    owners: ["olivia"],
    members: ["alice", "bob", "carol"],
    basePermission: "none",
  });
  const app = await fake.addRepository({
    owner: "acme",
    name: "app",
    files,
    collaborators: { alice: "maintain", bob: "triage" },
  });
  const site = await fake.addRepository({ owner: "acme", name: "site", private: false, files });
  const registered = fake.registerApp({ slug: "codeman", publicKey: KEYS.publicKey });
  const installation = fake.install({
    app: "codeman",
    owner: "acme",
    repositories: ["app", "site"],
    permissions: {
      contents: "write",
      issues: "write",
      pull_requests: "write",
      actions: "write",
      workflows: "write",
      metadata: "read",
    },
  });
  return { app, site, installation, codeman: registered.app, privateKey: KEYS.privateKey };
}
