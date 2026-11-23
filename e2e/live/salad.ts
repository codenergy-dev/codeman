import { randomBytes } from "node:crypto";
import type { Fetch } from "../../src/budget.ts";
import { type GpuAccount, isHostKind, type PodSpec } from "../../src/inference/gpu.ts";
import {
  containerGroupRequest,
  memoryGb,
  Salad,
  type SaladGpuClass,
} from "../../src/inference/salad.ts";
import type { Candidate, CheckProvider } from "./check.ts";

/**
 * The pod check on SaladCloud (step 5 of the plan to run the e2e suite on GitHub's runners,
 * decisions 13 to 16): Codeman's own adapter, at High priority, with the GPU class the check
 * takes from Salad's GPU classes and availability. The reads the adapter keeps private are
 * repeated here (docs/web/salad/list-the-gpu-classes.md, docs/web/salad/get-gpu-availability.md,
 * docs/web/salad/list-container-group-instances.md).
 */

const API = "https://api.salad.com/api/public";

/** The priority of the check's container groups (decision 14): no other workload preempts it. */
export const SALAD_PRIORITY = "high";

/**
 * The memory of the GPU classes the check takes, in GB: as on Runpod, enough for a 0.5B model and
 * not much more, and far below the K/V cache the `unfit` check asks.
 */
export const SALAD_MIN_GB = 16;
export const SALAD_MAX_GB = 24;

/** Salad's names for an organization and a project (docs/web/salad/get-gpu-availability.md). */
export const SALAD_NAME = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** Classes of AMD GPUs, which vLLM's and Ollama's CUDA images cannot use. */
const NOT_NVIDIA = /\b(AMD|Radeon|Instinct|RX ?\d{3,4})\b/i;

/** The fields of Salad's `GpuClass` the check reads. */
interface GpuClass {
  id?: unknown;
  name?: unknown;
  gpu_class_type?: unknown;
  prices?: { priority?: unknown; price?: unknown }[] | null;
}

/** The check's view of Salad, for `podCheck`. */
export function saladProvider(account: Required<GpuAccount>, fetchFn: Fetch): CheckProvider {
  const salad = new Salad(account, fetchFn);
  const request = async (path: string, method = "GET", body?: unknown): Promise<unknown> => {
    const response = await fetchFn(`${API}${path}`, {
      method,
      headers: {
        "Salad-Api-Key": account.key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      // No path: it names the organization and the project.
      throw new Error(`Salad ${method} failed with ${response.status}.`);
    }
    return response.json();
  };
  const organization = `/organizations/${encodeURIComponent(account.organization)}`;
  const containers = `${organization}/projects/${encodeURIComponent(account.project)}/containers`;
  const nodes = new NodeWatch();

  return {
    name: "salad",
    host: salad.pods,
    account,
    priority: SALAD_PRIORITY,
    // Salad's hosts are community ones: its secure hosts need a contract (decision 12).
    cloud: "community",
    async read(): Promise<(Candidate | undefined)[]> {
      const listed = (await request(`${organization}/gpu-classes`)) as { items?: GpuClass[] };
      const classes = (listed.items ?? []).filter((gpu) => {
        const memory = typeof gpu.name === "string" ? memoryGb(gpu.name) : undefined;
        return (
          typeof gpu.id === "string" &&
          typeof gpu.name === "string" &&
          !NOT_NVIDIA.test(gpu.name) &&
          memory !== undefined &&
          memory >= SALAD_MIN_GB &&
          memory <= SALAD_MAX_GB
        );
      });
      return Promise.all(
        classes.map(async (gpu): Promise<Candidate | undefined> => {
          const name = gpu.name as string;
          const hourly = Number(
            gpu.prices?.find((entry) => entry.priority === SALAD_PRIORITY)?.price,
          );
          if (!(hourly > 0)) return undefined;
          let available: number | undefined;
          try {
            const room = (await request(
              `${organization}/availability/sce-gpu-availability`,
              "POST",
              { gpu_classes: [gpu.id] },
            )) as { available_gpu_high?: unknown };
            const count = room.available_gpu_high;
            available = typeof count === "number" && count >= 0 ? count : undefined;
          } catch {
            return undefined;
          }
          return {
            gpu: name,
            cloud:
              typeof gpu.gpu_class_type === "string" && isHostKind(gpu.gpu_class_type)
                ? gpu.gpu_class_type
                : "community",
            hourly,
            memoryGb: memoryGb(name),
            room: (available ?? 0) > 0,
            roomFields: { available_nodes: available },
          };
        }),
      );
    },
    observe: async (id) => {
      nodes.record(id, await instances(request, containers, id));
    },
    moved: async (id) => {
      // The group may be gone already: what was seen before still tells.
      nodes.record(id, await instances(request, containers, id).catch(() => []));
      return nodes.moved(id);
    },
    async probe(spec: PodSpec, hide: (value: string) => void): Promise<ProbeAnswer[]> {
      const listed = (await request(`${organization}/gpu-classes`)) as {
        items?: SaladGpuClass[];
      };
      const gpu = (listed.items ?? []).find((one) => one.name === spec.gpuType);
      if (!gpu) throw new Error("Salad no longer lists the probe's GPU class.");
      const full = containerGroupRequest(spec, gpu, groupName());
      const tags = Object.fromEntries(
        TAGS.flatMap((name) => (spec.env[name] ? [[name, spec.env[name]]] : [])),
      );
      const answers: ProbeAnswer[] = [];
      for (const { variant, body } of probeBodies(full, tags)) {
        hide(String(body.name));
        answers.push(await probeOne(fetchFn, account.key, containers, variant, body));
      }
      return answers;
    },
  };
}

/** The variables the check's cleanup lists its groups by, which every variant keeps. */
const TAGS = ["CODEMAN_ORGANIZATION", "CODEMAN_POOL"] as const;

/** A container group's name, as the adapter makes one. */
function groupName(): string {
  return `codeman-${randomBytes(8).toString("hex")}`;
}

/** What Salad answered to one variant of the creation's body. */
export interface ProbeAnswer {
  variant: string;
  /** The HTTP status, or undefined when the request itself failed. */
  status: number | undefined;
  /** The answer's body, up to 8 KB, for a refusal; never printed as such. */
  body: string;
  contentType: string | undefined;
  /** For a group Salad created: whether the probe deleted it. */
  deleted?: boolean;
}

/**
 * The variants of the adapter's body that the `probe` check sends, to find what Salad refuses:
 * each one stopped (`autostart_policy: false`), so no instance starts and nothing is billed, under
 * a name of its own, and with the variables the cleanup lists its groups by. In order: the whole
 * body, then without one part each, then smaller resources, then the least Salad requires.
 */
export function probeBodies(
  full: Record<string, unknown>,
  tags: Record<string, string>,
): { variant: string; body: Record<string, unknown> }[] {
  const container = full.container as Record<string, unknown>;
  const resources = container.resources as Record<string, unknown>;
  const basic = {
    cpu: resources.cpu,
    memory: resources.memory,
    gpu_classes: resources.gpu_classes,
  };
  const variant = (
    name: string,
    change: (body: Record<string, unknown>, container: Record<string, unknown>) => void,
  ) => {
    const body = structuredClone(full);
    change(body, body.container as Record<string, unknown>);
    body.name = groupName();
    body.autostart_policy = false;
    return { variant: name, body };
  };
  return [
    variant("full", () => {}),
    variant("no-networking", (body) => {
      delete body.networking;
    }),
    variant("no-command", (_, inner) => {
      delete inner.command;
    }),
    variant("tags-only-env", (_, inner) => {
      inner.environment_variables = { ...tags };
    }),
    variant("restart-always", (body) => {
      body.restart_policy = "always";
    }),
    variant("basic-resources", (_, inner) => {
      inner.resources = { ...basic };
    }),
    variant("small-resources", (_, inner) => {
      inner.resources = { ...(inner.resources as object), cpu: 4, memory: 16_384 };
    }),
    variant("minimal", (body, inner) => {
      for (const key of Object.keys(body)) {
        if (!["name", "container", "replicas", "restart_policy"].includes(key)) delete body[key];
      }
      for (const key of Object.keys(inner)) {
        if (key !== "image") delete inner[key];
      }
      inner.environment_variables = { ...tags };
      inner.resources = { ...basic };
    }),
  ];
}

/** Sends one variant; deletes the group when Salad created it. */
async function probeOne(
  fetchFn: Fetch,
  key: string,
  containers: string,
  variant: string,
  body: Record<string, unknown>,
): Promise<ProbeAnswer> {
  const headers = { "Salad-Api-Key": key, "Content-Type": "application/json" };
  let response: Response;
  try {
    response = await fetchFn(`${API}${containers}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { variant, status: undefined, body: "", contentType: undefined };
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 8_192);
    return { variant, status: response.status, body: text, contentType };
  }
  await response.body?.cancel();
  let deleted = false;
  try {
    const gone = await fetchFn(`${API}${containers}/${encodeURIComponent(String(body.name))}`, {
      method: "DELETE",
      headers: { "Salad-Api-Key": key },
      signal: AbortSignal.timeout(30_000),
    });
    await gone.body?.cancel();
    deleted = gone.ok || gone.status === 404;
  } catch {
    deleted = false;
  }
  return { variant, status: response.status, body: "", contentType, deleted };
}

/** A group's instances, as the machine each is on and its state; none when Salad lists none. */
async function instances(
  request: (path: string) => Promise<unknown>,
  containers: string,
  id: string,
): Promise<{ machine: string; state: string }[]> {
  const listed = (await request(`${containers}/${encodeURIComponent(id)}/instances`)) as {
    instances?: { machine_id?: unknown; state?: unknown }[];
  };
  return (listed.instances ?? []).flatMap(({ machine_id, state }) =>
    typeof machine_id === "string" && typeof state === "string"
      ? [{ machine: machine_id, state }]
      : [],
  );
}

/**
 * The machines each group's instance was seen on. A group of one replica whose instance is seen on
 * a second machine moved: Salad lost the first node and placed the pod on another, which a pod's
 * own exit does not cause, its group never restarting it (`restart_policy: never`; risk 1 of the
 * plan for Salad pods). A node lost with no replacement seen yet is not told apart.
 */
export class NodeWatch {
  readonly #machines = new Map<string, Set<string>>();

  record(id: string, seen: readonly { machine: string; state: string }[]): void {
    const machines = this.#machines.get(id) ?? new Set<string>();
    for (const { machine, state } of seen) {
      if (state !== "allocating") machines.add(machine);
    }
    this.#machines.set(id, machines);
  }

  moved(id: string): boolean {
    return (this.#machines.get(id)?.size ?? 0) > 1;
  }
}
