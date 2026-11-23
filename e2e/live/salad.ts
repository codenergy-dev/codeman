import { randomBytes } from "node:crypto";
import type { Fetch } from "../../src/budget.ts";
import { type GpuAccount, isHostKind } from "../../src/inference/gpu.ts";
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
    async probe(spec, hide, wait): Promise<ProbeOutcome> {
      const listed = (await request(`${organization}/gpu-classes`)) as {
        items?: SaladGpuClass[];
      };
      const gpu = (listed.items ?? []).find((one) => one.name === spec.gpuType);
      if (!gpu) throw new Error("Salad no longer lists the probe's GPU class.");
      const full = containerGroupRequest(spec, gpu, groupName());
      let sent = 0;
      return probeCommand(full, async (variant, command, facts) => {
        const body = probeBody(full, command);
        hide(String(body.name));
        // Paced, so that the probe's requests stay far from any rate limit.
        if (sent++ > 0) await wait(PROBE_PACE_MS);
        return { ...(await probeOne(fetchFn, account.key, containers, variant, body)), facts };
      });
    },
  };
}

/** A container group's name, as the adapter makes one. */
function groupName(): string {
  return `codeman-${randomBytes(8).toString("hex")}`;
}

/** What one probe request sent, printable: counts, lengths and a character's name, never text. */
export type ProbeFacts = Record<string, string | number>;

/** What Salad answered to one variant of the creation's body. */
export interface ProbeAnswer {
  variant: string;
  /** What the variant's command was: its size, or the character it tried. */
  facts?: ProbeFacts | undefined;
  /** The HTTP status, or undefined when the request itself failed. */
  status: number | undefined;
  /** The answer's body, up to 8 KB, for a refusal; never printed as such. */
  body: string;
  contentType: string | undefined;
  /** For a group Salad created: whether the probe deleted it. */
  deleted?: boolean;
}

/** The probe's answers, and what in the command Salad refuses, as far as they tell. */
export interface ProbeOutcome {
  answers: ProbeAnswer[];
  /**
   * `none` when Salad takes the whole body; `unknown` when it refuses it without a command too, or
   * when no test below tells; `any-command` when it refuses even `/bin/sh -c :`; `character` or
   * `item-content` when one item of the command alone is refused; `total-chars`, `item-count` or
   * `item-length` for a size; `throttled` when Salad answered 429 and the probe stopped.
   */
  cause: { cause: ProbeCause } & ProbeFacts;
}

export type ProbeCause =
  | "none"
  | "unknown"
  | "any-command"
  | "character"
  | "item-content"
  | "total-chars"
  | "item-count"
  | "item-length"
  | "throttled";

/** The pause between two of the probe's creations. */
export const PROBE_PACE_MS = 300;

/** The least command: a shell that does nothing, to which a tried item is added. */
const BASE = ["/bin/sh", "-c", ":"];

/** The total sizes the probe tries, in characters: up to about the bootstrap's, by 100. */
const SIZE_STEP = 100;
const SIZE_MAX = 5_000;
/** Above Salad's documented 1,000 characters an item and 100 items, never reached. */
const LONG_ITEM = 1_000;
const MANY_ITEMS = 60;

/**
 * The characters and sequences of the bootstrap's script the probe tries one at a time, each as
 * `x<text>x` after `BASE`, printed by its name only.
 */
export const PROBE_CHARACTERS: readonly (readonly [name: string, text: string])[] = [
  ["dollar", "$"],
  ["single-quote", "'"],
  ["double-quote", '"'],
  ["backslash", "\\"],
  ["backtick", "`"],
  ["brace-open", "{"],
  ["brace-close", "}"],
  ["paren-open", "("],
  ["paren-close", ")"],
  ["bracket-open", "["],
  ["bracket-close", "]"],
  ["pipe", "|"],
  ["ampersand", "&"],
  ["semicolon", ";"],
  ["less-than", "<"],
  ["greater-than", ">"],
  ["asterisk", "*"],
  ["question", "?"],
  ["exclamation", "!"],
  ["hash", "#"],
  ["percent", "%"],
  ["tilde", "~"],
  ["equals", "="],
  ["space", " "],
  ["dollar-paren", "$("],
  ["dollar-brace", "${"],
  ["backslash-n", "\\n"],
  ["backslash-r", "\\r"],
  ["percent-s", "%s"],
];

/** A command's size, as a probe line prints it. */
export function commandFacts(command: readonly string[]): ProbeFacts {
  return { items: command.length, chars: command.reduce((sum, item) => sum + item.length, 0) };
}

/**
 * `BASE` and items of `a`, of `chars` characters in all, each of `LONG_ITEM` at most: few items,
 * so that their count does not count.
 */
export function filledCommand(chars: number): string[] {
  const command = [...BASE];
  let left = chars - BASE.join("").length;
  while (left > 0) {
    const size = Math.min(LONG_ITEM, left);
    command.push("a".repeat(size));
    left -= size;
  }
  return command;
}

/** A variant of the whole body: stopped, named anew, with `command`, or none when null. */
export function probeBody(
  full: Record<string, unknown>,
  command: readonly string[] | null,
): Record<string, unknown> {
  const body = structuredClone(full);
  const container = body.container as Record<string, unknown>;
  if (command === null) delete container.command;
  else container.command = [...command];
  body.name = groupName();
  body.autostart_policy = false;
  return body;
}

class Throttled extends Error {}

/**
 * What in the creation's command Salad refuses, by requests each stopped and deleted (`send`),
 * at most about 40:
 *
 * 1. Controls: the whole body, then without its command. When Salad takes the whole body, or
 *    refuses it without a command too, the command is not the cause.
 * 2. `/bin/sh -c :`: when refused, any command is.
 * 3. A binary search over the command's prefixes for the shortest one refused, assuming a
 *    refusal holds for every longer prefix.
 * 4. That prefix's last item alone after `/bin/sh -c :`. Refused: its content, then each of
 *    `PROBE_CHARACTERS` alone, to name a character. Taken: a size, then 60 items, an item of
 *    1,000 characters, and a total of 5,000 characters in items of 1,000 at most, searched down
 *    by 100; the first size refused is the cause.
 *
 * Stops at Salad's first 429.
 */
export async function probeCommand(
  full: Record<string, unknown>,
  send: (
    variant: string,
    command: readonly string[] | null,
    facts?: ProbeFacts,
  ) => Promise<ProbeAnswer>,
): Promise<ProbeOutcome> {
  const answers: ProbeAnswer[] = [];
  const done = (cause: ProbeCause, facts: ProbeFacts = {}): ProbeOutcome => ({
    answers,
    cause: { cause, ...facts },
  });
  const taken = async (
    variant: string,
    command: readonly string[] | null,
    facts?: ProbeFacts,
  ): Promise<boolean> => {
    const answer = await send(variant, command, facts);
    answers.push(answer);
    if (answer.status === 429) throw new Throttled();
    return answer.status !== undefined && answer.status >= 200 && answer.status < 300;
  };
  const listed = (full.container as { command?: unknown }).command;
  const command = Array.isArray(listed) ? listed.map(String) : [];
  try {
    if (!(await taken("full", command.length > 0 ? command : null, commandFacts(command)))) {
      if (command.length === 0 || !(await taken("no-command", null))) return done("unknown");
    } else {
      await taken("no-command", null);
      return done("none");
    }
    if (!(await taken("base", BASE, commandFacts(BASE)))) return done("any-command");

    let accepted = 0;
    let refused = command.length;
    while (refused - accepted > 1) {
      const middle = Math.floor((accepted + refused) / 2);
      const prefix = command.slice(0, middle);
      if (await taken("prefix", prefix, commandFacts(prefix))) accepted = middle;
      else refused = middle;
    }
    const index = refused - 1;
    const item = command[index] ?? "";
    if (!(await taken("item-alone", [...BASE, item], { index, length: item.length }))) {
      const refusedNames: string[] = [];
      for (const [name, text] of PROBE_CHARACTERS) {
        if (!(await taken("character", [...BASE, `x${text}x`], { character: name }))) {
          refusedNames.push(name);
        }
      }
      const inItem = PROBE_CHARACTERS.filter(
        ([name, text]) => refusedNames.includes(name) && item.includes(text),
      );
      const refusedFacts: ProbeFacts =
        refusedNames.length > 0 ? { refused: refusedNames.join(",") } : {};
      return inItem[0]
        ? done("character", { character: inItem[0][0], index, ...refusedFacts })
        : done("item-content", { index, length: item.length, ...refusedFacts });
    }

    const many = [...BASE, ...Array.from({ length: MANY_ITEMS - BASE.length }, () => "a")];
    if (!(await taken("size.items", many, commandFacts(many)))) return done("item-count");
    const long = [...BASE, "a".repeat(LONG_ITEM)];
    if (!(await taken("size.item", long, commandFacts(long)))) return done("item-length");
    const most = filledCommand(SIZE_MAX);
    if (await taken("size.total", most, commandFacts(most))) return done("unknown", { index });
    let low = 0;
    let high = SIZE_MAX / SIZE_STEP;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      const tried = filledCommand(middle * SIZE_STEP);
      if (await taken("size.total", tried, commandFacts(tried))) low = middle;
      else high = middle;
    }
    const lowChars = low === 0 ? BASE.join("").length : low * SIZE_STEP;
    return done("total-chars", { limit: `${lowChars}-${high * SIZE_STEP}` });
  } catch (error) {
    if (error instanceof Throttled) return done("throttled");
    throw error;
  }
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
