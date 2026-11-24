import { randomBytes } from "node:crypto";
import type { Fetch } from "../../src/budget.ts";
import { type GpuAccount, isHostKind } from "../../src/inference/gpu.ts";
import {
  type BilledSpan,
  containerGroupRequest,
  memoryGb,
  NodeWatch,
  parseInstances,
  Salad,
  type SaladGpuClass,
  type SeenInstance,
} from "../../src/inference/salad.ts";
import type { Candidate, CheckProvider } from "./check.ts";

export { type BilledSpan, NodeWatch };

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
export function saladProvider(
  account: Required<GpuAccount>,
  fetchFn: Fetch,
  now: () => number = Date.now,
): CheckProvider {
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
      nodes.record(id, await instances(request, containers, id), now());
    },
    moved: async (id) => {
      // The group may be gone already: what was seen before still tells.
      const seen = await instances(request, containers, id).catch(() => undefined);
      if (seen) nodes.record(id, seen, now());
      return nodes.moved(id);
    },
    billed: (id) => nodes.billed(id),
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

/** What one probe request sent, printable: counts, lengths, indexes and names, never text. */
export type ProbeFacts = Record<string, string | number>;

/** What Salad answered to one variant of the creation's body. */
export interface ProbeAnswer {
  variant: string;
  /** What the variant's command was: its size, an item's or a token's index, or a word's name. */
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
   * when no test below tells; `any-command` when it refuses even `/bin/sh -c :`; `item-content`
   * when an item of the command alone is refused, with the items, tokens and words refused;
   * `total-chars`, `item-count` or `item-length` for a size; `throttled` when Salad answered 429
   * and the probe stopped.
   */
  cause: { cause: ProbeCause } & ProbeFacts;
  /** Whether the probe stopped at its most requests, before every test ran. */
  capped: boolean;
}

export type ProbeCause =
  | "none"
  | "unknown"
  | "any-command"
  | "item-content"
  | "total-chars"
  | "item-count"
  | "item-length"
  | "throttled";

/** The pause between two of the probe's creations. */
export const PROBE_PACE_MS = 300;
/** The probe's most creations in one run. */
export const PROBE_MAX_REQUESTS = 50;

/** The least command: a shell that does nothing, to which a tried item is added. */
const BASE = ["/bin/sh", "-c", ":"];

/**
 * The items the probe tries alone, by their content: those that run a tool that downloads or
 * checks a download, as the item Salad refused in the dispatch at a01f4e6 does (curl's), and the
 * command's last two, which run the gateway.
 */
const DOWNLOAD_ITEM = /\b(curl|wget|python3|openssl) +(-|s_client\b|dgst\b)/;

/** The total sizes the probe tries, in characters: up to about the bootstrap's, by 100. */
const SIZE_STEP = 100;
const SIZE_MAX = 5_000;
/** Above Salad's documented 1,000 characters an item and 100 items, never reached. */
const LONG_ITEM = 1_000;
const MANY_ITEMS = 60;

/** Single items the probe tries after `BASE`, printed by their names only. */
export const PROBE_WORDS: readonly (readonly [name: string, text: string])[] = [
  ["curl", "curl"],
  ["wget", "wget"],
  ["curl-output", "curl -o f u"],
  ["curl-url", "curl https://example.com"],
  ["wget-url", "wget https://example.com"],
  ["python3-c", "python3 -c x"],
  ["openssl-s-client", "openssl s_client"],
  ["base64-d", "base64 -d"],
  ["eval", "eval"],
];

/** A command's size, as a probe line prints it. */
export function commandFacts(command: readonly string[]): ProbeFacts {
  return { items: command.length, chars: command.reduce((sum, item) => sum + item.length, 0) };
}

/** The indexes of the items the probe tries alone, in order. */
export function probedItems(command: readonly string[]): number[] {
  const last = [command.length - 2, command.length - 1].filter((index) => index >= 0);
  const chosen = command.flatMap((item, index) => (DOWNLOAD_ITEM.test(item) ? [index] : []));
  return [...new Set([...chosen, ...last])].sort((a, b) => a - b);
}

/** An item's tokens, split on whitespace, each with its first index; repeated ones left out. */
export function itemTokens(item: string): { index: number; text: string }[] {
  const seen = new Set<string>();
  return item
    .split(/\s+/)
    .filter((text) => text !== "")
    .flatMap((text, index) => {
      if (seen.has(text)) return [];
      seen.add(text);
      return [{ index, text }];
    });
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
class Capped extends Error {}

/**
 * What in the creation's command Salad refuses, by requests each stopped and deleted (`send`),
 * at most `PROBE_MAX_REQUESTS`:
 *
 * 1. Controls: the whole body, then without its command. When Salad takes the whole body, or
 *    refuses it without a command too, the command is not the cause.
 * 2. `/bin/sh -c :`: when refused, any command is.
 * 3. Each item of `probedItems` alone after `/bin/sh -c :`.
 * 4. The first item refused, token by token, each as `x <token> x`; when no token alone is
 *    refused, the shortest run of adjacent tokens refused, by binary search.
 * 5. Each of `PROBE_WORDS` alone.
 * 6. When no item of step 3 is refused: a binary search over the command's prefixes for the
 *    shortest one refused, assuming a refusal holds for every longer prefix, and its last item
 *    alone; taken alone, a size: 60 items, an item of 1,000 characters, and a total of 5,000
 *    characters searched down by 100.
 *
 * Stops at Salad's first 429, or at its most requests.
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
  const refusedItems: number[] = [];
  const refusedTokens: string[] = [];
  const refusedWords: string[] = [];
  const found = (): ProbeFacts => ({
    ...(refusedItems.length > 0 ? { refused_items: refusedItems.join(",") } : {}),
    ...(refusedTokens.length > 0 ? { refused_tokens: refusedTokens.join(",") } : {}),
    ...(refusedWords.length > 0 ? { refused_words: refusedWords.join(",") } : {}),
  });
  let capped = false;
  const done = (cause: ProbeCause, facts: ProbeFacts = {}): ProbeOutcome => ({
    answers,
    cause: { cause, ...facts, ...found() },
    capped,
  });
  const taken = async (
    variant: string,
    command: readonly string[] | null,
    facts?: ProbeFacts,
  ): Promise<boolean> => {
    if (answers.length >= PROBE_MAX_REQUESTS) throw new Capped();
    const answer = await send(variant, command, facts);
    answers.push(answer);
    if (answer.status === 429) throw new Throttled();
    return answer.status !== undefined && answer.status >= 200 && answer.status < 300;
  };
  const listed = (full.container as { command?: unknown }).command;
  const command = Array.isArray(listed) ? listed.map(String) : [];
  /** Steps 4 and 5, after an item refused alone. */
  const narrow = async (item: string): Promise<void> => {
    const tokens = itemTokens(item);
    for (const token of tokens) {
      const tried = [...BASE, `x ${token.text} x`];
      if (!(await taken("token", tried, { index: token.index, length: token.text.length }))) {
        refusedTokens.push(String(token.index));
      }
    }
    for (const [name, text] of PROBE_WORDS) {
      if (!(await taken("word", [...BASE, text], { word: name }))) refusedWords.push(name);
    }
    if (refusedTokens.length > 0) return;
    // No token alone: the shortest run of adjacent tokens refused, by two binary searches, its
    // end then its start, assuming a run that holds a refused one is refused too.
    const words = item.split(/\s+/).filter((text) => text !== "");
    const run = (from: number, to: number) => {
      const text = words.slice(from, to).join(" ");
      return taken("tokens", [...BASE, `x ${text} x`], {
        index: from,
        count: to - from,
        length: text.length,
      });
    };
    if (words.length < 2 || (await run(0, words.length))) return;
    let kept = 0;
    let end = words.length;
    while (end - kept > 1) {
      const middle = Math.floor((kept + end) / 2);
      if (await run(0, middle)) kept = middle;
      else end = middle;
    }
    let start = 0;
    let past = end;
    while (past - start > 1) {
      const middle = Math.floor((start + past) / 2);
      if (await run(middle, end)) past = middle;
      else start = middle;
    }
    refusedTokens.push(start === end - 1 ? String(start) : `${start}-${end - 1}`);
  };
  try {
    if (!(await taken("full", command.length > 0 ? command : null, commandFacts(command)))) {
      if (command.length === 0 || !(await taken("no-command", null))) return done("unknown");
    } else {
      await taken("no-command", null);
      return done("none");
    }
    if (!(await taken("base", BASE, commandFacts(BASE)))) return done("any-command");

    for (const index of probedItems(command)) {
      const item = command[index] ?? "";
      if (!(await taken("item", [...BASE, item], { index, length: item.length }))) {
        refusedItems.push(index);
      }
    }
    const first = refusedItems[0];
    if (first !== undefined) {
      await narrow(command[first] ?? "");
      return done("item-content");
    }

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
      refusedItems.push(index);
      await narrow(item);
      return done("item-content");
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
    if (error instanceof Capped) {
      capped = true;
      return done(refusedItems.length > 0 ? "item-content" : "unknown");
    }
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

/** A group's instances (docs/web/salad/list-container-group-instances.md); none when Salad lists none. */
async function instances(
  request: (path: string) => Promise<unknown>,
  containers: string,
  id: string,
): Promise<SeenInstance[]> {
  return parseInstances(await request(`${containers}/${encodeURIComponent(id)}/instances`));
}
