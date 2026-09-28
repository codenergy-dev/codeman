import type { State } from "./state.ts";

/** The stages after planning, in order. Each runs its own agent, one run at a time. */
export const STAGES = ["design", "code", "test", "review"] as const;
export type Stage = (typeof STAGES)[number];

/** The state label of a task while a stage works on it. */
export const STAGE_STATE: Readonly<Record<Stage, State>> = {
  design: "designing",
  code: "coding",
  test: "testing",
  review: "reviewing",
};

/** The stage a state belongs to. `in-progress` is the single stage before stages existed. */
export function stageOfState(state: State | "new"): Stage | undefined {
  if (state === "in-progress") return "code";
  return STAGES.find((stage) => STAGE_STATE[stage] === state);
}

export function nextStage(stage: Stage): Stage | undefined {
  return STAGES[STAGES.indexOf(stage) + 1];
}

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}
