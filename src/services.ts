import type { InferenceBudget } from "./inference/budget.ts";
import type { InferenceProvider } from "./inference/provider.ts";
import type { Conventions } from "./platform/conventions.ts";
import type { CiResults, Platform } from "./platform/platform.ts";
import type { Runtime } from "./runtime/runtime.ts";

/**
 * What a step works with: the runtime it runs in, the platform it works on, and the inference
 * provider its agent runs use. `src/main.ts` builds them; tests pass fakes.
 */
export interface Services {
  runtime: Runtime;
  conventions: Conventions;
  /**
   * The platform's API with the step's credentials. `workflows` asks for credentials that may
   * also write CI configuration, which only accepting staged workflows needs.
   */
  platform(access?: "default" | "workflows"): Platform;
  /** The CI's results, with read-only credentials. */
  ci(): CiResults;
  /** Where agent runs get their model, with the key jobs' credentials. */
  inference(): InferenceProvider;
  /** The task's and the month's spend across every provider the settings name. */
  budget(): InferenceBudget;
}
