import { randomBytes } from "node:crypto";
import type { Fetch } from "../budget.ts";
import {
  DEFAULT_HOSTS,
  type GpuAccount,
  type GpuProvider,
  type HostKind,
  isHostKind,
  type Pod,
  type PodHost,
  type PodSpec,
  type PodStatus,
} from "./gpu.ts";
import { IMAGES_BEFORE_SALAD } from "./images.ts";
import { describeProblem } from "./runpod.ts";

const API = "https://api.salad.com/api/public";
const GB = 1024 ** 3;

/** The priorities of a container group, highest first, as Salad's API names them. */
export const SALAD_PRIORITIES = ["high", "medium", "low", "batch"] as const;

/**
 * What a pod's container asks for beside its GPU, which the GPU's price includes: within the
 * GPU class's bounds when it lists them, else within Salad's (1 to 16 vCPU, 1 to 60 GB).
 */
const VCPU = 8;
const MEMORY_MB = 32 * 1024;
/** A container's disk, in GB (docs/web/salad/disk-space.md). */
const MAX_DISK_GB = 250;

/** Group states as Salad names them, in Codeman's terms; `running` waits for a running instance. */
const STATUS: Record<string, PodStatus> = {
  pending: "starting",
  deploying: "starting",
  running: "running",
  stopped: "stopped",
  succeeded: "stopped",
  failed: "failed",
};

/** The fields of Salad's `GpuClass` that Codeman reads. See docs/web/salad/list-the-gpu-classes.md. */
interface SaladGpuClass {
  id: string;
  name: string;
  gpu_class_type?: string;
  prices?: { priority?: string | null; price?: string }[];
  min_vcpu?: number;
  max_vcpu?: number;
  /** In MB. */
  min_ram?: number;
  max_ram?: number;
  /** In bytes. */
  min_storage?: number;
  max_storage?: number;
}

/** The fields of Salad's `ContainerGroup` that Codeman reads. See docs/web/salad/get-container-group.md. */
interface SaladGroup {
  name: string;
  display_name?: string;
  create_time: string;
  priority?: string | null;
  container?: {
    image?: string;
    environment_variables?: Record<string, string> | null;
    resources?: { gpu_classes?: string[] | null };
  };
  current_state?: { status?: string; instance_status_counts?: { running_count?: number } };
  networking?: { dns?: string } | null;
}

/**
 * SaladCloud's Container Engine, for pods: each pod is a container group of one replica, in the
 * organization and project of the account (docs/web/salad/). Its only key is the user's, which
 * reaches every organization they belong to, so it never goes to a pod: a pod ends by exiting,
 * since its group never restarts it (decision 4 of the plan for Salad pods). Salad has no billing
 * API, so pods have no billing.
 */
export class Salad implements GpuProvider {
  readonly name = "salad";
  readonly pods: PodHost;
  readonly #apiKey: string;
  readonly #fetch: Fetch;
  readonly #organization: string;
  readonly #project: string;
  /** The organization's GPU classes, read once; a failed read is not kept. */
  #classes: Promise<SaladGpuClass[]> | undefined;

  constructor(account: GpuAccount, fetchFn: Fetch = fetch) {
    if (!account.organization || !account.project) {
      throw new Error(
        "Salad needs its organization and project names beside its key: set CODEMAN_SALAD_ORGANIZATION and CODEMAN_SALAD_PROJECT.",
      );
    }
    this.#apiKey = account.key;
    this.#fetch = fetchFn;
    this.#organization = account.organization;
    this.#project = account.project;
    this.pods = {
      unservedImages: IMAGES_BEFORE_SALAD,
      price: async (gpuType, host = "secure", priority) =>
        price(await this.#class(gpuType, [host]), priority),
      memory: async (gpuType) => memoryGb((await this.#class(gpuType)).name),
      create: (spec) => this.#create(spec),
      get: (id) => this.#get(id),
      list: (env) => this.#list(env),
      terminate: (id) => this.#terminate(id),
      url: (id) => this.#url(id),
    };
  }

  /** `GET /organizations/{organization}/gpu-classes`, once. */
  #gpuClasses(): Promise<SaladGpuClass[]> {
    if (!this.#classes) {
      this.#classes = (
        this.#request(
          `/organizations/${encodeURIComponent(this.#organization)}/gpu-classes`,
        ) as Promise<{ items?: SaladGpuClass[] }>
      ).then((list) => list.items ?? []);
      this.#classes.catch(() => {
        this.#classes = undefined;
      });
    }
    return this.#classes;
  }

  /**
   * The GPU class of this name, ignoring case. Throws when Salad has none, or when it runs on a
   * kind of host that `hosts` does not allow.
   */
  async #class(gpuType: string, hosts?: readonly HostKind[]): Promise<SaladGpuClass> {
    const wanted = gpuType.trim().toLowerCase();
    const found = (await this.#gpuClasses()).find(
      (gpu) => gpu.name.trim().toLowerCase() === wanted,
    );
    if (!found) {
      throw new Error(
        `Salad has no GPU class "${gpuType}". \`gpu\` takes a class's name, such as "RTX 4090 (24 GB)"; see https://salad.com/pricing.`,
      );
    }
    const kind = hostOf(found);
    if (hosts && !hosts.includes(kind)) {
      throw new Error(
        kind === "community"
          ? `Salad's ${found.name} runs on community hosts, machines third parties run, which \`hosts\` does not allow; add \`community\` to \`hosts\` to use it.`
          : `Salad's ${found.name} runs on secure hosts, which \`hosts\` does not allow; add \`secure\` to \`hosts\` to use it.`,
      );
    }
    return found;
  }

  /**
   * `POST .../containers`: a group of one replica that starts at once, never restarts its
   * container, and is reached through the Container Gateway, which the gateway's run tokens guard.
   */
  async #create(spec: PodSpec): Promise<Pod> {
    const priority = spec.priority ?? "high";
    const gpu = await this.#class(spec.gpuType, spec.hosts ?? DEFAULT_HOSTS);
    price(gpu, priority);
    if (spec.diskGb > MAX_DISK_GB) {
      throw new Error(
        `A Salad container has ${MAX_DISK_GB} GB of disk at most, and this pod needs ${spec.diskGb} GB.`,
      );
    }
    const group = (await this.#request(this.#containers(), "POST", {
      name: `codeman-${randomBytes(8).toString("hex")}`,
      display_name: displayName(spec.name),
      container: {
        image: spec.image,
        environment_variables: environment(spec.env),
        priority,
        resources: {
          cpu: within(VCPU, gpu.min_vcpu, gpu.max_vcpu),
          memory: within(MEMORY_MB, gpu.min_ram, gpu.max_ram),
          gpu_classes: [gpu.id],
          storage_amount: within(spec.diskGb * GB, gpu.min_storage, gpu.max_storage),
          ...(spec.sharedMemoryGb ? { shm_size: spec.sharedMemoryGb * 1024 } : {}),
        },
      },
      replicas: 1,
      // A pod that exits is done: Salad must not start it again, here or on another node.
      restart_policy: "never",
      autostart_policy: true,
      networking: {
        protocol: "http",
        port: spec.port,
        // The Container Gateway's own authentication takes the account key; the gateway's run
        // tokens guard the pod instead.
        auth: false,
        load_balancer: "least_number_of_connections",
        single_connection_limit: false,
        client_request_timeout: 100_000,
        server_response_timeout: 100_000,
      },
    })) as SaladGroup;
    return this.#toPod(group);
  }

  async #get(id: string): Promise<Pod | undefined> {
    const group = (await this.#request(this.#containers(id), "GET", undefined, [404])) as
      | SaladGroup
      | undefined;
    if (!group) return undefined;
    const pod = await this.#toPod(group);
    if (pod.status !== "starting") return pod;
    const allocated = await this.#allocated(id);
    return allocated === undefined ? pod : { ...pod, allocated };
  }

  /**
   * Whether a node holds the group's instance: it downloads, creates or runs it, rather than
   * waits for one (docs/web/salad/list-container-group-instances.md). Undefined when Salad does
   * not list its instances.
   */
  async #allocated(id: string): Promise<boolean | undefined> {
    const listed = (await this.#request(
      `${this.#containers(id)}/instances`,
      "GET",
      undefined,
      [404],
    )) as { instances?: { state?: string }[] } | undefined;
    if (!listed) return undefined;
    return (listed.instances ?? []).some(
      ({ state }) => state === "downloading" || state === "creating" || state === "running",
    );
  }

  /** `GET .../containers`, which returns the project's groups in one page of up to 100. */
  async #list(env: Record<string, string>): Promise<Pod[]> {
    const { items } = (await this.#request(this.#containers())) as { items?: SaladGroup[] };
    const pods = await Promise.all((items ?? []).map((group) => this.#toPod(group)));
    return pods.filter((pod) =>
      Object.entries(env).every(([name, value]) => pod.env[name] === value),
    );
  }

  /** `DELETE .../containers/{name}`, which stops its instance too. */
  async #terminate(id: string): Promise<void> {
    await this.#request(this.#containers(id), "DELETE", undefined, [404]);
  }

  /** The Container Gateway's address of the group, which Salad gives once it has one. */
  async #url(id: string): Promise<string> {
    const group = (await this.#request(this.#containers(id), "GET", undefined, [404])) as
      | SaladGroup
      | undefined;
    const dns = group?.networking?.dns;
    if (!dns) throw new Error(`Salad has no address for container group ${id} yet.`);
    return /^https?:\/\//.test(dns) ? dns : `https://${dns}`;
  }

  async #toPod(group: SaladGroup): Promise<Pod> {
    const classId = group.container?.resources?.gpu_classes?.[0];
    const gpu = classId
      ? (await this.#gpuClasses()).find((candidate) => candidate.id === classId)
      : undefined;
    const status = STATUS[group.current_state?.status ?? ""] ?? "starting";
    const running = (group.current_state?.instance_status_counts?.running_count ?? 0) > 0;
    let pricePerSecond: number | undefined;
    try {
      pricePerSecond = gpu ? price(gpu, group.priority ?? "high") : undefined;
    } catch {
      pricePerSecond = undefined;
    }
    return {
      id: group.name,
      name: group.display_name ?? group.name,
      status: status === "running" && !running ? "starting" : status,
      image: group.container?.image ?? "",
      env: group.container?.environment_variables ?? {},
      gpuType: gpu?.name,
      createdAt: new Date(group.create_time),
      // Salad bills no other rate than the class's listed price at the group's priority.
      pricePerSecond,
      ...(gpu ? { host: hostOf(gpu) } : {}),
    };
  }

  #containers(name?: string): string {
    const base = `/organizations/${encodeURIComponent(this.#organization)}/projects/${encodeURIComponent(this.#project)}/containers`;
    return name === undefined ? base : `${base}/${encodeURIComponent(name)}`;
  }

  async #request(
    path: string,
    method = "GET",
    body?: unknown,
    absent: readonly number[] = [],
  ): Promise<unknown> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        "Salad-Api-Key": this.#apiKey,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (absent.includes(response.status)) return undefined;
    // Salad's errors are problem details, or sometimes an HTML page, which is left out.
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      const problem = describeProblem(text);
      throw new Error(
        `Salad ${method} ${path.split("?")[0]} failed with ${response.status}${problem ? `: ${problem}` : "."}`,
      );
    }
    return text.trim() === "" ? undefined : JSON.parse(text);
  }
}

/** The kind of host of a GPU class; a class that does not say counts as community, the least trusted. */
function hostOf(gpu: SaladGpuClass): HostKind {
  return gpu.gpu_class_type && isHostKind(gpu.gpu_class_type) ? gpu.gpu_class_type : "community";
}

/** A GPU class's price at a priority (`high` by default), in USD per second. */
function price(gpu: SaladGpuClass, priority = "high"): number {
  if (!(SALAD_PRIORITIES as readonly string[]).includes(priority)) {
    throw new Error(
      `Salad offers no priority \`${priority}\`; it offers ${SALAD_PRIORITIES.map((p) => `\`${p}\``).join(", ")}.`,
    );
  }
  const listed = Number(gpu.prices?.find((entry) => entry.priority === priority)?.price);
  if (!Number.isFinite(listed) || !(listed > 0)) {
    throw new Error(`Salad lists no price for ${gpu.name} at the priority \`${priority}\`.`);
  }
  return listed / 3600;
}

/** The memory a class's name states, such as 24 for `RTX 4090 (24 GB)`. */
export function memoryGb(name: string): number | undefined {
  const memory = Number(/\((\d+(?:\.\d+)?)\s*GB\)/i.exec(name)?.[1]);
  return memory > 0 ? memory : undefined;
}

/** A value within a GPU class's bounds, when it lists them. */
function within(value: number, min: number | undefined, max: number | undefined): number {
  const floor = typeof min === "number" && min > 0 ? Math.max(value, min) : value;
  return typeof max === "number" && max > 0 ? Math.min(floor, max) : floor;
}

/** A display name Salad takes: 2 to 63 letters, digits, spaces, commas, hyphens and dots. */
function displayName(name: string): string {
  const shown = name.replace(/[^ ,\-.0-9A-Za-z]/g, "-").slice(0, 63);
  return shown.length >= 2 ? shown : "codeman";
}

/**
 * The container's environment: Salad takes values of 1 to 1,000 characters, so empty ones are
 * left out, and a longer one stops the creation rather than be cut.
 */
function environment(env: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === "") continue;
    if (value.length > 1000) {
      throw new Error(
        `Salad takes environment values of 1,000 characters at most; ${name} has ${value.length}.`,
      );
    }
    kept[name] = value;
  }
  return kept;
}
