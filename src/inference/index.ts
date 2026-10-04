import type { RepositoryRef } from "../platform/types.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { Settings } from "../settings.ts";
import { positiveNumber } from "../steps/common.ts";
import { ENGINES } from "./engines.ts";
import type { GpuProvider } from "./gpu.ts";
import { POD_IMAGE } from "./ollama.ts";
import { OpenRouter, OpenRouterProvider } from "./openrouter.ts";
import type { InferenceProvider } from "./provider.ts";
import { Runpod } from "./runpod.ts";
import { PodInference, ServerlessInference } from "./selfhosted.ts";
import type { PodSpend } from "./spend.ts";
import { vllmContextLength, vllmProblems } from "./vllm.ts";

/**
 * Where a task's runs get their model, as `select` resolves it and the jobs after it read it
 * (its `inference` output). Holds no secret.
 */
export type InferenceChoice =
  | { inference: "openrouter" }
  | (SelfHostedChoice & { mode: "pod"; gpuType: string; podReuse: "task" | "run" })
  | (SelfHostedChoice & { mode: "serverless"; endpoint: string });

interface SelfHostedChoice {
  inference: "self-hosted";
  gpuProvider: string;
  engine: string;
  model: string;
  /** What the task spent so far, from its record. */
  taskSpent: number;
  /** The pods its record lists. */
  pods: string[];
}

/** The task's choice of inference, from its resolved settings and its record. */
export function inferenceChoice(
  settings: Settings,
  record: { spent?: number | undefined; inference?: { pods: PodSpend[] } | undefined } | null,
): InferenceChoice {
  if (settings.inference !== "self-hosted") return { inference: "openrouter" };
  const common = {
    inference: "self-hosted" as const,
    gpuProvider: settings["gpu-provider"],
    engine: settings.engine ?? "",
    model: settings.model,
    taskSpent: record?.spent ?? 0,
    pods: record?.inference?.pods.map((pod) => pod.id) ?? [],
  };
  return settings["gpu-mode"] === "serverless"
    ? { ...common, mode: "serverless", endpoint: settings["serverless-endpoint"] ?? "" }
    : {
        ...common,
        mode: "pod",
        gpuType: settings["gpu-type"] ?? "",
        podReuse: settings["pod-reuse"] === "run" ? "run" : "task",
      };
}

/** The `inference` input; empty, as from older workflow files, is OpenRouter. */
export function parseInferenceChoice(text: string): InferenceChoice {
  if (text.trim() === "") return { inference: "openrouter" };
  const choice = JSON.parse(text) as InferenceChoice;
  if (choice.inference === "openrouter") return choice;
  const valid =
    choice.inference === "self-hosted" &&
    typeof choice.model === "string" &&
    ENGINES[choice.engine] !== undefined &&
    Number.isFinite(choice.taskSpent) &&
    Array.isArray(choice.pods) &&
    (choice.mode === "pod" ? typeof choice.gpuType === "string" : choice.mode === "serverless");
  if (!valid) throw new Error("The inference input is not a valid choice.");
  return choice;
}

/** The agent's way to its model: the harness's own provider, a pod's gateway, or its own. */
export function agentMode(choice: InferenceChoice): "openrouter" | "pod" | "serverless" {
  return choice.inference === "openrouter" ? "openrouter" : choice.mode;
}

export function gpuProvider(name: string, key: string): GpuProvider {
  if (name === "runpod") return new Runpod(key);
  throw new Error(`Unknown GPU provider "${name}".`);
}

/** The inference provider a key job uses, with the credentials of its inputs. */
export function inferenceProvider(runtime: Runtime): InferenceProvider {
  const choice = parseInferenceChoice(runtime.input("inference"));
  if (choice.inference === "openrouter") {
    return new OpenRouterProvider(
      new OpenRouter(runtime.input("management-key", { required: true })),
      runtime.repository,
      () => positiveNumber(runtime, "key-expiry-hours"),
    );
  }
  return selfHosted(choice, runtime.repository, {
    accountKey: runtime.input("gpu-key", { required: true }),
    image: runtime.input("pod-image") || POD_IMAGE,
    usage: runtime.input("gateway-usage"),
  });
}

/** Self-hosted inference for a choice, with the account key and the jobs' other inputs. */
export function selfHosted(
  choice: Exclude<InferenceChoice, { inference: "openrouter" }>,
  repository: RepositoryRef,
  inputs: { accountKey: string; image: string; usage: string; gpu?: GpuProvider },
): InferenceProvider {
  const gpu = inputs.gpu ?? gpuProvider(choice.gpuProvider, inputs.accountKey);
  const engine = ENGINES[choice.engine];
  if (!engine) throw new Error(`Unknown engine "${choice.engine}".`);
  const common = { model: choice.model, engine, taskSpent: choice.taskSpent, pods: choice.pods };
  if (choice.mode === "pod") {
    return new PodInference(
      { ...common, gpuType: choice.gpuType, image: inputs.image, reuse: choice.podReuse },
      { repository, gpu, accountKey: inputs.accountKey },
    );
  }
  return new ServerlessInference(
    {
      ...common,
      endpoint: choice.endpoint,
      engineProblems: vllmProblems,
      contextLength: vllmContextLength,
    },
    gpu,
    { usage: inputs.usage },
  );
}
