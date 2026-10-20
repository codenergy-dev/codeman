import {
  createPublicKey,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { type FakeServer, HttpError, json } from "../http.ts";

/**
 * A fake of GitHub's OIDC provider, for jobs that run outside GitHub: `@actions/core`'s
 * `getIDToken` reaches it through `ACTIONS_ID_TOKEN_REQUEST_URL` and `_TOKEN`
 * (docs/web/github/openid-connect-reference.md). Each request token stands for one run, with its
 * own claims, so each act invocation or simulated job proves its own repository and run.
 */

/** The `iss` of GitHub's tokens, which the fake keeps: Codeman never reads it. */
export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";

/** The path of `ACTIONS_ID_TOKEN_REQUEST_URL`; it carries a query, as `getIDToken` appends `&audience=`. */
export const OIDC_TOKEN_PATH = "/oidc/token?api-version=2.0";

/** A JWT's payload. */
export type Claims = Record<string, unknown>;

/** Who a run is, from which GitHub's claims follow. IDs are strings, as in GitHub's tokens. */
export interface RunIdentity {
  /** `owner/name`. */
  repository: string;
  repositoryId: string;
  ownerId: string;
  runId?: string;
  runAttempt?: string;
  /** The workflow's file under `.github/workflows/`; `codeman.yml` by default. */
  workflowFile?: string;
  /** `Codeman` by default, the template's name. */
  workflow?: string;
  /** `refs/heads/main` by default. */
  ref?: string;
  /** The reusable workflow's file, for a job of `codeman-task.yml`; the workflow's by default. */
  jobWorkflowFile?: string;
  eventName?: string;
  /** Claims to add or replace, for a scenario that forges one. */
  claims?: Claims;
}

/** GitHub's claims for a run, but `iss`, `aud` and the times. See openid-connect-reference.md. */
export function githubClaims(run: RunIdentity): Claims {
  const [owner = ""] = run.repository.split("/");
  const ref = run.ref ?? "refs/heads/main";
  const workflowRef = (file: string) => `${run.repository}/.github/workflows/${file}@${ref}`;
  const sha = "0".repeat(40);
  const runId = run.runId ?? "1";
  return {
    sub: `repo:${run.repository}:ref:${ref}`,
    ref,
    ref_type: ref.startsWith("refs/tags/") ? "tag" : "branch",
    sha,
    repository: run.repository,
    repository_id: run.repositoryId,
    repository_owner: owner,
    repository_owner_id: run.ownerId,
    repository_visibility: "private",
    actor: "codeman-e2e",
    actor_id: "1",
    run_id: runId,
    run_number: runId,
    run_attempt: run.runAttempt ?? "1",
    runner_environment: "github-hosted",
    workflow: run.workflow ?? "Codeman",
    workflow_ref: workflowRef(run.workflowFile ?? "codeman.yml"),
    workflow_sha: sha,
    job_workflow_ref: workflowRef(run.jobWorkflowFile ?? run.workflowFile ?? "codeman.yml"),
    job_workflow_sha: sha,
    event_name: run.eventName ?? "workflow_dispatch",
    head_ref: "",
    base_ref: "",
    ...run.claims,
  };
}

/** The signing key, an RSA key pair that lives as long as the process. */
interface Key {
  kid: string;
  privateKey: KeyObject;
  jwk: JsonWebKey;
}

export class Issuer {
  readonly issuer: string;
  readonly #now: () => number;
  readonly #key: Key;
  readonly #runs = new Map<string, Claims>();

  constructor(options: { issuer?: string; now?: () => number } = {}) {
    this.issuer = options.issuer ?? GITHUB_ISSUER;
    this.#now = options.now ?? Date.now;
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = randomBytes(8).toString("hex");
    this.#key = {
      kid,
      privateKey,
      jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
    };
  }

  /** The JWKS, as `jwks_uri` serves it. */
  get jwks(): { keys: JsonWebKey[] } {
    return { keys: [this.#key.jwk] };
  }

  /** A new request token, which gets JWTs with `run`'s claims. */
  register(run: RunIdentity): string {
    const token = `oidc-request-${randomBytes(16).toString("hex")}`;
    this.#runs.set(token, githubClaims(run));
    return token;
  }

  /** Forgets every request token. */
  reset(): void {
    this.#runs.clear();
  }

  /** A JWT for the run of `requestToken`, for `audience`; undefined for an unknown token. */
  token(requestToken: string, audience?: string): string | undefined {
    const claims = this.#runs.get(requestToken);
    if (!claims) return undefined;
    const now = Math.floor(this.#now() / 1000);
    return this.sign({
      jti: randomUUID(),
      ...claims,
      // GitHub's default audience is the owner's URL.
      aud: audience ?? `https://github.com/${claims.repository_owner}`,
      iss: this.issuer,
      nbf: now - 600,
      iat: now,
      exp: now + 300,
    });
  }

  /** `claims`, signed with RS256 by the issuer's key. */
  sign(claims: Claims, kid = this.#key.kid): string {
    const header = { typ: "JWT", alg: "RS256", kid };
    const signed = `${encode(header)}.${encode(claims)}`;
    const signature = sign("sha256", Buffer.from(signed), this.#key.privateKey);
    return `${signed}.${signature.toString("base64url")}`;
  }

  /**
   * The claims of a JWT whose signature a key of the JWKS checks; throws, saying why, when
   * it is not one. The times and audience are the verifier's to check.
   */
  verify(jwt: string): Claims {
    const [header, payload, signature, extra] = jwt.split(".");
    if (!header || !payload || signature === undefined || extra !== undefined) {
      throw new Error("Unable to parse the ID Token.");
    }
    const { alg, kid } = (decode(header) ?? {}) as { alg?: unknown; kid?: unknown };
    // Google takes ES256 too; the issuer signs with RS256 only.
    if (alg !== "RS256") {
      throw new Error(`The ID Token's algorithm ${String(alg)} is not supported.`);
    }
    const jwk = this.jwks.keys.find((key) => key.kid === kid);
    if (!jwk) throw new Error(`The ID Token's key ${String(kid)} is not in the issuer's JWKS.`);
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(signature, "base64url"),
    );
    const claims = decode(payload);
    if (!valid || typeof claims !== "object" || claims === null) {
      throw new Error("Invalid ID Token signature.");
    }
    return claims as Claims;
  }

  /** Adds the token endpoint, the discovery document and the JWKS to `server`. */
  routes(server: FakeServer): void {
    const [path] = OIDC_TOKEN_PATH.split("?");
    server.route("GET", path ?? OIDC_TOKEN_PATH, (request) => {
      const value =
        request.bearer && this.token(request.bearer, request.query.get("audience") ?? undefined);
      if (!value) throw new HttpError(401, { message: "Unknown request token." });
      return json({ value });
    });
    server.route("GET", "/.well-known/openid-configuration", (request) =>
      json({
        issuer: this.issuer,
        jwks_uri: `${request.origin}/.well-known/jwks`,
        subject_types_supported: ["public", "pairwise"],
        response_types_supported: ["id_token"],
        claims_supported: ["sub", "aud", "exp", "iat", "iss", "jti", "nbf", ...claimNames],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid"],
      }),
    );
    server.route("GET", "/.well-known/jwks", () => json(this.jwks));
    server.onReset(() => this.reset());
  }
}

const claimNames = Object.keys(
  githubClaims({ repository: "o/r", repositoryId: "1", ownerId: "1" }),
);

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}
