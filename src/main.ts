import { inferenceBudget, inferenceProvider } from "./inference/index.ts";
import type { InferenceProvider } from "./inference/provider.ts";
import { GitHubActionsResults } from "./platform/github/ci.ts";
import { GITHUB } from "./platform/github/conventions.ts";
import { GitHubPlatform, octokit } from "./platform/github/platform.ts";
import type { Runtime } from "./runtime/runtime.ts";
import type { Services } from "./services.ts";
import { agent } from "./steps/agent.ts";
import { apply } from "./steps/apply.ts";
import { closeKey, openKey, release } from "./steps/keys.ts";
import { select } from "./steps/select.ts";

/** Each job of the Codeman workflow runs one step. See docs/architecture.md. */
const STEPS: Record<string, (services: Services) => Promise<void>> = {
  select,
  "open-key": openKey,
  agent,
  apply,
  "close-key": closeKey,
  "release-pod": release,
};

/**
 * Codeman on GitHub: the App's tokens for the platform, the job's token for CI results, and the
 * inference provider with the key jobs' credentials.
 */
export function gitHubServices(runtime: Runtime): Services {
  const client = (input: string) => octokit(runtime.input(input, { required: true }));
  // One provider per job, so the budgets and the run share what it read.
  let provider: InferenceProvider | undefined;
  const inference = () => {
    provider ??= inferenceProvider(runtime);
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
    budget: () => inferenceBudget(runtime, inference),
  };
}

export async function run(services: Services): Promise<void> {
  const name = services.runtime.input("step", { required: true });
  const step = STEPS[name];
  if (!step)
    throw new Error(`Unknown step "${name}". Use one of: ${Object.keys(STEPS).join(", ")}.`);
  await step(services);
}
