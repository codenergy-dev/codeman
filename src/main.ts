import { inferenceProvider, providerAccounts } from "./inference/index.ts";
import type { InferenceProvider } from "./inference/provider.ts";
import { Ledger } from "./ledger.ts";
import { GitHubActionsResults } from "./platform/github/ci.ts";
import { GITHUB } from "./platform/github/conventions.ts";
import { GitHubPlatform, octokit } from "./platform/github/platform.ts";
import type { Runtime } from "./runtime/runtime.ts";
import type { Services } from "./services.ts";
import { agent } from "./steps/agent.ts";
import { apply } from "./steps/apply.ts";
import { closeKey, openKey, release } from "./steps/keys.ts";
import { select } from "./steps/select.ts";
import { backendStore } from "./store/backend.ts";
import type { Store } from "./store/store.ts";

/** Each job of the Codeman workflow runs one step. See docs/runs/runs-and-jobs.md#jobs. */
const STEPS: Record<string, (services: Services) => Promise<void>> = {
  select,
  "open-key": openKey,
  agent,
  apply,
  "close-key": closeKey,
  "release-pod": release,
};

/**
 * Codeman on GitHub: the App's tokens for the platform, the job's token for CI results, the
 * inference provider with the key jobs' credentials, and the store with the job's OIDC token.
 */
export function gitHubServices(runtime: Runtime): Services {
  const client = (input: string) => octokit(runtime.input(input, { required: true }));
  // One provider per job, which opens or closes its run.
  let provider: InferenceProvider | undefined;
  // One store per job, so its token serves every request.
  let store: Store | undefined;
  const theStore = () => {
    store ??= backendStore(runtime);
    return store;
  };
  const inference = () => {
    provider ??= inferenceProvider(runtime, theStore);
    return provider;
  };
  return {
    runtime,
    conventions: GITHUB,
    platform: (access = "default") =>
      new GitHubPlatform(
        client(access === "workflows" ? "workflow-token" : "github-token"),
        runtime.repository,
        { appSlug: runtime.input("app-slug") || undefined },
      ),
    ci: () => new GitHubActionsResults(client("github-token"), runtime.repository),
    inference,
    accounts: () => providerAccounts(runtime),
    store: theStore,
    ledger: (job) => new Ledger(theStore(), { runtime, job }),
  };
}

export async function run(services: Services): Promise<void> {
  const name = services.runtime.input("step", { required: true });
  const step = STEPS[name];
  if (!step)
    throw new Error(`Unknown step "${name}". Use one of: ${Object.keys(STEPS).join(", ")}.`);
  await step(services);
}
