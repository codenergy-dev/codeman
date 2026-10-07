import type { RepositoryRef } from "../platform/types.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { Settings } from "../settings.ts";
import { positiveNumber } from "../steps/common.ts";
import { type InferenceBudget, type ProviderAccount, ProviderBudget } from "./budget.ts";
import { ENGINES } from "./engines.ts";
import { accountMonthSpent, type GpuProvider } from "./gpu.ts";
import { POD_IMAGE } from "./ollama.ts";
import { OpenRouter, OpenRouterProvider } from "./openrouter.ts";
import type { InferenceProvider } from "./provider.ts";
import { Runpod } from "./runpod.ts";
import { PodInference, ServerlessInference } from "./selfhosted.ts";
import { type PodSpend, selfHostedSpent } from "./spend.ts";
import { vllmContextLength, vllmProblems } from "./vllm.ts";

/**
 * Where a task's runs get their model, as `select` resolves it and the jobs after it read it
 * (its `inference` output). Holds no secret.
 */
export type InferenceChoice = (
  | { inference: "openrouter" }
  | (SelfHostedChoice & { mode: "pod"; gpuType: string; podReuse: "task" | "run" })
  | (SelfHostedChoice & { mode: "serverless"; endpoint: string })
) &
  Budgeted;

interface SelfHostedChoice {
  inference: "self-hosted";
  gpuProvider: string;
  engine: string;
  model: string;
  /** The pods its record lists. */
  pods: string[];
}

/** What the key jobs need for the budgets, whichever provider serves the run. */
interface Budgeted {
  /** The inference profile the run uses; undefined for the top-level settings. */
  profile?: string | undefined;
  /** Every provider the settings name, whose months add up: `openrouter` or a GPU provider. */
  providers: string[];
  /** What the task spent so far, from its record: in all, and on self-hosted inference. */
  recorded: { spent: number; selfHosted: number };
}

/** The task's choice of inference, from its resolved settings and its record. */
export function inferenceChoice(
  settings: Settings,
  record: {
    spent?: number | undefined;
    inference?: { pods: PodSpend[]; spent?: number | undefined } | undefined;
  } | null,
  options: { profile?: string | undefined; providers?: readonly string[] } = {},
): InferenceChoice {
  const budgeted: Budgeted = {
    ...(options.profile ? { profile: options.profile } : {}),
    providers: [...new Set([providerName(settings), ...(options.providers ?? [])])],
    recorded: { spent: record?.spent ?? 0, selfHosted: selfHostedSpent(record) },
  };
  if (settings.inference !== "self-hosted") return { inference: "openrouter", ...budgeted };
  const common = {
    inference: "self-hosted" as const,
    gpuProvider: settings["gpu-provider"],
    engine: settings.engine ?? "",
    model: settings.model,
    pods: record?.inference?.pods.map((pod) => pod.id) ?? [],
    ...budgeted,
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

/** The provider that serves the settings' runs: `openrouter`, or the GPU provider. */
function providerName(settings: Pick<Settings, "inference" | "gpu-provider">): string {
  return settings.inference === "self-hosted" ? settings["gpu-provider"] : "openrouter";
}

/** The provider whose credentials serve a choice's runs. */
export function choiceProvider(choice: InferenceChoice): string {
  return choice.inference === "self-hosted" ? choice.gpuProvider : "openrouter";
}

/** The `inference` input; empty, as from older workflow files, is OpenRouter. */
export function parseInferenceChoice(text: string): InferenceChoice {
  if (text.trim() === "") {
    return { inference: "openrouter", providers: ["openrouter"], recorded: zero() };
  }
  const choice = JSON.parse(text) as InferenceChoice;
  const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  const budgeted =
    Array.isArray(choice.providers) &&
    choice.providers.every((name) => typeof name === "string" && name !== "") &&
    amount(choice.recorded?.spent) &&
    amount(choice.recorded?.selfHosted) &&
    (choice.profile === undefined || typeof choice.profile === "string");
  if (!budgeted) throw new Error("The inference input is not a valid choice.");
  if (choice.inference === "openrouter") return choice;
  const valid =
    choice.inference === "self-hosted" &&
    typeof choice.model === "string" &&
    ENGINES[choice.engine] !== undefined &&
    Array.isArray(choice.pods) &&
    (choice.mode === "pod" ? typeof choice.gpuType === "string" : choice.mode === "serverless");
  if (!valid) throw new Error("The inference input is not a valid choice.");
  return choice;
}

function zero(): Budgeted["recorded"] {
  return { spent: 0, selfHosted: 0 };
}

/** Where a run's model is served: OpenRouter, a pod, or a Serverless endpoint. */
export type AgentMode = "openrouter" | "pod" | "serverless";

/** The agent's way to its model: the harness's own provider, a pod's gateway, or its own. */
export function agentMode(choice: InferenceChoice): AgentMode {
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
    return openRouterProvider(runtime, runtime.input("management-key", { required: true }));
  }
  return selfHosted(choice, runtime.repository, {
    accountKey: runtime.input("gpu-key", { required: true }),
    image: runtime.input("pod-image") || POD_IMAGE,
    usage: runtime.input("gateway-usage"),
  });
}

function openRouterProvider(runtime: Runtime, managementKey: string): OpenRouterProvider {
  return new OpenRouterProvider(new OpenRouter(managementKey), runtime.repository, () =>
    positiveNumber(runtime, "key-expiry-hours"),
  );
}

/** The input that carries each provider's account credentials, and the secret the template passes. */
export const CREDENTIALS: Readonly<Record<string, { input: string; secret: string }>> = {
  openrouter: { input: "management-key", secret: "CODEMAN_OPENROUTER_MANAGEMENT_KEY" },
  runpod: { input: "gpu-key", secret: "CODEMAN_RUNPOD_API_KEY" },
};

/**
 * The budgets across every provider the settings name, with the key jobs' credentials. `run` is
 * the provider of the run, whose account is read through it.
 */
export function inferenceBudget(runtime: Runtime, run: () => InferenceProvider): InferenceBudget {
  const choice = parseInferenceChoice(runtime.input("inference"));
  const own = choiceProvider(choice);
  const accounts: ProviderAccount[] = [];
  const missing: string[] = [];
  for (const name of new Set([own, ...choice.providers])) {
    const credential = CREDENTIALS[name];
    if (!credential) throw new Error(`Unknown inference provider "${name}".`);
    const key = runtime.input(credential.input);
    if (key === "") {
      missing.push(credential.secret);
      continue;
    }
    if (name === own) {
      accounts.push({ name, provider: run() });
    } else if (name === "openrouter") {
      accounts.push({ name, provider: openRouterProvider(runtime, key) });
    } else {
      const gpu = gpuProvider(name, key);
      accounts.push({ name, month: () => accountMonthSpent(gpu, new Date()) });
    }
  }
  return new ProviderBudget(choice.recorded, accounts, missing);
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
  const common = {
    model: choice.model,
    engine,
    taskSpent: choice.recorded.spent,
    pods: choice.pods,
  };
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
