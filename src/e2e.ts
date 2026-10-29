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
  salad: "https://api.salad.com",
  huggingFace: "https://huggingface.co",
  npm: "https://registry.npmjs.org",
  googleSts: "https://sts.googleapis.com",
  googleIamCredentials: "https://iamcredentials.googleapis.com",
  firestore: "https://firestore.googleapis.com",
} as const;

/**
 * The keys of each GPU provider's pod URLs, by its name: a template with `{id}` and `{port}` in
 * place of an origin, such as Runpod's proxy or Salad's Container Gateway.
 */
const PODS = { runpod: "runpodPods", salad: "saladPods" } as const;
type PodsKey = (typeof PODS)[keyof typeof PODS];
const PODS_KEYS: readonly string[] = Object.values(PODS);

type Origin = keyof typeof ORIGINS;

/** The fakes' origins (`http://host:port`), and the pods' URL templates, by key; all optional. */
export type Endpoints = Partial<Record<Origin | PodsKey, string>>;

/** How the e2e build reaches its fakes; see docs/development/guide.md#the-e2e-build. */
export interface Redirects {
  endpoints: Endpoints;
  /** `fetch`, with each overridden origin replaced by its fake's. */
  fetch: Fetch;
  /**
   * A GPU provider built with this `fetch`, with its pods' and Serverless queues' URLs on the
   * fakes. Its pods may run any image: the e2e pods run local images built from the sources.
   */
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
      const key = PODS[provider.name as keyof typeof PODS] as PodsKey | undefined;
      const template = key && endpoints[key];
      if (provider.pods && template) {
        provider.pods.url = async (id, port) =>
          template.replaceAll("{id}", id).replaceAll("{port}", `${port}`);
      }
      // The pinned images stand for local ones built from this commit's gateway, which serves on
      // every provider (e2e/infra/pod-images.ts).
      if (provider.pods?.unservedImages) {
        Object.assign(provider.pods, { unservedImages: undefined });
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
    const pods = PODS_KEYS.includes(key);
    if (!pods && !Object.hasOwn(ORIGINS, key)) {
      const known = [...Object.keys(ORIGINS), ...PODS_KEYS].join(", ");
      throw new Error(`${name} has an unknown endpoint "${key}"; known: ${known}.`);
    }
    if (typeof url !== "string" || !(pods ? isPodTemplate(url) : isOrigin(url))) {
      throw new Error(
        pods
          ? `${name}'s ${key} must be an http(s) URL with {id} and {port}, without a trailing slash, query or credentials.`
          : `${name}'s ${key} must be an http(s) origin, such as http://fake:8080, without a path.`,
      );
    }
    endpoints[key as Origin | PodsKey] = url;
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
