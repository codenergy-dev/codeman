import type { State } from "./state.ts";

/**
 * The stages a route chooses among, in order: web, design, code, test and review, which always
 * runs last. Each runs its own agent, one run at a time.
 */
export const ROUTED_STAGES = ["web", "design", "code", "test", "review"] as const;
export type RoutedStage = (typeof ROUTED_STAGES)[number];

/** Every stage: each agent run is one. Planning and routing come before the routed stages. */
export const STAGES = ["plan", "route", ...ROUTED_STAGES] as const;
export type Stage = (typeof STAGES)[number];

/** The state label of a task while a routed stage works on it. */
export const ROUTED_STAGE_STATE: Readonly<Record<RoutedStage, State>> = {
  web: "researching",
  design: "designing",
  code: "coding",
  test: "testing",
  review: "reviewing",
};

/**
 * The routed stage a state belongs to. `in-progress` is the single implementation stage from
 * before the routed stages existed.
 */
export function routedStageOfState(state: State | "new"): RoutedStage | undefined {
  if (state === "in-progress") return "code";
  return ROUTED_STAGES.find((stage) => ROUTED_STAGE_STATE[stage] === state);
}

export function nextStage(stage: RoutedStage): RoutedStage | undefined {
  return ROUTED_STAGES[ROUTED_STAGES.indexOf(stage) + 1];
}

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function isRoutedStage(value: unknown): value is RoutedStage {
  return typeof value === "string" && (ROUTED_STAGES as readonly string[]).includes(value);
}

/**
 * The stage after `stage` in a route: the first of the route's stages that comes later in the
 * order of the routed stages. Undefined when the route ends with `stage`. Without a route, the
 * fixed order.
 */
export function nextInRoute(
  route: { stages: readonly { stage: RoutedStage }[] } | undefined,
  stage: RoutedStage,
): RoutedStage | undefined {
  if (!route) return nextStage(stage);
  const index = ROUTED_STAGES.indexOf(stage);
  return route.stages.map((step) => step.stage).find((next) => ROUTED_STAGES.indexOf(next) > index);
}

/** The fixed order from `first` on: what runs when the router cannot choose. */
export function stagesFrom(first: RoutedStage): RoutedStage[] {
  return ROUTED_STAGES.slice(ROUTED_STAGES.indexOf(first));
}
