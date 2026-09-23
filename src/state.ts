/** Label a maintainer applies to opt an issue or pull request in. Codeman ignores everything else. */
export const OPT_IN_LABEL = "codeman";

export const STATES = [
  "planning",
  "awaiting-decision",
  "ready",
  "in-progress",
  "awaiting-workflow",
  "blocked",
  "done",
] as const;

export type State = (typeof STATES)[number];

export type StateResult = { ok: true; state: State | "new" } | { ok: false; error: string };

export function stateLabel(state: State): string {
  return `${OPT_IN_LABEL}:${state}`;
}

/** Reads a task's state from its labels. A task without a state label has not started yet. */
export function stateOf(labels: readonly string[]): StateResult {
  const [first, ...rest] = STATES.filter((state) => labels.includes(stateLabel(state)));
  if (first === undefined) return { ok: true, state: "new" };
  if (rest.length === 0) return { ok: true, state: first };
  return {
    ok: false,
    error: `multiple state labels: ${[first, ...rest].map(stateLabel).join(", ")}`,
  };
}
