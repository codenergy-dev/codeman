import { createHmac, type KeyObject, randomBytes, verify } from "node:crypto";
import { HttpError } from "../http.ts";

/**
 * Tokens and permissions as GitHub enforces them for GitHub Apps and `GITHUB_TOKEN`: a token
 * holds a level per permission, such as `issues: write`, for some repositories. The endpoints
 * each permission covers follow docs/web/github/permissions-required-for-github-apps.md and the
 * page it summarizes.
 */

/** GitHub's values; `admin` exists for a few permissions and covers `write`. */
export type Level = "read" | "write" | "admin";

/** By GitHub's names: `contents`, `issues`, `pull_requests`, `metadata`, `actions`, `workflows`… */
export type Permissions = Record<string, Level>;

/** What an endpoint needs: one of `permission`'s names, at `level` or above. */
export interface Need {
  permission: string | readonly string[];
  level: "read" | "write";
}

export const FORBIDDEN = "Resource not accessible by integration";
export const DOCS = "https://docs.github.com/rest";

/** A GitHub error answer, with headers when GitHub sends some, such as the permissions needed. */
export class GitHubError extends HttpError {
  constructor(status: number, message: string, extra: Record<string, unknown> = {}, headers = {}) {
    super(status, { message, ...extra, documentation_url: DOCS, status: String(status) }, headers);
    this.message = message;
  }
}

export const notFound = () => new GitHubError(404, "Not Found");
export const unprocessable = (message: string, extra: Record<string, unknown> = {}) =>
  new GitHubError(422, message, extra);

/** Whether `permissions` grant `name` at `level`. */
export function grants(permissions: Permissions, name: string, level: "read" | "write"): boolean {
  const held = permissions[name];
  if (held === "admin" || held === "write") return true;
  return held === "read" && level === "read";
}

/** The 403 GitHub answers a token without the permission an endpoint needs. */
export function forbidden(need: Need): GitHubError {
  const names = typeof need.permission === "string" ? [need.permission] : need.permission;
  return new GitHubError(
    403,
    FORBIDDEN,
    {},
    { "x-accepted-github-permissions": names.map((name) => `${name}=${need.level}`).join("; ") },
  );
}

/** The credential of an `Authorization` header: `token`, `Bearer`, or Basic's password. */
export function credential(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme = "", value = ""] = header.trim().split(/\s+/, 2);
  const kind = scheme.toLowerCase();
  if (kind === "token" || kind === "bearer") return value || undefined;
  if (kind === "basic") {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    return (colon < 0 ? decoded : decoded.slice(colon + 1)) || undefined;
  }
  return undefined;
}

/** A token value shaped like GitHub's installation and `GITHUB_TOKEN` tokens. */
export function tokenValue(): string {
  return `ghs_${randomBytes(27).toString("base64url").replace(/[-_]/g, "x").slice(0, 36)}`;
}

export interface Jwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signed: string;
  signature: Buffer;
}

/** A JWT's parts, or undefined when it is not one. */
export function decodeJwt(token: string): Jwt | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const [header = "", payload = "", signature = ""] = parts;
    return {
      header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      signed: `${header}.${payload}`,
      signature: Buffer.from(signature, "base64url"),
    };
  } catch {
    return undefined;
  }
}

/**
 * Checks an App's JWT as GitHub does: RS256 by the App's key, `iat` not in the future, `exp`
 * past now and at most 10 minutes after `iat`. Returns the problem, or undefined.
 */
export function jwtProblem(jwt: Jwt, key: KeyObject, nowSeconds: number): string | undefined {
  if (jwt.header.alg !== "RS256") return "A JSON web token could not be decoded";
  if (!verify("sha256", Buffer.from(jwt.signed), key, jwt.signature)) {
    return "A JSON web token could not be decoded";
  }
  const { iat, exp } = jwt.payload;
  if (typeof iat !== "number" || typeof exp !== "number") {
    return "A JSON web token could not be decoded";
  }
  if (iat > nowSeconds + 60)
    return "'Issued at' claim ('iat') must be an Integer representing a time in the past.";
  if (exp <= nowSeconds)
    return "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires.";
  if (exp - iat > 660) return "'Expiration time' claim ('exp') is too far in the future.";
  return undefined;
}

/** An HS256 JWT, for the runtime tokens `@actions/artifact` decodes without checking. */
export function signJwt(payload: Record<string, unknown>, secret: Buffer): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

/** A token's value, shortened for logs and violations. */
export function masked(token: string): string {
  return token.length <= 8 ? "****" : `${token.slice(0, 4)}…${token.slice(-4)}`;
}
