/**
 * A pod that served the task, as its record keeps it: providers bill pods, and do not list them
 * once terminated, so the task's spend on pods comes from this list.
 */
export interface PodSpend {
  id: string;
  /** The runs it served, by run ID. */
  runs: string[];
  /** What the task's total counts for it so far, in USD. */
  counted: number;
}

/**
 * What a task's self-hosted runs added to its total, from its record. The rest of the total is
 * OpenRouter's, which its keys tell. A record from before profiles kept no such part: one with
 * pods spent all of its total on self-hosted inference.
 */
export function selfHostedSpent(
  record:
    | {
        spent?: number | undefined;
        inference?: { spent?: number | undefined } | undefined;
      }
    | null
    | undefined,
): number {
  if (!record?.inference) return 0;
  return record.inference.spent ?? record.spent ?? 0;
}

/** Pods the record keeps; older ones no longer refresh. */
export const MAX_PODS = 20;

/**
 * Adds a self-hosted run to the task's spend: its estimated cost, on its pod when it had one;
 * then each pod's billing, where it is above what was counted. Billing includes a kept pod's
 * idle time between runs, which belongs to no run. Returns the pods, what the task's total
 * gains, and the costs of runs whose pod served them alone, which replace their estimates.
 */
export function countRun(
  pods: readonly PodSpend[] | undefined,
  run: { runId: string; cost: number; pod?: string | undefined },
  billed: Readonly<Record<string, number>> = {},
): { pods: PodSpend[]; added: number; costs: Record<string, number> } {
  const next = (pods ?? []).map((pod) => ({ ...pod, runs: [...pod.runs] }));
  let added = run.cost;
  if (run.pod) {
    let pod = next.find((candidate) => candidate.id === run.pod);
    if (!pod) {
      pod = { id: run.pod, runs: [], counted: 0 };
      next.push(pod);
    }
    if (!pod.runs.includes(run.runId)) pod.runs.push(run.runId);
    pod.counted += run.cost;
  }
  const costs: Record<string, number> = {};
  for (const pod of next) {
    const amount = billed[pod.id];
    if (amount !== undefined && amount > pod.counted) {
      added += amount - pod.counted;
      pod.counted = amount;
    }
    const [only] = pod.runs;
    if (amount !== undefined && only !== undefined && pod.runs.length === 1) {
      costs[only] = Number(pod.counted.toFixed(4));
    }
  }
  return { pods: next.slice(-MAX_PODS), added, costs };
}

/** `close-key`'s `pod-costs` output: USD by pod ID. Undefined when missing or malformed. */
export function parsePodCosts(text: string): Record<string, number> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  const valid = entries.every(
    ([id, cost]) =>
      /^[\w-]{1,64}$/.test(id) && typeof cost === "number" && Number.isFinite(cost) && cost >= 0,
  );
  return valid ? Object.fromEntries(entries) : undefined;
}
