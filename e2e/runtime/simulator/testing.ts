import { GitHubFake } from "../../fakes/github/github.ts";
import { acme } from "../../fakes/github/testing.ts";
import type { RunIdentity } from "../../fakes/google/oidc.ts";
import type { JobExecutor } from "./executor.ts";
import { fakeGitHub } from "./github.ts";
import {
  fixedWorkflows,
  type JobResult,
  type RunResult,
  Simulator,
  type SimulatorOptions,
} from "./simulator.ts";

/** What the simulator's tests share: the fake GitHub's `acme` world, and a simulator on it. */

export const SERVER = "https://github-e2e.localhost:8443";
export const OIDC_URL = `${SERVER}/oidc/token?api-version=2.0`;

export async function setup(
  files: Record<string, string>,
  executor: JobExecutor,
  options: Partial<SimulatorOptions> = {},
) {
  const fake = new GitHubFake({ serverUrl: SERVER });
  const world = await acme(fake);
  const github = fakeGitHub(fake, { server: SERVER });
  const identities: RunIdentity[] = [];
  const simulator = new Simulator({
    github,
    executor,
    workflows: fixedWorkflows(files),
    oidc: {
      requestUrl: OIDC_URL,
      register: (identity) => {
        identities.push(identity);
        return `oidc-request-${identities.length}`;
      },
    },
    secrets: () => ({
      CODEMAN_GITHUB_APP_PRIVATE_KEY: world.privateKey,
      TOP_SECRET: "s3cr3t-value",
    }),
    vars: () => ({
      CODEMAN_GITHUB_APP_CLIENT_ID: world.codeman.clientId,
      CODEMAN_COMMIT_SHA: "a".repeat(40),
    }),
    ...options,
  });
  return { fake, world, github, simulator, identities };
}

/** A `workflow_dispatch` run of `.github/workflows/main.yml`, awaited. */
export async function dispatch(
  simulator: Simulator,
  inputs: Record<string, string> = {},
  workflow = ".github/workflows/main.yml",
): Promise<RunResult> {
  const run = await simulator.start({
    repository: "acme/app",
    workflow,
    event: "workflow_dispatch",
    inputs,
  });
  return run.finished;
}

/** The results of a run's jobs by name. */
export function byName(result: RunResult): Record<string, JobResult> {
  return Object.fromEntries(result.jobs.map((job) => [job.name, job]));
}

/** Each job's result by name. */
export function results(result: RunResult): Record<string, string> {
  return Object.fromEntries(result.jobs.map((job) => [job.name, job.result]));
}
