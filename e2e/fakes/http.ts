import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import type { TLSSocket } from "node:tls";

/**
 * What every fake of the e2e suite shares: an HTTP(S) server, routes by method and path, a log
 * of the requests for assertions, faults to inject per route, and a control API under
 * `/_fake/` for the e2e runtime. Each fake owns one `FakeServer` and adds its routes to it.
 */

/** Where a fake's control API lives: for the e2e runtime, never for the code under test. */
export const CONTROL_PREFIX = "/_fake";

/** How much of a request's body a fake reads; a larger one answers 413. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

export interface FakeRequest {
  readonly method: string;
  /** The path, still percent-encoded, without the query. */
  readonly path: string;
  readonly query: URLSearchParams;
  /** The path's `{name}` parts, decoded. */
  readonly params: Readonly<Record<string, string>>;
  readonly headers: IncomingHttpHeaders;
  /** The origin the client used: the scheme and the `Host` header. */
  readonly origin: string;
  readonly body: Buffer;
  /** The token of an `Authorization: Bearer` header. */
  readonly bearer: string | undefined;
  /** The request itself, for a handler that answers on its own, such as a stream. */
  readonly raw: IncomingMessage;
  /** The body as JSON; a 400 when it is not. */
  json(): unknown;
}

export interface Reply {
  status: number;
  /** Sent as JSON, unless it is a string or bytes. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** A route's answer; undefined when the handler wrote the response itself. */
export type Handler = (
  request: FakeRequest,
  response: ServerResponse,
) => Reply | undefined | Promise<Reply | undefined>;

/** Thrown by a handler to answer with `status` and `body`. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** A JSON answer. */
export function json(body: unknown, status = 200, headers?: Record<string, string>): Reply {
  return { status, body, headers };
}

/** A fault for the requests a route pattern matches, in place of or before the route's answer. */
export interface Fault {
  /** Any method when absent. */
  method?: string;
  /** A path pattern, as routes have. */
  path: string;
  /** Answers with this status, and `body`, instead of the route. */
  status?: number;
  body?: unknown;
  /** Waits this long first. */
  delayMs?: number;
  /** Closes the connection without an answer. */
  drop?: boolean;
  /** How many requests it applies to; every one when absent. */
  times?: number;
}

export interface LoggedRequest {
  method: string;
  /** The path, percent-encoded, without the query. */
  path: string;
  query: string;
  /** The route that answered, as `METHOD pattern`; undefined when none matched. */
  route: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
  /** The status sent; 0 when the connection closed without an answer. */
  status: number;
  /** When it arrived, in milliseconds since the epoch. */
  at: number;
}

export interface ListenOptions {
  /** 0, the default, picks a free port. */
  port?: number;
  /** The loopback by default. */
  host?: string;
  /** Serves HTTPS with this key and certificate, both PEM. */
  tls?: { key: string | Buffer; cert: string | Buffer };
  /** When set, the control API requires `Authorization: Bearer <controlToken>`. */
  controlToken?: string;
}

/** What a fake's module exports for `e2e/fakes/main.ts`: the fake, set up from the environment. */
export interface FakeModule {
  fromEnv(env: NodeJS.ProcessEnv): FakeServer | Promise<FakeServer>;
}

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  handler: Handler;
  control: boolean;
}

export class FakeServer {
  readonly name: string;
  readonly #routes: Route[] = [];
  readonly #faults: (Fault & { regex: RegExp })[] = [];
  readonly #log: LoggedRequest[] = [];
  readonly #resets: (() => void)[] = [];
  #controlToken: string | undefined;
  #server: Server | undefined;

  constructor(name: string) {
    this.name = name;
    this.control("GET", "/requests", () => json(this.#log));
    this.control("DELETE", "/requests", () => {
      this.#log.length = 0;
      return { status: 204 };
    });
    this.control("POST", "/faults", (request) => {
      this.fault(faultOf(request.json()));
      return { status: 204 };
    });
    this.control("DELETE", "/faults", () => {
      this.clearFaults();
      return { status: 204 };
    });
    this.control("POST", "/reset", () => {
      this.reset();
      return { status: 204 };
    });
  }

  /**
   * Answers `method` requests whose path matches `pattern`, such as `/repos/{owner}/{repo}`: a
   * `{name}` matches one segment, `{name*}` one or more. The first route added wins.
   */
  route(method: string, pattern: string, handler: Handler): this {
    this.#routes.push({ method, pattern, regex: compile(pattern), handler, control: false });
    return this;
  }

  /** A route of the control API, under `/_fake`: never logged nor faulted. */
  control(method: string, pattern: string, handler: Handler): this {
    const full = `${CONTROL_PREFIX}${pattern}`;
    this.#routes.push({ method, pattern: full, regex: compile(full), handler, control: true });
    return this;
  }

  fault(fault: Fault): void {
    this.#faults.push({ ...fault, regex: compile(fault.path) });
  }

  clearFaults(): void {
    this.#faults.length = 0;
  }

  /** The requests to the fake's routes, oldest first; the control API's are not in it. */
  get requests(): readonly LoggedRequest[] {
    return this.#log;
  }

  /** Runs on each reset, to clear the fake's own state. */
  onReset(reset: () => void): void {
    this.#resets.push(reset);
  }

  /** A fresh state: no requests logged, no faults, and each fake's own reset. */
  reset(): void {
    this.#log.length = 0;
    this.clearFaults();
    for (const reset of this.#resets) reset();
  }

  /** Starts serving, and returns the origin to reach it at, such as `http://127.0.0.1:41234`. */
  async listen(options: ListenOptions = {}): Promise<string> {
    const host = options.host ?? "127.0.0.1";
    this.#controlToken = options.controlToken;
    const listener = (request: IncomingMessage, response: ServerResponse) => {
      this.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          send(
            response,
            json({ message: error instanceof Error ? error.message : String(error) }, 500),
          );
        } else response.destroy();
      });
    };
    const server = options.tls
      ? createHttpsServer({ key: options.tls.key, cert: options.tls.cert }, listener)
      : createHttpServer(listener);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, host, resolve);
    });
    this.#server = server;
    const { port } = server.address() as AddressInfo;
    const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    return `${options.tls ? "https" : "http"}://${shown}:${port}`;
  }

  async close(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  async handle(raw: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(raw.url ?? "/", "http://fake");
    const method = raw.method ?? "GET";
    const match = this.#match(method, url.pathname);
    const body = await readBody(raw).catch(() => undefined);
    const entry: LoggedRequest | undefined = match?.route.control
      ? undefined
      : {
          method,
          path: url.pathname,
          query: url.search,
          route: match ? `${match.route.method} ${match.route.pattern}` : undefined,
          headers: raw.headers,
          body: body?.toString("utf8") ?? "",
          status: 0,
          at: Date.now(),
        };
    if (entry) {
      this.#log.push(entry);
      response.once("close", () => {
        entry.status = response.headersSent ? response.statusCode : 0;
      });
    }
    if (body === undefined) return send(response, json({ message: "Request too large." }, 413));
    if (match?.route.control && !this.#controls(raw)) {
      return send(response, json({ message: "The control API needs its token." }, 401));
    }
    if (!match?.route.control) {
      const fault = this.#fault(method, url.pathname);
      if (fault?.delayMs) await sleep(fault.delayMs);
      if (fault?.drop) {
        raw.socket.destroy();
        return;
      }
      if (fault?.status) {
        return send(response, json(fault.body ?? { message: "Injected fault." }, fault.status));
      }
    }
    if (!match) return send(response, json({ message: "Not Found" }, 404));
    const scheme = (raw.socket as TLSSocket).encrypted ? "https" : "http";
    const authorization = raw.headers.authorization ?? "";
    const request: FakeRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      params: match.params,
      headers: raw.headers,
      origin: `${scheme}://${raw.headers.host ?? "localhost"}`,
      body,
      bearer: /^Bearer (\S+)$/i.exec(authorization)?.[1],
      raw,
      json: () => {
        try {
          return JSON.parse(body.toString("utf8"));
        } catch {
          throw new HttpError(400, { message: "The body is not JSON." });
        }
      },
    };
    try {
      const reply = await match.route.handler(request, response);
      if (reply) send(response, reply);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      send(response, json(error.body, error.status));
    }
  }

  #match(
    method: string,
    path: string,
  ): { route: Route; params: Record<string, string> } | undefined {
    for (const route of this.#routes) {
      if (route.method !== method) continue;
      const found = route.regex.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      for (const [name, value] of Object.entries(found.groups ?? {})) {
        params[name] = decodeURIComponent(value);
      }
      return { route, params };
    }
    return undefined;
  }

  /** The first fault for this request, counted against its `times`. */
  #fault(method: string, path: string): Fault | undefined {
    const index = this.#faults.findIndex(
      (fault) => (!fault.method || fault.method === method) && fault.regex.test(path),
    );
    const fault = this.#faults[index];
    if (!fault) return undefined;
    if (fault.times !== undefined && --fault.times <= 0) this.#faults.splice(index, 1);
    return fault;
  }

  #controls(request: IncomingMessage): boolean {
    return !this.#controlToken || request.headers.authorization === `Bearer ${this.#controlToken}`;
  }
}

/** A pattern's regular expression: literal text, `{name}` for a segment, `{name*}` for more. */
function compile(pattern: string): RegExp {
  let source = "";
  let last = 0;
  for (const part of pattern.matchAll(/\{(\w+)(\*?)\}/g)) {
    source += literal(pattern.slice(last, part.index));
    source += `(?<${part[1]}>${part[2] ? ".+?" : "[^/]+?"})`;
    last = part.index + part[0].length;
  }
  return new RegExp(`^${source}${literal(pattern.slice(last))}$`);
}

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A fault from the control API's JSON; a 400 when a field has the wrong type. */
function faultOf(value: unknown): Fault {
  const fault = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const optional = (name: string, type: string) =>
    fault[name] === undefined || typeof fault[name] === type;
  if (
    typeof fault.path !== "string" ||
    !optional("method", "string") ||
    !optional("status", "number") ||
    !optional("delayMs", "number") ||
    !optional("drop", "boolean") ||
    !optional("times", "number")
  ) {
    throw new HttpError(400, {
      message: "A fault has a path, and may have method, status, body, delayMs, drop and times.",
    });
  }
  return fault as unknown as Fault;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("The request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(reply.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers).end();
    return;
  }
  const bytes = typeof reply.body === "string" || reply.body instanceof Uint8Array;
  headers["content-type"] ??= bytes ? "text/plain; charset=utf-8" : "application/json";
  response
    .writeHead(reply.status, headers)
    .end(bytes ? (reply.body as string | Uint8Array) : JSON.stringify(reply.body));
}
