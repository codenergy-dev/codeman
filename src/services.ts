import type { Conventions } from "./platform/conventions.ts";
import type { CiResults, Platform } from "./platform/platform.ts";
import type { Runtime } from "./runtime/runtime.ts";

/**
 * What a step works with: the runtime it runs in, and the platform it works on. `src/main.ts`
 * builds them; tests pass fakes.
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
}
