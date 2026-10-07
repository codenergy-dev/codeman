import type { ProviderAccounts } from "./inference/budget.ts";
import type { InferenceProvider } from "./inference/provider.ts";
import type { Ledger } from "./ledger.ts";
import type { Conventions } from "./platform/conventions.ts";
import type { CiResults, Platform } from "./platform/platform.ts";
import type { Runtime } from "./runtime/runtime.ts";
import type { Store } from "./store/store.ts";

/**
 * What a step works with: the runtime it runs in, the platform it works on, the inference
 * provider its agent runs use, and Codeman's store. `src/main.ts` builds them; tests pass fakes.
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
  /** The providers' accounts that the budgets read, with the key jobs' credentials. */
  accounts(): ProviderAccounts;
  /**
   * Codeman's store, with the job's identity. Throws, saying what to set, when the backend's
   * settings are missing.
   */
  store(): Store;
  /** The ledger of the step's job, on the store; `job` names the step. */
  ledger(job: string): Ledger;
}
