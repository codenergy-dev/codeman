import type { Runtime } from "../runtime/runtime.ts";
import { positiveNumber } from "../steps/common.ts";
import { OpenRouter, OpenRouterProvider } from "./openrouter.ts";
import type { InferenceProvider } from "./provider.ts";

/** The inference provider a key job uses, with the credentials of its inputs. */
export function inferenceProvider(runtime: Runtime): InferenceProvider {
  return new OpenRouterProvider(
    new OpenRouter(runtime.input("management-key", { required: true })),
    runtime.repository,
    () => positiveNumber(runtime, "key-expiry-hours"),
  );
}
