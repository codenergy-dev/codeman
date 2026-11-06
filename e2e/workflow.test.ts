import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { GPU_TYPES } from "./live/check.ts";

/**
 * The rules of the e2e workflow (docs/plans/2026-11-04-run-e2e-on-github-runners.md, "Secrets and
 * what a public repository shows"): started by hand only, read-only, and the Runpod key only in
 * the pod job's steps that call Runpod, under the `E2E` environment.
 */
const text = readFileSync(".github/workflows/e2e.yml", "utf8");
interface Step {
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  environment?: string;
  steps: Step[];
}
const workflow = parse(text) as {
  on: { workflow_dispatch: { inputs: Record<string, { options?: string[]; default?: unknown }> } };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

test("the e2e workflow is started by hand only, and reads the repository only", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.ok(!text.includes("pull_request_target"));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(!("permissions" in job), "no job widens the permissions");
    for (const step of job.steps) {
      if (step.uses?.startsWith("actions/checkout@")) {
        assert.equal(step.with?.["persist-credentials"], false);
      }
      if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/, "actions pinned by SHA");
    }
  }
});

test("only the pod job names the environment, and only its Runpod steps get the key", () => {
  const { suite, pod } = workflow.jobs;
  assert.ok(suite && pod);
  assert.equal(suite.environment, undefined);
  assert.equal(suite.if, "inputs.check == 'suite'");
  assert.equal(pod.environment, "E2E");
  assert.equal(pod.if, "inputs.check == 'pod'");
  assert.equal([...text.matchAll(/secrets\./g)].length, 2, "the key, in two steps only");
  const keyed = pod.steps.filter((step) => step.env?.CODEMAN_RUNPOD_API_KEY !== undefined);
  assert.deepEqual(
    keyed.map((step) => step.run),
    ["node e2e/live/pod.ts", "node e2e/live/pod.ts --cleanup"],
  );
  for (const step of keyed) {
    assert.match(
      step.env?.CODEMAN_RUNPOD_API_KEY ?? "",
      /^\$\{\{ secrets\.CODEMAN_RUNPOD_API_KEY \}\}$/,
    );
  }
  // Inputs reach scripts through the environment, never inside a script.
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) assert.ok(!step.run?.includes("${{"), step.run);
  }
  assert.ok(!pod.steps.some((step) => step.uses?.startsWith("actions/upload-artifact@")));
});

test("the workflow's GPU types are the pod check's, after auto", () => {
  const { gpu, community } = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(gpu?.options, ["auto", ...GPU_TYPES]);
  assert.equal(gpu?.default, "auto");
  assert.equal(community?.default, true);
});
