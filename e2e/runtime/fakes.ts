import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { CONTROL_PREFIX } from "../fakes/http.ts";
import type { FakeName } from "./scenario/schema.ts";

/**
 * The host side's way to the fakes: each one's origin as the host reaches it (a port Compose
 * published on 127.0.0.1, or an in-process fake in tests), its control API under `/_fake/`, always
 * with the session's control token, and HTTPS with the session's test CA for the fake GitHub.
 */

export interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** The body as JSON; undefined when it is empty or not JSON. */
  json: unknown;
}

/** An answer the caller did not expect: the fake's status and message. */
export class FakeHttpError extends Error {
  readonly status: number;
  readonly answer: Answer;

  constructor(fake: string, method: string, path: string, answer: Answer) {
    const message =
      typeof answer.json === "object" && answer.json !== null
        ? String((answer.json as { message?: unknown }).message ?? JSON.stringify(answer.json))
        : answer.body.toString("utf8").slice(0, 300);
    super(`The ${fake} fake answered ${method} ${path} with ${answer.status}: ${message}`);
    this.status = answer.status;
    this.answer = answer;
  }
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Statuses that are not errors; any 2xx by default. */
  ok?: (status: number) => boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 90_000;

export class FakeClient {
  readonly name: string;
  readonly origin: string;
  readonly #token: string | undefined;
  readonly #ca: string | undefined;

  constructor(name: string, origin: string, options: { token?: string; ca?: string } = {}) {
    this.name = name;
    this.origin = origin.replace(/\/$/, "");
    this.#token = options.token;
    this.#ca = options.ca;
  }

  /** A request to the fake's own routes, as the code under test makes them. */
  async request(method: string, path: string, options: RequestOptions = {}): Promise<Answer> {
    const answer = await send(`${this.origin}${path}`, method, options, this.#ca);
    const ok = options.ok ?? ((status: number) => status >= 200 && status < 300);
    if (!ok(answer.status)) throw new FakeHttpError(this.name, method, path, answer);
    return answer;
  }

  /** A request to the control API, `path` under `/_fake`, with the control token. */
  control(method: string, path: string, options: RequestOptions = {}): Promise<Answer> {
    return this.request(method, `${CONTROL_PREFIX}${path}`, {
      ...options,
      headers: {
        ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
        ...options.headers,
      },
    });
  }

  /** The control API's JSON answer. */
  async json<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.control(method, path, body === undefined ? {} : { body })).json as T;
  }

  /** A fresh state: no requests logged, no faults, and the fake's own reset. */
  async reset(): Promise<void> {
    await this.control("POST", "/reset");
  }

  /** The requests the fake logged, oldest first. */
  requests(): Promise<unknown[]> {
    return this.json<unknown[]>("GET", "/requests");
  }
}

/** One HTTP(S) request, with its whole answer. */
export function send(
  url: string,
  method: string,
  options: RequestOptions = {},
  ca?: string,
): Promise<Answer> {
  const target = new URL(url);
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  let payload: Buffer | undefined;
  if (options.body !== undefined) {
    payload = Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    headers["content-type"] ??= "application/json";
    headers["content-length"] = String(payload.length);
  }
  const call = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = call(
      target,
      {
        method,
        headers,
        ...(target.protocol === "https:" && ca ? { ca } : {}),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          let json: unknown;
          try {
            json = body.length > 0 ? JSON.parse(body.toString("utf8")) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body, json });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`${method} ${url} timed out.`)));
    request.on("error", reject);
    request.end(payload);
  });
}

/** The fakes a session drives, by name, and the Firestore emulator's origin. */
export interface Fakes {
  github: FakeClient;
  google: FakeClient;
  llm: FakeClient;
  openrouter: FakeClient;
  runpod: FakeClient;
  salad: FakeClient;
  npm: FakeClient;
  huggingface: FakeClient;
  /** The emulator's origin from the host, such as `http://127.0.0.1:41234`. */
  firestore: string;
}

export const FAKE_NAMES: readonly FakeName[] = [
  "github",
  "openrouter",
  "runpod",
  "salad",
  "google",
  "llm",
  "npm",
  "huggingface",
];

/** The services' origins as jobs and pods reach them on the jobs network (compose.yaml). */
export const INTERNAL = {
  github: "https://github-e2e.localhost",
  google: "http://google:8080",
  llm: "http://llm:8080",
  openrouter: "http://openrouter:8080",
  runpod: "http://runpod:8080",
  salad: "http://salad:8080",
  npm: "http://npm:8080",
  huggingface: "http://huggingface:8080",
  firestore: "http://firestore:8080",
} as const;

/**
 * `CODEMAN_E2E_ENDPOINTS` for the e2e bundle (src/e2e.ts): every service it redirects, on the
 * jobs network.
 */
export function bundleEndpoints(internal: typeof INTERNAL = INTERNAL): Record<string, string> {
  return {
    openRouter: internal.openrouter,
    runpod: internal.runpod,
    runpodServerless: internal.runpod,
    runpodPods: `${internal.runpod}/pods/{id}/{port}`,
    salad: internal.salad,
    saladPods: `${internal.salad}/pods/{id}/{port}`,
    npm: internal.npm,
    huggingFace: internal.huggingface,
    googleSts: internal.google,
    googleIamCredentials: internal.google,
    firestore: internal.firestore,
  };
}
