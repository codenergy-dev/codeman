/**
 * The service model of the prototype supervisor (E2 of
 * docs/plans/2026-10-30-investigate-multi-service-pods.md): what a service is, and what each
 * engine family's adapter does for it. Imported by supervisor.ts and the adapters.
 */
import { readdirSync, readFileSync } from "node:fs";

/** One engine serving one model with its settings, as the pod's manifest lists it. */
export interface ServiceSpec {
  /** The name a request routes by: the `model` of a chat request, or of a generation. */
  name: string;
  /** The adapter that serves it. */
  family: "ollama" | "python";
  /** The engine's model: an Ollama model name, or the Python model's local directory. */
  model: string;
  kind: "chat" | "generation";
  /** The agent's LLM: loaded at start, never unloaded for being idle, restored after a swap. */
  primary?: boolean;
  /** The memory it needs before it is measured: stands in for the fit's peak. */
  estimateBytes: number;
  /** A secondary service unused for this long is unloaded. */
  idleMs?: number;
}

export type ServiceState = "unloaded" | "loading" | "loaded" | "unloading" | "failed";

/** What a service holds now, in bytes, and how it was measured. */
export interface Footprint {
  bytes: number;
  /** The engine's own figure, such as Ollama's `/api/ps` `size`, when it reports one. */
  reported?: number | undefined;
  /** The resident memory of the processes that hold the model, from /proc. */
  rss?: number | undefined;
}

/** A request on its way to a service's engine. */
export interface EngineRequest {
  method: string;
  path: string;
  body: string | undefined;
  signal: AbortSignal;
}

export interface EngineResponse {
  status: number;
  contentType: string | undefined;
  body: AsyncIterable<Uint8Array>;
}

/**
 * What the supervisor needs from an engine family. One adapter serves every service of its
 * family: Ollama serves several models from one process, the Python adapter runs a process per
 * service. vLLM would map `load` and `unload` to its sleep mode's `/wake_up` and `/sleep`.
 */
export interface EngineAdapter {
  readonly family: string;
  /** Starts the engine's process, if it has one shared by its services, with nothing loaded. */
  start(): Promise<void>;
  /** Loads the service's model into memory; resolves once it serves. */
  load(spec: ServiceSpec): Promise<void>;
  /** Gives the service's memory back; resolves once it is free. */
  unload(spec: ServiceSpec): Promise<void>;
  /** Whether the engine still has the service loaded, as it reports it. */
  health(spec: ServiceSpec): Promise<boolean>;
  /** The routes the service answers, as `METHOD /path`. */
  routes(spec: ServiceSpec): string[];
  footprint(spec: ServiceSpec): Promise<Footprint>;
  forward(spec: ServiceSpec, request: EngineRequest): Promise<EngineResponse>;
  /** Stops the engine's processes. */
  stop(): Promise<void>;
}

/** The resident memory of a process and its descendants, in bytes, from /proc. */
export function treeRss(pid: number): number {
  let total = 0;
  const pending = [pid];
  while (pending.length > 0) {
    const current = pending.pop() as number;
    try {
      const status = readFileSync(`/proc/${current}/status`, "utf8");
      const kb = Number(/^VmRSS:\s+(\d+) kB/m.exec(status)?.[1] ?? 0);
      total += kb * 1024;
      for (const task of readdirSync(`/proc/${current}/task`)) {
        const children = readFileSync(`/proc/${current}/task/${task}/children`, "utf8");
        for (const child of children.split(" ").filter(Boolean)) pending.push(Number(child));
      }
    } catch {
      // The process exited meanwhile.
    }
  }
  return total;
}

/** The processes whose command line contains `text`, from /proc. */
export function processesWith(text: string): number[] {
  const found: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      if (command.includes(text)) found.push(Number(entry));
    } catch {
      // The process exited meanwhile.
    }
  }
  return found;
}

/** Waits until `check` holds, polling, or fails after `timeoutMs`. */
export async function until(
  check: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check().catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export const MB = 1024 * 1024;

export function mb(bytes: number | undefined): string {
  return bytes === undefined ? "?" : `${(bytes / MB).toFixed(0)} MB`;
}
