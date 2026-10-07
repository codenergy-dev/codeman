/**
 * A pod that served the task, as its record keeps it: providers bill pods, and do not list them
 * once terminated, so `close-key` reads the billing of the pods this list names, which refreshes
 * what Codeman's ledger counts for each.
 */
export interface PodSpend {
  id: string;
  /** The runs it served, by run ID. */
  runs: string[];
  /** What the task's total counted for it, in records from before the ledger's budgets. */
  counted?: number | undefined;
  /**
   * It served several tasks: its billing is theirs together, so `close-key` does not read it;
   * the ledger counts the task's share, as the pod's gateway measured it.
   */
  shared?: boolean | undefined;
}

/** Pods the record keeps; older ones no longer refresh. */
export const MAX_PODS = 20;

/** Adds a self-hosted run's pod to the task's list. */
export function addPod(
  pods: readonly PodSpend[] | undefined,
  run: { runId: string; pod: string; shared?: boolean | undefined },
): PodSpend[] {
  const next = (pods ?? []).map((pod) => ({ ...pod, runs: [...pod.runs] }));
  let pod = next.find((candidate) => candidate.id === run.pod);
  if (!pod) {
    pod = { id: run.pod, runs: [] };
    next.push(pod);
  }
  if (!pod.runs.includes(run.runId)) pod.runs.push(run.runId);
  if (run.shared) pod.shared = true;
  return next.slice(-MAX_PODS);
}
