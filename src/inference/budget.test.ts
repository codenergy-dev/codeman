import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRun } from "../settings.ts";
import { FakeInference } from "../testing/fake-inference.ts";
import { FakeRuntime } from "../testing/fake-runtime.ts";
import { ProviderBudget } from "./budget.ts";
import { inferenceBudget, inferenceChoice } from "./index.ts";

test("the month adds up each provider's, and the task's OpenRouter keys add to its self-hosted part", async () => {
  const openRouter = new FakeInference({ spent: 0.4, month: 3 });
  const budget = new ProviderBudget({ spent: 0.9, selfHosted: 0.5 }, [
    { name: "openrouter", provider: openRouter },
    { name: "runpod", month: async () => 7 },
  ]);
  assert.equal(await budget.taskSpent("7"), 0.9);
  openRouter.spent = 0.6;
  assert.equal(await budget.taskSpent("7"), 1.1, "OpenRouter's keys are read again");
  assert.deepEqual(await budget.monthSpent(), [
    { provider: "openrouter", spent: 3 },
    { provider: "runpod", spent: 7 },
  ]);
  // Without OpenRouter, the record's total, which counts what earlier OpenRouter runs spent.
  const selfHostedOnly = new ProviderBudget({ spent: 0.9, selfHosted: 0.5 }, [
    { name: "runpod", month: async () => 7 },
  ]);
  assert.equal(await selfHostedOnly.taskSpent("7"), 0.9);
});

function choiceOf(stage: "plan" | "code"): string {
  const resolved = resolveRun(
    [
      {},
      {},
      {
        model: "a/b",
        "inference-profiles": [
          {
            name: "pods",
            when: { stages: ["code"] },
            settings: { inference: "self-hosted", model: "qwen3-coder:30b", "gpu-type": "G1" },
          },
        ],
      },
    ],
    { stage, tasks: 1 },
  );
  assert.ok(resolved.ok);
  if (!resolved.ok) return "";
  const { settings, profile, providers } = resolved.value;
  return JSON.stringify(inferenceChoice(settings, null, { profile, providers }));
}

test("the key jobs need every named provider's secret, and read the run's own through it", () => {
  let built = 0;
  const run = () => {
    built++;
    return new FakeInference();
  };
  const both = inferenceBudget(
    new FakeRuntime({
      inputs: { inference: choiceOf("plan"), "management-key": "mk", "gpu-key": "rk" },
    }),
    run,
  );
  assert.deepEqual(both.missing, []);
  assert.equal(built, 1, "OpenRouter serves the planning run");

  const noRunpod = inferenceBudget(
    new FakeRuntime({ inputs: { inference: choiceOf("plan"), "management-key": "mk" } }),
    run,
  );
  assert.deepEqual(noRunpod.missing, ["CODEMAN_RUNPOD_API_KEY"]);
  const noOpenRouter = inferenceBudget(
    new FakeRuntime({ inputs: { inference: choiceOf("code"), "gpu-key": "rk" } }),
    run,
  );
  assert.deepEqual(noOpenRouter.missing, ["CODEMAN_OPENROUTER_MANAGEMENT_KEY"]);
  // Before profiles, a choice named only its own provider.
  const alone = inferenceBudget(new FakeRuntime({ inputs: { "management-key": "mk" } }), run);
  assert.deepEqual(alone.missing, []);
});
