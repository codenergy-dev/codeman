import type { State } from "./state.ts";

/** The stages after planning, in order. Each runs its own agent, one run at a time. */
export const STAGES = ["web", "design", "code", "test", "review"] as const;
export type Stage = (typeof STAGES)[number];

/** The state label of a task while a stage works on it. */
export const STAGE_STATE: Readonly<Record<Stage, State>> = {
  web: "researching",
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

/**
 * The stage after `stage` in a route: the first of the route's stages that comes later in the
 * order of stages. Undefined when the route ends with `stage`. Without a route, the fixed order.
 */
export function nextInRoute(
  route: { stages: readonly { stage: Stage }[] } | undefined,
  stage: Stage,
): Stage | undefined {
  if (!route) return nextStage(stage);
  const index = STAGES.indexOf(stage);
  return route.stages.map((step) => step.stage).find((next) => STAGES.indexOf(next) > index);
}

/** The fixed order from `first` on: what runs when the router cannot choose. */
export function stagesFrom(first: Stage): Stage[] {
  return STAGES.slice(STAGES.indexOf(first));
}
