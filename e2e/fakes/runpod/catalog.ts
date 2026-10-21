import { HttpError, unknownFields } from "../http.ts";

/**
 * The fake's GPU catalog: `GET /v2/catalog/gpus[/{id}]`, as docs/web/runpod/list-gpu-types.md
 * and get-a-gpu-type.md describe it. The stock is one level for pods on each cloud, and the CUDA
 * versions hosts offer, each with whether one has room.
 */

export type Availability = "NONE" | "LOW" | "MEDIUM" | "HIGH";
const LEVELS: readonly Availability[] = ["NONE", "LOW", "MEDIUM", "HIGH"];

export interface CatalogGpu {
  /** The GPU type's ID, such as `NVIDIA RTX A6000`. */
  id: string;
  name: string;
  /** The Serverless GPU pool, or null. */
  pool: string | null;
  manufacturer: string;
  /** VRAM, in GB. */
  memory: number;
  /** Whether Secure Cloud and Community Cloud offer it. */
  secure: boolean;
  community: boolean;
  /** List prices in USD per hour for one GPU. */
  price: { secure: number; community: number; serverless?: number | undefined };
  maxCount: { secure: number; community: number };
  /** Pods' stock now: `NONE` makes a create fail on capacity. */
  availability: Availability;
  /** The CUDA versions hosts of this type offer, as `major.minor`. */
  cudaVersions: { version: string; available: boolean }[];
}

/** Two GPU types of docs/web/runpod/gpu-types.md, with plausible prices; scenarios set their own. */
export function defaultCatalog(): CatalogGpu[] {
  const cuda = () => [
    { version: "12.8", available: true },
    { version: "13.0", available: true },
  ];
  return [
    {
      id: "NVIDIA RTX A6000",
      name: "RTX A6000",
      pool: "AMPERE_48",
      manufacturer: "NVIDIA",
      memory: 48,
      secure: true,
      community: true,
      price: { secure: 0.49, community: 0.33, serverless: 1.22 },
      maxCount: { secure: 8, community: 4 },
      availability: "HIGH",
      cudaVersions: cuda(),
    },
    {
      id: "NVIDIA GeForce RTX 4090",
      name: "RTX 4090",
      pool: "ADA_24",
      manufacturer: "NVIDIA",
      memory: 24,
      secure: true,
      community: true,
      price: { secure: 0.69, community: 0.34, serverless: 1.1 },
      maxCount: { secure: 8, community: 4 },
      availability: "HIGH",
      cudaVersions: cuda(),
    },
  ];
}

/** `major.minor` compared numerically, so 12.11 is above 12.2. */
export function compareCuda(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split(".").map(Number);
  const [bMajor = 0, bMinor = 0] = b.split(".").map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/** The query's filters, as the catalog's routes validate them. */
interface CatalogQuery {
  availability: boolean;
  cloud: "SECURE" | "COMMUNITY";
  count: number;
  minCudaVersion: string | undefined;
  cudaVersions: string[] | undefined;
}

/** The catalog's query parameters; 400 or 422 as Runpod's rules in get-a-gpu-type.md say. */
export function catalogQuery(query: URLSearchParams): CatalogQuery {
  const include = query.getAll("include").flatMap((value) => value.split(","));
  const product = query.getAll("product").flatMap((value) => value.split(","));
  const availability = include.includes("AVAILABILITY");
  if (include.some((value) => value !== "AVAILABILITY")) {
    throw problem(422, "include must be AVAILABILITY.");
  }
  if (availability !== product.length > 0) {
    throw problem(400, "include=AVAILABILITY and product go together.");
  }
  if (product.some((value) => !["POD", "CLUSTER", "SERVERLESS"].includes(value))) {
    throw problem(422, "product must be POD, CLUSTER or SERVERLESS.");
  }
  const scoped = ["cloud", "count", "minCudaVersion", "cudaVersions"].filter((name) =>
    query.has(name),
  );
  if (!availability && scoped.length > 0) {
    throw problem(400, `${scoped.join(", ")} need include=AVAILABILITY.`);
  }
  const cloud = query.get("cloud") ?? "SECURE";
  if (cloud !== "SECURE" && cloud !== "COMMUNITY") {
    throw problem(422, "cloud must be SECURE or COMMUNITY.");
  }
  const count = Number(query.get("count") ?? 1);
  if (!Number.isInteger(count) || count < 1) throw problem(422, "count must be at least 1.");
  const minCudaVersion = query.get("minCudaVersion") ?? undefined;
  if (minCudaVersion !== undefined && !/^\d+(\.\d+)?$/.test(minCudaVersion)) {
    throw problem(422, "minCudaVersion must be major or major.minor.");
  }
  const versions = query.has("cudaVersions")
    ? query.getAll("cudaVersions").flatMap((value) => value.split(","))
    : undefined;
  if (versions?.some((version) => !/^\d+\.\d+$/.test(version))) {
    throw problem(422, "cudaVersions must be major.minor versions.");
  }
  if (minCudaVersion !== undefined && versions !== undefined) {
    throw problem(400, "minCudaVersion and cudaVersions are mutually exclusive.");
  }
  return { availability, cloud, count, minCudaVersion, cudaVersions: versions };
}

/** The CUDA versions the filters admit. */
export function cudaWithin(
  gpu: CatalogGpu,
  filter: { minCudaVersion?: string | undefined; cudaVersions?: string[] | undefined },
): CatalogGpu["cudaVersions"] {
  return gpu.cudaVersions.filter(
    ({ version }) =>
      (filter.minCudaVersion === undefined || compareCuda(version, filter.minCudaVersion) >= 0) &&
      (filter.cudaVersions === undefined || filter.cudaVersions.includes(version)),
  );
}

/** A catalog entry as Runpod's `GpuType` answers it, with availability when asked for. */
export function gpuJson(gpu: CatalogGpu, query: CatalogQuery): Record<string, unknown> {
  const json: Record<string, unknown> = {
    id: gpu.id,
    name: gpu.name,
    pool: gpu.pool,
    manufacturer: gpu.manufacturer,
    memory: gpu.memory,
    secure: gpu.secure,
    community: gpu.community,
    price: { ...gpu.price },
    maxCount: { ...gpu.maxCount },
  };
  if (gpu.price.serverless === undefined) delete (json.price as Record<string, unknown>).serverless;
  if (!query.availability) return json;
  const versions = cudaWithin(gpu, query);
  const offered =
    (query.cloud === "SECURE" ? gpu.secure : gpu.community) &&
    query.count <= (query.cloud === "SECURE" ? gpu.maxCount.secure : gpu.maxCount.community);
  const filtered = query.minCudaVersion !== undefined || query.cudaVersions !== undefined;
  const room = !filtered || versions.some(({ available }) => available);
  const availability = offered && room ? gpu.availability : "NONE";
  json.availability = availability;
  json.dataCenters = [{ id: "E2E-1", name: "E2E 1", availability }];
  // Absent when no host reports a version, as Runpod leaves it out.
  if (versions.length > 0) json.cudaVersions = versions.map((version) => ({ ...version }));
  return json;
}

/** A catalog entry from the control API's JSON, over `base` when it patches one. */
export function catalogGpuOf(value: unknown, base?: CatalogGpu): CatalogGpu {
  const given = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const unknown =
    unknownFields(given, "", GPU_FIELDS) ??
    unknownFields(given.price, "price.", ["secure", "community", "serverless"]) ??
    unknownFields(given.maxCount, "maxCount.", ["secure", "community"]) ??
    (Array.isArray(given.cudaVersions)
      ? given.cudaVersions
          .map((cuda, index) =>
            unknownFields(cuda, `cudaVersions[${index}].`, ["version", "available"]),
          )
          .find((field) => field !== undefined)
      : undefined);
  if (unknown) {
    throw new HttpError(400, { message: `A GPU type has no field ${unknown}; ${GPU_SHAPE}.` });
  }
  const gpu = { ...(base ?? {}), ...given };
  const fields = gpu as Record<string, unknown>;
  const price = (fields.price ?? {}) as Record<string, unknown>;
  const merged: CatalogGpu = {
    id: String(fields.id ?? ""),
    name: String(fields.name ?? fields.id ?? ""),
    pool: typeof fields.pool === "string" ? fields.pool : null,
    manufacturer: typeof fields.manufacturer === "string" ? fields.manufacturer : "NVIDIA",
    memory: Number(fields.memory ?? 0),
    secure: fields.secure !== false,
    community: fields.community !== false,
    price: {
      secure: Number(price.secure ?? 0),
      community: Number(price.community ?? 0),
      serverless: price.serverless === undefined ? undefined : Number(price.serverless),
    },
    maxCount: (fields.maxCount as CatalogGpu["maxCount"]) ?? { secure: 8, community: 4 },
    availability: (fields.availability as Availability) ?? "HIGH",
    cudaVersions: (fields.cudaVersions as CatalogGpu["cudaVersions"]) ?? [],
  };
  const prices = [merged.price.secure, merged.price.community, merged.price.serverless ?? 0];
  if (
    merged.id === "" ||
    !(merged.memory >= 0) ||
    prices.some((price) => !Number.isFinite(price) || price < 0) ||
    !LEVELS.includes(merged.availability) ||
    !Array.isArray(merged.cudaVersions) ||
    merged.cudaVersions.some(
      (cuda) => !/^\d+\.\d+$/.test(String(cuda?.version)) || typeof cuda.available !== "boolean",
    )
  ) {
    throw new HttpError(400, { message: `${GPU_SHAPE[0]?.toUpperCase()}${GPU_SHAPE.slice(1)}.` });
  }
  return merged;
}

const GPU_FIELDS = [
  "id",
  "name",
  "pool",
  "manufacturer",
  "memory",
  "secure",
  "community",
  "price",
  "maxCount",
  "availability",
  "cudaVersions",
];
const GPU_SHAPE =
  "a GPU type has id, and may have name, pool, manufacturer, memory, secure, community, price {secure, community, serverless}, maxCount {secure, community}, availability (NONE, LOW, MEDIUM, HIGH) and cudaVersions [{version, available}]";

/** Runpod's RFC 9457 error: `title`, `status`, `detail`, and `errors` for validation. */
export function problem(status: number, detail: string, errors?: string[]): HttpError {
  return new HttpError(
    status,
    { title: TITLES[status] ?? "Error", status, detail, ...(errors ? { errors } : {}) },
    { "content-type": "application/problem+json" },
  );
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  422: "Unprocessable Entity",
};
