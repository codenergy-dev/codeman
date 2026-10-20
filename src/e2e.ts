import type { Fetch } from "./budget.ts";
import type { GpuProvider } from "./inference/gpu.ts";

/**
 * True only in the e2e build (`npm run build:e2e`), which esbuild's `define` sets; false in the
 * published `dist/`, and undefined when Node runs the sources, as the unit tests do.
 */
declare const __CODEMAN_E2E__: boolean | undefined;

/** The origins of the services an e2e run reaches through its fakes instead, by key. */
const ORIGINS = {
  openRouter: "https://openrouter.ai",
  runpod: "https://api.runpod.io",
  runpodServerless: "https://api.runpod.ai",
  huggingFace: "https://huggingface.co",
  npm: "https://registry.npmjs.org",
  googleSts: "https://sts.googleapis.com",
  googleIamCredentials: "https://iamcredentials.googleapis.com",
  firestore: "https://firestore.googleapis.com",
} as const;

/** The key of Runpod's pod URLs, a template with `{id}` and `{port}` in place of an origin. */
const PODS = "runpodPods";

type Origin = keyof typeof ORIGINS;

/** The fakes' origins (`http://host:port`), and the pods' URL template, by key; all optional. */
export type Endpoints = Partial<Record<Origin | typeof PODS, string>>;

/** How the e2e build reaches its fakes; see docs/development/guide.md#the-e2e-build. */
export interface Redirects {
  endpoints: Endpoints;
  /** `fetch`, with each overridden origin replaced by its fake's. */
  fetch: Fetch;
  /** A GPU provider built with this `fetch`, with its pods' and Serverless queues' URLs on the fakes. */
  gpu<T extends GpuProvider>(provider: T): T;
}

/**
 * The e2e build's redirects, from the `CODEMAN_E2E_ENDPOINTS` variable; undefined anywhere else.
 * The published build compiles the condition to `false`, and esbuild drops `redirects`, so
 * `dist/` holds no way to redirect a credential. `scripts/build.ts` checks it.
 */
export const E2E: Redirects | undefined =
  typeof __CODEMAN_E2E__ !== "undefined" && __CODEMAN_E2E__ ? redirects(process.env) : undefined;

/** The redirects `env`'s `CODEMAN_E2E_ENDPOINTS` asks for, as JSON; throws unless it is valid. */
export function redirects(env: NodeJS.ProcessEnv, fetchFn: Fetch = fetch): Redirects {
  const endpoints = parseEndpoints(env.CODEMAN_E2E_ENDPOINTS);
  const targets = new Map<string, string>();
  for (const [key, origin] of Object.entries(ORIGINS)) {
    const target = endpoints[key as Origin];
    if (target) targets.set(origin, target);
  }
  const redirect = (url: string): string => {
    const parsed = URL.parse(url);
    const target = parsed && targets.get(parsed.origin);
    return target && parsed ? `${target}${parsed.pathname}${parsed.search}${parsed.hash}` : url;
  };
  const redirected: Fetch = (input, init) =>
    fetchFn(
      typeof input === "string" || input instanceof URL ? redirect(String(input)) : input,
      init,
    );
  return {
    endpoints,
    fetch: redirected,
    gpu: (provider) => {
      const template = endpoints[PODS];
      if (provider.pods && template) {
        provider.pods.url = (id, port) =>
          template.replaceAll("{id}", id).replaceAll("{port}", `${port}`);
      }
      const serverless = provider.serverless;
      if (serverless) {
        const queueUrl = serverless.queueUrl.bind(serverless);
        serverless.queueUrl = (id) => redirect(queueUrl(id));
      }
      return provider;
    },
  };
}

function parseEndpoints(text: string | undefined): Endpoints {
  const name = "CODEMAN_E2E_ENDPOINTS";
  if (!text) throw new Error(`The e2e build needs ${name}, the fakes' endpoints as JSON.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object of endpoints by key.`);
  }
  const endpoints: Endpoints = {};
  for (const [key, url] of Object.entries(value)) {
    if (key !== PODS && !Object.hasOwn(ORIGINS, key)) {
      const known = [...Object.keys(ORIGINS), PODS].join(", ");
      throw new Error(`${name} has an unknown endpoint "${key}"; known: ${known}.`);
    }
    if (typeof url !== "string" || !(key === PODS ? isPodTemplate(url) : isOrigin(url))) {
      throw new Error(
        key === PODS
          ? `${name}'s ${key} must be an http(s) URL with {id} and {port}, without a trailing slash, query or credentials.`
          : `${name}'s ${key} must be an http(s) origin, such as http://fake:8080, without a path.`,
      );
    }
    endpoints[key as Origin | typeof PODS] = url;
  }
  return endpoints;
}

/** An http(s) origin as `URL` writes it: no credentials, path, query or trailing slash. */
function isOrigin(text: string): boolean {
  const url = URL.parse(text);
  return !!url && (url.protocol === "http:" || url.protocol === "https:") && url.origin === text;
}

/** A pod's URL with `{id}` and `{port}`, which callers append paths to. */
function isPodTemplate(text: string): boolean {
  if (!text.includes("{id}") || !text.includes("{port}")) return false;
  const sample = text.replaceAll("{id}", "pod").replaceAll("{port}", "8000");
  const url = URL.parse(sample);
  return (
    !!url &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    !sample.includes("?") &&
    !sample.includes("#") &&
    !sample.endsWith("/")
  );
}
