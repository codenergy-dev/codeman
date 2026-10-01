import { gitHubServices, run } from "./main.ts";
import { GitHubActionsRuntime } from "./runtime/github-actions.ts";

const runtime = new GitHubActionsRuntime();
run(gitHubServices(runtime)).catch((error: unknown) => {
  runtime.fail(error instanceof Error ? error.message : String(error));
});
