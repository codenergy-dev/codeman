import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { type FakeRequest, FakeServer, HttpError, json } from "../http.ts";
import {
  httpLauncher,
  isFailure,
  type LaunchedPod,
  type LaunchSpec,
  noContainers,
  type PodLauncher,
} from "../runpod/launcher.ts";
import { forward } from "../runpod/proxy.ts";

/**
 * A fake of SaladCloud's Container Engine for the e2e suite: the part of its public API that
 * src/inference/salad.ts calls (the organization's GPU classes, and container groups of one
 * project), and each group's Container Gateway. One server stands for `https://api.salad.com`.
 *
 * A group's container is one the fake Runpod's `PodLauncher` starts (e2e/fakes/runpod/launcher.ts),
 * through the same host-side orchestrator: the fake holds no Docker socket either. The Container
 * Gateway serves each group's port at `/pods/{name}/{port}/...`, so the e2e build's `saladPods`
 * template is `<this fake's origin>/pods/{id}/{port}`.
 *
 * Shapes follow docs/web/salad/; the fake leaves out what Codeman neither sends nor reads (queues,
 * probes, logging, registry authentication, instances, scaling, start and stop).
 */

type GroupStatus = "pending" | "deploying" | "running" | "stopped" | "succeeded" | "failed";

/** A GPU class of the fake's organization, as `GpuClass` lists it (list-the-gpu-classes.md). */
export interface SaladClass {
  id: string;
  name: string;
  gpu_class_type: "community" | "secure";
  /** USD per hour, by priority, as Salad's strings. */
  prices: { priority: string; price: string }[];
  min_vcpu?: number;
  max_vcpu?: number;
  /** In MB. */
  min_ram?: number;
  max_ram?: number;
  /** In bytes. */
  min_storage?: number;
  max_storage?: number;
}

export interface SaladSetup {
  /** The API keys the fake takes; any key when empty. */
  keys?: string[];
  /** The organization and project whose routes answer; any when unset. */
  organization?: string;
  project?: string;
  classes?: SaladClass[];
}

interface GroupRecord {
  /** Its UUID, as Salad's `id`. */
  id: string;
  /** The create request's body, as sent. */
  request: CreateGroup;
  gpu: SaladClass;
  spec: LaunchSpec;
  status: GroupStatus;
  createdAt: number;
  deletedAt: number | undefined;
  launched: LaunchedPod | undefined;
  failure: string | undefined;
  /** How many times the launcher was asked for its container. */
  launches: number;
}

interface CreateGroup {
  name: string;
  display_name?: string;
  container: {
    image: string;
    environment_variables?: Record<string, string>;
    priority?: string | null;
    resources: {
      cpu: number;
      memory: number;
      gpu_classes: string[];
      storage_amount?: number;
      shm_size?: number;
    };
  };
  replicas: number;
  restart_policy: string;
  autostart_policy: boolean;
  networking?: {
    protocol: string;
    port: number;
    auth: boolean;
    load_balancer?: string;
    single_connection_limit?: boolean;
    client_request_timeout?: number;
    server_response_timeout?: number;
  };
}

const PRIORITIES = ["high", "medium", "low", "batch"];
const GB = 1024 ** 3;
const MAX_CREATE_BYTES = 102_400;
const API = "/api/public/organizations/{organization}";

/** Classes like Salad's: community consumer GPUs, and a secure one, at their listed prices. */
export function defaultClasses(): SaladClass[] {
  const bounds = {
    min_vcpu: 1,
    max_vcpu: 16,
    min_ram: 1024,
    max_ram: 61_440,
    min_storage: GB,
    max_storage: 250 * GB,
  };
  const prices = (high: string, medium: string, low: string, batch: string) => [
    { priority: "high", price: high },
    { priority: "medium", price: medium },
    { priority: "low", price: low },
    { priority: "batch", price: batch },
  ];
  return [
    {
      id: "f51baccc-dc95-40fb-a5d1-6d0ee0db31d2",
      name: "RTX 4090 (24 GB)",
      gpu_class_type: "community",
      prices: prices("0.440", "0.347", "0.253", "0.160"),
      ...bounds,
    },
    {
      id: "a5db5c50-cbcb-4596-ae80-6a0c8090d80f",
      name: "RTX 3090 (24 GB)",
      gpu_class_type: "community",
      prices: prices("0.200", "0.163", "0.127", "0.090"),
      ...bounds,
    },
    {
      id: "3b0f8a0a-6d6b-4c1e-9a43-2f1e8f6c5d70",
      name: "RTX PRO 6000 (96 GB)",
      gpu_class_type: "secure",
      prices: prices("1.200", "1.100", "1.000", "0.900"),
      ...bounds,
    },
  ];
}

export class SaladFake {
  readonly server = new FakeServer("salad");
  launcher: PodLauncher;
  readonly #now: () => number;
  /** Every group created, deleted ones included, by name. */
  readonly #groups = new Map<string, GroupRecord>();
  readonly #initial: SaladSetup;
  #setup: Required<Pick<SaladSetup, "keys" | "classes">> & SaladSetup = {
    keys: [],
    classes: [],
  };

  constructor(
    setup: SaladSetup = {},
    options: { launcher?: PodLauncher; now?: () => number } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.launcher = options.launcher ?? noContainers;
    this.#initial = structuredClone(setup);
    this.setup(setup);
    this.#routes();
    this.#controls();
    this.server.onReset(() => this.#reset());
  }

  /** Replaces the keys, the organization, the project and the classes; groups stay. */
  setup(setup: SaladSetup): void {
    this.#setup = {
      ...setup,
      keys: [...(setup.keys ?? [])],
      classes: structuredClone(setup.classes ?? defaultClasses()),
    };
  }

  /** Every group, deleted ones included, as the control API lists them. */
  groups(): Record<string, unknown>[] {
    return [...this.#groups.values()].map((group) => ({
      name: group.request.name,
      displayName: group.request.display_name ?? group.request.name,
      status: group.status,
      deleted: group.deletedAt !== undefined,
      image: group.request.container.image,
      env: { ...(group.request.container.environment_variables ?? {}) },
      gpu: group.gpu.name,
      host: group.gpu.gpu_class_type,
      priority: group.request.container.priority ?? "high",
      restartPolicy: group.request.restart_policy,
      replicas: group.request.replicas,
      resources: { ...group.request.container.resources },
      networking: group.request.networking ? { ...group.request.networking } : null,
      urls: Object.fromEntries(
        group.spec.ports.map(({ port }) => [port, group.launched?.urlForPort(port) ?? null]),
      ),
      createdAt: new Date(group.createdAt).toISOString(),
      deletedAt: group.deletedAt === undefined ? null : new Date(group.deletedAt).toISOString(),
      launches: group.launches,
      failure: group.failure ?? null,
    }));
  }

  #routes(): void {
    const server = this.server;
    const containers = `${API}/projects/{project}/containers`;
    server.route("GET", `${API}/gpu-classes`, (request) => {
      this.#authorize(request, false);
      return json({ items: structuredClone(this.#setup.classes) });
    });
    server.route("POST", containers, (request) => {
      this.#authorize(request, true);
      return json(this.#groupJson(this.#create(request)), 201);
    });
    server.route("GET", containers, (request) => {
      this.#authorize(request, true);
      const live = [...this.#groups.values()].filter((group) => group.deletedAt === undefined);
      return json({ items: live.map((group) => this.#groupJson(group)) });
    });
    server.route("GET", `${containers}/{name}`, (request) => {
      this.#authorize(request, true);
      return json(this.#groupJson(this.#live(request.params.name ?? "")));
    });
    server.route("DELETE", `${containers}/{name}`, (request) => {
      this.#authorize(request, true);
      const group = this.#live(request.params.name ?? "");
      group.deletedAt = this.#now();
      group.status = "stopped";
      group.launched = undefined;
      this.#terminateContainer(group);
      return { status: 202 };
    });
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      server.route(method, "/pods/{name}/{port}", (request, response) =>
        this.#gateway(request, response, ""),
      );
      server.route(method, "/pods/{name}/{port}/{rest*}", (request, response) =>
        this.#gateway(request, response, request.params.rest ?? ""),
      );
    }
  }

  #controls(): void {
    const server = this.server;
    server.control("GET", "/salad/groups", () => json(this.groups()));
    server.control("PUT", "/salad/setup", (request) => {
      this.setup(setupOf(request.json()));
      return { status: 204 };
    });
  }

  /** The `Salad-Api-Key` header, and the organization and project of the path when set. */
  #authorize(request: FakeRequest, project: boolean): void {
    const key = request.headers["salad-api-key"];
    if (typeof key !== "string" || key === "") throw problem(401, "missing api key");
    const keys = this.#setup.keys;
    if (keys.length > 0 && !keys.includes(key)) throw problem(401, "invalid api key");
    const { organization, project: name } = this.#setup;
    if (organization && request.params.organization !== organization) {
      throw problem(404, "organization not found");
    }
    if (project && name && request.params.project !== name) {
      throw problem(404, "project not found");
    }
  }

  #create(request: FakeRequest): GroupRecord {
    if (request.body.length > MAX_CREATE_BYTES) {
      throw problem(413, `The request body exceeds the ${MAX_CREATE_BYTES} byte limit.`);
    }
    const body = request.json();
    const errors = createErrors(body);
    if (errors.length > 0) throw problem(400, "validation failed", errors);
    const create = body as CreateGroup;
    const existing = this.#groups.get(create.name);
    if (existing && existing.deletedAt === undefined) {
      throw problem(409, `container group ${create.name} already exists`);
    }
    const classId = create.container.resources.gpu_classes[0] ?? "";
    const gpu = this.#setup.classes.find((one) => one.id === classId);
    if (!gpu) throw problem(400, `unknown gpu class ${classId}`);
    const networking = create.networking;
    const group: GroupRecord = {
      id: randomUUID(),
      request: structuredClone(create),
      gpu,
      spec: {
        id: create.name,
        name: create.display_name ?? create.name,
        image: create.container.image,
        env: { ...(create.container.environment_variables ?? {}) },
        ports: networking ? [{ port: networking.port, protocol: networking.protocol }] : [],
        gpu: { id: gpu.name, count: 1, memoryGb: memoryOf(gpu.name) },
        cloud: gpu.gpu_class_type === "secure" ? "SECURE" : "COMMUNITY",
        diskGb:
          create.container.resources.storage_amount === undefined
            ? undefined
            : Math.round(create.container.resources.storage_amount / GB),
        cudaVersion: null,
      },
      status: create.autostart_policy ? "pending" : "stopped",
      createdAt: this.#now(),
      deletedAt: undefined,
      launched: undefined,
      failure: undefined,
      launches: 0,
    };
    this.#groups.set(create.name, group);
    // The answer says pending; its instance is allocated right after.
    if (create.autostart_policy) setImmediate(() => this.#launch(group));
    return group;
  }

  /** Asks the launcher for the group's one container: `deploying` until it runs. */
  #launch(group: GroupRecord): void {
    if (group.status !== "pending" || group.deletedAt !== undefined) return;
    group.status = "deploying";
    const launch = ++group.launches;
    const settle = (launched: LaunchedPod | undefined, failure?: string) => {
      // A group deleted meanwhile does not take this container.
      if (group.launches !== launch || group.status !== "deploying") {
        if (launched) this.#terminateContainer(group);
        return;
      }
      if (launched) {
        group.status = "running";
        group.launched = launched;
      } else {
        group.status = "failed";
        group.failure = failure;
      }
    };
    Promise.resolve()
      .then(() => this.launcher.launch(structuredClone(group.spec)))
      .then(
        (result) => (isFailure(result) ? settle(undefined, result.failure) : settle(result)),
        (error: unknown) =>
          settle(undefined, error instanceof Error ? error.message : String(error)),
      );
  }

  #terminateContainer(group: GroupRecord): Promise<void> {
    return Promise.resolve()
      .then(() => this.launcher.terminate(group.spec.id))
      .catch((error: unknown) => {
        console.error(
          `The fake Salad could not stop group ${group.spec.id}'s container: ${error instanceof Error ? error.message : error}`,
        );
      });
  }

  #live(name: string): GroupRecord {
    const group = this.#groups.get(name);
    if (!group || group.deletedAt !== undefined) throw problem(404, "container group not found");
    return group;
  }

  /** Salad's `ContainerGroup`, with the fields get-container-group.md lists that Codeman reads. */
  #groupJson(group: GroupRecord): Record<string, unknown> {
    const { request } = group;
    const running = group.status === "running" ? 1 : 0;
    const allocating = group.status === "pending" || group.status === "deploying" ? 1 : 0;
    const at = new Date(group.createdAt).toISOString();
    return {
      id: group.id,
      name: request.name,
      display_name: request.display_name ?? request.name,
      organization_name: this.#setup.organization ?? "",
      project_name: this.#setup.project ?? "",
      container: {
        image: request.container.image,
        environment_variables: { ...(request.container.environment_variables ?? {}) },
        priority: request.container.priority ?? "high",
        resources: { ...request.container.resources },
      },
      priority: request.container.priority ?? "high",
      replicas: request.replicas,
      restart_policy: request.restart_policy,
      autostart_policy: request.autostart_policy,
      country_codes: [],
      current_state: {
        status: group.status,
        description: group.failure ?? null,
        start_time: at,
        finish_time: at,
        instance_status_counts: {
          allocating_count: allocating,
          creating_count: 0,
          running_count: running,
          stopping_count: 0,
        },
      },
      // The Container Gateway's address, once an instance runs.
      networking: request.networking
        ? {
            ...request.networking,
            ...(running ? { dns: `${request.name}.salad.cloud` } : {}),
          }
        : null,
      pending_change: false,
      version: 1,
      create_time: at,
      update_time: at,
    };
  }

  /**
   * The Container Gateway: a running group's port, forwarded to the launcher's URL for it.
   * Anything else answers 404.
   */
  async #gateway(request: FakeRequest, response: ServerResponse, rest: string): Promise<undefined> {
    const group = this.#groups.get(request.params.name ?? "");
    const port = Number(request.params.port);
    const exposed = group?.request.networking?.port === port;
    const target =
      group?.status === "running" && group.deletedAt === undefined && exposed
        ? group.launched?.urlForPort(port)
        : undefined;
    if (!target) {
      response
        .writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        .end("404 page not found");
      return undefined;
    }
    await forward(
      `${target}/${rest.split("/").map(encodeURIComponent).join("/")}`,
      request,
      response,
    );
    return undefined;
  }

  #reset(): void {
    for (const group of this.#groups.values()) {
      if (group.deletedAt === undefined) this.#terminateContainer(group);
    }
    this.#groups.clear();
    this.setup(structuredClone(this.#initial));
  }
}

/** Salad's errors are RFC 9457 problem details (using-the-api.md). */
function problem(status: number, detail: string, errors?: string[]): HttpError {
  return new HttpError(
    status,
    {
      type: "https://docs.salad.com/errors",
      title: TITLES[status] ?? "Error",
      status,
      detail,
      ...(errors ? { errors } : {}),
    },
    { "content-type": "application/problem+json" },
  );
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
};

/** The memory a class's name states, such as 24 for `RTX 4090 (24 GB)`. */
function memoryOf(name: string): number | undefined {
  const memory = Number(/\((\d+)\s*GB\)/i.exec(name)?.[1]);
  return memory > 0 ? memory : undefined;
}

/** What breaks the create request's contract (create-container-group.md); empty when none. */
function createErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["$: expected object"];
  }
  const body = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof body.name !== "string" || !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(body.name)) {
    errors.push("$.name: expected a container group name");
  }
  if (
    body.display_name !== undefined &&
    !(typeof body.display_name === "string" && /^[ ,\-.0-9A-Za-z]{2,63}$/.test(body.display_name))
  ) {
    errors.push(
      "$.display_name: expected 2 to 63 letters, digits, spaces, commas, hyphens or dots",
    );
  }
  if (!(Number.isInteger(body.replicas) && (body.replicas as number) >= 0)) {
    errors.push("$.replicas: expected integer >= 0");
  }
  if (!["always", "on_failure", "never"].includes(body.restart_policy as string)) {
    errors.push("$.restart_policy: must be always, on_failure or never");
  }
  if (typeof body.autostart_policy !== "boolean")
    errors.push("$.autostart_policy: expected boolean");
  const container = body.container as Record<string, unknown> | undefined;
  if (typeof container !== "object" || container === null) {
    errors.push("$.container: required object");
  } else {
    if (typeof container.image !== "string" || container.image === "") {
      errors.push("$.container.image: required string");
    }
    if (
      container.priority !== undefined &&
      container.priority !== null &&
      !PRIORITIES.includes(container.priority as string)
    ) {
      errors.push("$.container.priority: must be high, medium, low or batch");
    }
    const env = container.environment_variables;
    if (env !== undefined) {
      if (typeof env !== "object" || env === null || Array.isArray(env)) {
        errors.push("$.container.environment_variables: expected object");
      } else {
        for (const [name, item] of Object.entries(env)) {
          if (typeof item !== "string" || item.length < 1 || item.length > 1000) {
            errors.push(`$.container.environment_variables.${name}: expected 1 to 1000 characters`);
          }
        }
      }
    }
    const resources = container.resources as Record<string, unknown> | undefined;
    if (typeof resources !== "object" || resources === null) {
      errors.push("$.container.resources: required object");
    } else {
      const between = (name: string, min: number, max: number, required: boolean) => {
        const item = resources[name];
        if (item === undefined && !required) return;
        if (!(Number.isInteger(item) && (item as number) >= min && (item as number) <= max)) {
          errors.push(`$.container.resources.${name}: expected integer from ${min} to ${max}`);
        }
      };
      between("cpu", 1, 16, true);
      between("memory", 1024, 61_440, true);
      between("storage_amount", GB, 250 * GB, false);
      between("shm_size", 64, 1_073_741_824, false);
      const classes = resources.gpu_classes;
      if (!Array.isArray(classes) || !classes.every((id) => typeof id === "string")) {
        errors.push("$.container.resources.gpu_classes: expected an array of UUIDs");
      } else if (classes.length !== 1) {
        errors.push("$.container.resources.gpu_classes: the fake takes exactly one GPU class");
      }
    }
  }
  const networking = body.networking as Record<string, unknown> | undefined;
  if (networking !== undefined) {
    if (typeof networking !== "object" || networking === null) {
      errors.push("$.networking: expected object");
    } else {
      if (typeof networking.auth !== "boolean") errors.push("$.networking.auth: required boolean");
      if (!(Number.isInteger(networking.port) && (networking.port as number) >= 1)) {
        errors.push("$.networking.port: required port");
      }
      if (networking.protocol !== "http") errors.push("$.networking.protocol: must be http");
      for (const name of ["client_request_timeout", "server_response_timeout"]) {
        const item = networking[name];
        if (
          item !== undefined &&
          !(Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 100_000)
        ) {
          errors.push(`$.networking.${name}: expected 1 to 100000 milliseconds`);
        }
      }
    }
  }
  return errors;
}

function setupOf(value: unknown): SaladSetup {
  const setup = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const strings = (list: unknown) =>
    Array.isArray(list) && list.every((item) => typeof item === "string");
  if (
    (setup.keys !== undefined && !strings(setup.keys)) ||
    (setup.classes !== undefined && !Array.isArray(setup.classes)) ||
    (setup.organization !== undefined && typeof setup.organization !== "string") ||
    (setup.project !== undefined && typeof setup.project !== "string")
  ) {
    throw new HttpError(400, {
      message: "A setup may have keys and classes, each a list, and an organization and a project.",
    });
  }
  return {
    keys: setup.keys as string[] | undefined,
    organization: setup.organization as string | undefined,
    project: setup.project as string | undefined,
    classes: setup.classes as SaladClass[] | undefined,
  };
}

/**
 * The fake for e2e/fakes/main.ts. The environment sets it up:
 *
 * - `FAKE_SALAD`: the setup as JSON, as `PUT /_fake/salad/setup` takes it (keys, organization,
 *   project, classes); the default classes, any key, organization and project when unset;
 * - `FAKE_SALAD_LAUNCHER`: the orchestrator's launcher API (e2e/fakes/runpod/launcher.ts,
 *   `httpLauncher`), the fake Runpod's, with `FAKE_SALAD_LAUNCHER_TOKEN`; without it, groups run
 *   and serve nothing.
 */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  let setup: SaladSetup;
  try {
    setup = setupOf(env.FAKE_SALAD ? JSON.parse(env.FAKE_SALAD) : {});
  } catch (error) {
    const message =
      error instanceof HttpError ? (error.body as { message: string }).message : String(error);
    throw new Error(`FAKE_SALAD: ${message}`);
  }
  return new SaladFake(setup, {
    launcher: env.FAKE_SALAD_LAUNCHER
      ? httpLauncher(env.FAKE_SALAD_LAUNCHER, { token: env.FAKE_SALAD_LAUNCHER_TOKEN })
      : undefined,
  }).server;
}
