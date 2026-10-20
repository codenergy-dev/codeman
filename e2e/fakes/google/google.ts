import { randomBytes } from "node:crypto";
import { type FakeRequest, FakeServer, HttpError, json } from "../http.ts";
import { type Claims, Issuer, type RunIdentity } from "./oidc.ts";

/**
 * A fake of the Google side of Codeman's backend (src/store/google.ts): GitHub's OIDC issuer,
 * Google's Security Token Service with a Workload Identity provider, and IAM Credentials. It
 * checks what Google checks (the JWT's signature, issuer, audience and times, the provider's
 * attribute condition, the federated token and the service account), and gives a token that the
 * Firestore emulator takes as an admin. Success shapes follow docs/web/google-cloud/method-token.md
 * and method-projects-serviceaccounts-generateaccesstoken.md; the error texts are plausible, not
 * Google's documented ones, which docs/web/ does not hold.
 */

const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";
const SUBJECT_TOKEN_TYPES = [
  "urn:ietf:params:oauth:token-type:jwt",
  "urn:ietf:params:oauth:token-type:id_token",
];
const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
const IAM = "https://www.googleapis.com/auth/iam";
export const DATASTORE = "https://www.googleapis.com/auth/datastore";
/** The token the Firestore emulator takes as an admin, past the security rules. */
export const EMULATOR_OWNER = "owner";
const HOUR_SECONDS = 3600;
/** How far in the past STS takes a JWT's `iat`, and the clock skew it allows. */
const MAX_AGE_SECONDS = 24 * HOUR_SECONDS;
const SKEW_SECONDS = 60;

/** The provider's attribute condition, on the token's claims as CEL's `assertion`. */
export type Condition = (assertion: Claims) => boolean;

export interface GoogleSetup {
  /** `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`. */
  provider: string;
  /** The accounts the pool's identities may impersonate. */
  serviceAccounts: string[];
  condition: Condition;
  /** The token IAM Credentials gives: `owner` by default. */
  accessToken?: string;
  /** The scopes IAM Credentials grants: Firestore's only by default, which Codeman asks for. */
  scopes?: string[];
}

/** The two conditions of docs/installation/setup.md#choose-the-attribute-condition. */
export interface ConditionSpec {
  ownerIds: string[];
  /** The listed-repositories condition when present. */
  repositoryIds?: string[];
  /** `codeman.yml` by default. */
  workflowFile?: string;
  /** `refs/heads/main` by default. */
  branch?: string;
}

/** Faults for scenarios, cleared on reset. */
export interface GoogleFaults {
  /** STS refuses these repositories (`owner/name`), as a condition that does not admit them. */
  refuseRepositories?: string[];
  /** IAM Credentials answers 403 for these accounts, as for a disabled or unbound one. */
  disabledAccounts?: string[];
  /** IAM Credentials' tokens expire this many seconds after they are given. */
  expirySeconds?: number;
}

/** The condition setup.md writes in CEL, as a predicate. */
export function codemanCondition(spec: ConditionSpec): Condition {
  const workflow = spec.workflowFile ?? "codeman.yml";
  const branch = spec.branch ?? "refs/heads/main";
  const listed = (list: string[] | undefined, value: unknown) =>
    !list || (typeof value === "string" && list.includes(value));
  return (assertion) =>
    typeof assertion.repository_owner_id === "string" &&
    spec.ownerIds.includes(assertion.repository_owner_id) &&
    listed(spec.repositoryIds, assertion.repository_id) &&
    typeof assertion.repository === "string" &&
    assertion.workflow_ref === `${assertion.repository}/.github/workflows/${workflow}@${branch}`;
}

interface Federated {
  expires: number;
  scopes: string[];
  claims: Claims;
}

export class GoogleFake {
  readonly server: FakeServer;
  readonly issuer: Issuer;
  readonly #now: () => number;
  readonly #federated = new Map<string, Federated>();
  #setup: GoogleSetup;
  #faults: GoogleFaults = {};

  constructor(setup: GoogleSetup, options: { issuer?: string; now?: () => number } = {}) {
    this.#setup = setup;
    this.#now = options.now ?? Date.now;
    this.issuer = new Issuer({ issuer: options.issuer, now: this.#now });
    this.server = new FakeServer("google");
    this.issuer.routes(this.server);
    this.server.route("POST", "/v1/token", (request) => this.#exchange(request));
    this.server.route(
      "POST",
      "/v1/projects/{project}/serviceAccounts/{account}:generateAccessToken",
      (request) => this.#generateAccessToken(request),
    );
    this.server.control("PUT", "/google/setup", (request) => {
      this.setup(setupOf(request.json()));
      return { status: 204 };
    });
    this.server.control("POST", "/google/runs", (request) =>
      json({ token: this.register(runOf(request.json())) }, 201),
    );
    this.server.control("PUT", "/google/faults", (request) => {
      this.faults(request.json() as GoogleFaults);
      return { status: 204 };
    });
    this.server.onReset(() => {
      this.#federated.clear();
      this.#faults = {};
    });
  }

  setup(setup: GoogleSetup): void {
    this.#setup = setup;
  }

  /** A request token for `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, whose JWTs carry `run`'s claims. */
  register(run: RunIdentity): string {
    return this.issuer.register(run);
  }

  /** Replaces the faults; `{}` clears them. */
  faults(faults: GoogleFaults): void {
    this.#faults = { ...faults };
  }

  /** STS: GitHub's JWT for a federated token, if the provider admits it. */
  #exchange(request: FakeRequest): ReturnType<typeof json> {
    if (request.headers.authorization) {
      throw stsError("invalid_request", "The request must not carry an Authorization header.");
    }
    const body = stsBody(request);
    const provider = this.#setup.provider;
    if (body.granttype !== TOKEN_EXCHANGE) {
      throw stsError("unsupported_grant_type", `Unsupported grant type ${body.granttype}.`);
    }
    if (body.requestedtokentype !== ACCESS_TOKEN) {
      throw stsError(
        "invalid_request",
        `Unsupported requested token type ${body.requestedtokentype}.`,
      );
    }
    if (!SUBJECT_TOKEN_TYPES.includes(body.subjecttokentype ?? "")) {
      throw stsError("invalid_request", `Unsupported subject token type ${body.subjecttokentype}.`);
    }
    if (body.audience !== `//iam.googleapis.com/${provider}`) {
      throw stsError(
        "invalid_target",
        'The target service indicated by the "audience" parameters is invalid. This might either be because the pool or provider is disabled or deleted or because it doesn\'t exist.',
      );
    }
    const scopes = (body.scope ?? "").split(" ").filter((scope) => scope !== "");
    if (scopes.length === 0) throw stsError("invalid_request", "A scope is required.");
    let claims: Claims;
    try {
      claims = this.issuer.verify(body.subjecttoken ?? "");
    } catch (error) {
      throw stsError("invalid_grant", error instanceof Error ? error.message : String(error));
    }
    if (claims.iss !== this.issuer.issuer) {
      throw stsError(
        "invalid_grant",
        `The issuer in ID Token ${String(claims.iss)} does not match the expected issuer ${this.issuer.issuer}.`,
      );
    }
    // With no allowed audiences, the provider's name, with or without https.
    const audiences = [
      `https://iam.googleapis.com/${provider}`,
      `//iam.googleapis.com/${provider}`,
    ];
    if (typeof claims.aud !== "string" || !audiences.includes(claims.aud)) {
      throw stsError(
        "invalid_grant",
        `The audience in ID Token [${String(claims.aud)}] does not match the expected audience ${audiences[0]}.`,
      );
    }
    const now = this.#now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp < now - SKEW_SECONDS) {
      throw stsError("invalid_grant", "The ID Token has expired.");
    }
    if (
      typeof claims.iat !== "number" ||
      claims.iat > now + SKEW_SECONDS ||
      claims.iat < now - MAX_AGE_SECONDS
    ) {
      throw stsError("invalid_grant", "The ID Token's issue time is out of range.");
    }
    const refused = this.#faults.refuseRepositories ?? [];
    if (refused.includes(String(claims.repository)) || !this.#setup.condition(claims)) {
      throw stsError(
        "unauthorized_client",
        "The given credential is rejected by the attribute condition.",
      );
    }
    const token = `sts-${randomBytes(24).toString("base64url")}`;
    this.#federated.set(token, { expires: this.#now() + HOUR_SECONDS * 1000, scopes, claims });
    return json({
      access_token: token,
      issued_token_type: ACCESS_TOKEN,
      token_type: "Bearer",
      expires_in: HOUR_SECONDS,
    });
  }

  /** IAM Credentials: a federated token for the service account's token. */
  #generateAccessToken(request: FakeRequest): ReturnType<typeof json> {
    const federated = request.bearer ? this.#federated.get(request.bearer) : undefined;
    if (!federated || federated.expires <= this.#now()) {
      throw iamError(
        401,
        "UNAUTHENTICATED",
        "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
      );
    }
    if (!federated.scopes.some((scope) => scope === CLOUD_PLATFORM || scope === IAM)) {
      throw iamError(403, "PERMISSION_DENIED", "Request had insufficient authentication scopes.");
    }
    const { project, account = "" } = request.params;
    if (project !== "-") {
      throw iamError(400, "INVALID_ARGUMENT", "The project of the name must be the wildcard -.");
    }
    if (
      !this.#setup.serviceAccounts.includes(account) ||
      (this.#faults.disabledAccounts ?? []).includes(account)
    ) {
      throw iamError(
        403,
        "PERMISSION_DENIED",
        "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).",
      );
    }
    const body = request.json() as { scope?: unknown; lifetime?: unknown; delegates?: unknown };
    const scopes = body.scope;
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      !scopes.every((s) => typeof s === "string")
    ) {
      throw iamError(400, "INVALID_ARGUMENT", "Scope required.");
    }
    // Stricter than Google, which grants any scope: Codeman's account needs Firestore's only.
    const granted = this.#setup.scopes ?? [DATASTORE];
    const extra = scopes.filter((scope) => !granted.includes(scope));
    if (extra.length > 0) {
      throw iamError(400, "INVALID_ARGUMENT", `The fake grants no scope ${extra.join(", ")}.`);
    }
    let lifetime = HOUR_SECONDS;
    if (body.lifetime !== undefined) {
      const match =
        typeof body.lifetime === "string" ? /^(\d+(?:\.\d{1,9})?)s$/.exec(body.lifetime) : null;
      lifetime = Number(match?.[1] ?? NaN);
      if (!(lifetime > 0 && lifetime <= HOUR_SECONDS)) {
        throw iamError(
          400,
          "INVALID_ARGUMENT",
          `The lifetime ${String(body.lifetime)} is not between 0 and 3600s.`,
        );
      }
    }
    const seconds = Math.min(lifetime, this.#faults.expirySeconds ?? lifetime);
    const expireTime = new Date(this.#now() + seconds * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    return json({ accessToken: this.#setup.accessToken ?? EMULATOR_OWNER, expireTime });
  }
}

/** The fake for e2e/fakes/main.ts: `FAKE_GOOGLE` holds its setup as JSON, as `PUT /_fake/google/setup` takes it. */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  const setup: unknown = env.FAKE_GOOGLE ? JSON.parse(env.FAKE_GOOGLE) : DEFAULT_SETUP;
  try {
    return new GoogleFake(setupOf(setup)).server;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    throw new Error(`FAKE_GOOGLE: ${(error.body as { message: string }).message}`);
  }
}

/** Until a scenario sets one up, the condition admits no owner. */
const DEFAULT_SETUP = {
  provider: "projects/123456789/locations/global/workloadIdentityPools/codeman/providers/github",
  serviceAccounts: ["codeman@codeman-e2e.iam.gserviceaccount.com"],
  condition: { ownerIds: [] },
};

/**
 * A setup from JSON: `provider`, `serviceAccounts`, `condition` as a `ConditionSpec`, and
 * optional `accessToken` and `scopes`. A 400 when a field is missing or has the wrong type.
 */
function setupOf(value: unknown): GoogleSetup {
  const setup = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const strings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  const condition = (setup.condition ?? {}) as Record<string, unknown>;
  if (
    typeof setup.provider !== "string" ||
    !strings(setup.serviceAccounts) ||
    !strings(condition.ownerIds) ||
    (condition.repositoryIds !== undefined && !strings(condition.repositoryIds)) ||
    (setup.accessToken !== undefined && typeof setup.accessToken !== "string") ||
    (setup.scopes !== undefined && !strings(setup.scopes))
  ) {
    throw new HttpError(400, {
      message:
        "A setup has provider, serviceAccounts and condition.ownerIds, and may have condition.repositoryIds, condition.workflowFile, condition.branch, accessToken and scopes.",
    });
  }
  return {
    provider: setup.provider,
    serviceAccounts: setup.serviceAccounts,
    condition: codemanCondition(condition as unknown as ConditionSpec),
    accessToken: setup.accessToken as string | undefined,
    scopes: setup.scopes as string[] | undefined,
  };
}

function runOf(value: unknown): RunIdentity {
  const run = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (
    typeof run.repository !== "string" ||
    !/^[\w.-]+\/[\w.-]+$/.test(run.repository) ||
    typeof run.repositoryId !== "string" ||
    typeof run.ownerId !== "string"
  ) {
    throw new HttpError(400, {
      message: "A run has repository (owner/name), repositoryId and ownerId.",
    });
  }
  return run as unknown as RunIdentity;
}

/**
 * STS's body, JSON or form-encoded, with each field's name lowercased and without underscores,
 * so `grantType` and `grant_type` both read as `granttype`.
 */
function stsBody(request: FakeRequest): Record<string, string | undefined> {
  const form = (request.headers["content-type"] ?? "").startsWith(
    "application/x-www-form-urlencoded",
  );
  const entries: [string, unknown][] = form
    ? [...new URLSearchParams(request.body.toString("utf8"))]
    : Object.entries((request.json() ?? {}) as Record<string, unknown>);
  const body: Record<string, string | undefined> = {};
  for (const [name, value] of entries) {
    if (typeof value === "string") body[name.replaceAll("_", "").toLowerCase()] = value;
  }
  return body;
}

/** OAuth's error, as STS answers it. */
function stsError(error: string, description: string): HttpError {
  return new HttpError(400, { error, error_description: description });
}

/** Google's error object, as IAM Credentials answers it. */
function iamError(code: number, status: string, message: string): HttpError {
  return new HttpError(code, { error: { code, message, status } });
}
