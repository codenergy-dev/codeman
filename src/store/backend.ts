import type { Fetch } from "../budget.ts";
import type { Runtime } from "../runtime/runtime.ts";
import { Firestore } from "./firestore.ts";
import { identityProblem, serviceAccountTokens } from "./google.ts";
import type { Store } from "./store.ts";

/**
 * The backend's settings: the step's input for each, and the variable the templates fill it
 * from. They are not secrets: they name the project and the identity, and grant nothing alone.
 */
export const BACKEND_SETTINGS = [
  { input: "firebase-project", variable: "CODEMAN_FIREBASE_PROJECT" },
  { input: "workload-identity-provider", variable: "CODEMAN_WORKLOAD_IDENTITY_PROVIDER" },
  { input: "service-account", variable: "CODEMAN_SERVICE_ACCOUNT" },
] as const;

const SETUP = "docs/installation.md#4-set-up-the-backend";

/**
 * Codeman's store: Firestore in the Firebase project the settings name, reached as their
 * service account with the job's OIDC token. The backend is required (decision 4 of its plan):
 * a step without its settings fails, and says which variables to set.
 */
export function backendStore(runtime: Runtime, fetchFn?: Fetch): Store {
  const values = BACKEND_SETTINGS.map(({ input }) => runtime.input(input).trim());
  const missing = BACKEND_SETTINGS.filter((_, index) => values[index] === "");
  if (missing.length > 0) {
    const names = missing.map(({ variable }) => `\`${variable}\``).join(", ");
    throw new Error(
      `Codeman's backend is not set up: this step has no ${names}. Set ${missing.length > 1 ? "these variables" : "this variable"} in the repository or the organization, as ${SETUP} says, and copy the workflow templates again if yours do not pass ${missing.length > 1 ? "them" : "it"}.`,
    );
  }
  const [project = "", provider = "", serviceAccount = ""] = values;
  const problem = identityProblem({ provider, serviceAccount });
  if (problem) throw new Error(`Codeman's backend settings are wrong: ${problem} See ${SETUP}.`);
  try {
    return new Firestore({
      project,
      fetch: fetchFn,
      token: serviceAccountTokens(
        { provider, serviceAccount },
        {
          idToken: (audience) => runtime.idToken(audience),
          mask: (secret) => runtime.mask(secret),
          fetch: fetchFn,
        },
      ),
    });
  } catch (error) {
    throw new Error(
      `Codeman's backend settings are wrong: ${error instanceof Error ? error.message : error} See ${SETUP}.`,
    );
  }
}
