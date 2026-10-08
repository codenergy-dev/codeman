import type { RepositoryRef } from "../platform/types.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { Settings } from "../settings.ts";
import { positiveNumber } from "../steps/common.ts";
import type { Store } from "../store/store.ts";
import type { ProviderAccounts } from "./budget.ts";
import { ENGINES } from "./engines.ts";
import type { GpuProvider } from "./gpu.ts";
import { POD_IMAGE } from "./ollama.ts";
import { OpenRouter, OpenRouterProvider } from "./openrouter.ts";
import type { InferenceProvider } from "./provider.ts";
import { ACCOUNTS, accountOf, isHourlyAccount, isProviderName } from "./providers.ts";
import { Runpod } from "./runpod.ts";
import { PodInference, ServerlessInference } from "./selfhosted.ts";
import type { PodSpend } from "./spend.ts";
import { vllmContextLength, vllmProblems } from "./vllm.ts";

/**
 * Where a task's runs get their model, as `select` resolves it and the jobs after it read it
 * (its `inference` output). Holds no secret.
 */
export type InferenceChoice = (
  | { provider: "openrouter" }
  | (SelfHostedChoice & {
      provider: "runpod-pod";
      gpu: string;
      podReuse: "task" | "run";
    })
  | (SelfHostedChoice & { provider: "runpod-serverless"; endpoint: string })
) &
  Budgeted;

/** A choice whose model Codeman serves on rented GPUs. */
export type SelfHostedChoice = {
  engine: string;
  model: string;
  /** The pods its record lists whose billing is the task's alone, not those shared. */
  pods: string[];
};

/** What the key jobs need for the budgets, whichever provider serves the run. */
interface Budgeted {
  /** The profile the run uses; undefined for the top-level settings. */
  profile?: string | undefined;
  /**
   * The account of every provider the settings name: `openrouter` or `runpod`, whose billing by
   * the hour reconciles the organization's month.
   */
  accounts: string[];
  /**
   * What the task's record says it spent, which the ledger carries for a task that started
   * before it.
   */
  recorded: { spent: number };
}

/** The task's choice of inference, from its resolved settings and its record. */
export function inferenceChoice(
  settings: Settings,
  record: {
    spent?: number | undefined;
    inference?: { pods: PodSpend[] } | undefined;
  } | null,
  options: {
    profile?: string | undefined;
    accounts?: readonly string[];
  } = {},
): InferenceChoice {
  const budgeted: Budgeted = {
    ...(options.profile ? { profile: options.profile } : {}),
    accounts: [...new Set([accountOf(settings.provider), ...(options.accounts ?? [])])],
    recorded: { spent: record?.spent ?? 0 },
  };
  if (settings.provider === "openrouter") return { provider: "openrouter", ...budgeted };
  const common = {
    engine: settings.engine ?? "",
    model: settings.model,
    pods: record?.inference?.pods.filter((pod) => !pod.shared).map((pod) => pod.id) ?? [],
    ...budgeted,
  };
  return settings.provider === "runpod-serverless"
    ? { ...common, provider: "runpod-serverless", endpoint: settings.endpoint ?? "" }
    : {
        ...common,
        provider: "runpod-pod",
        gpu: settings.gpu ?? "",
        podReuse: settings["pod-reuse"] === "run" ? "run" : "task",
      };
}

/** The `inference` input; empty, as from older workflow files, is OpenRouter. */
export function parseInferenceChoice(text: string): InferenceChoice {
  if (text.trim() === "") {
    return { provider: "openrouter", accounts: ["openrouter"], recorded: zero() };
  }
  const choice = JSON.parse(text) as InferenceChoice;
  const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  const budgeted =
    isProviderName(choice.provider) &&
    Array.isArray(choice.accounts) &&
    choice.accounts.every((name) => typeof name === "string" && name !== "") &&
    amount(choice.recorded?.spent) &&
    (choice.profile === undefined || typeof choice.profile === "string");
  if (!budgeted) throw new Error("The inference input is not a valid choice.");
  if (choice.provider === "openrouter") return choice;
  const valid =
    typeof choice.model === "string" &&
    ENGINES[choice.engine] !== undefined &&
    Array.isArray(choice.pods) &&
    (choice.provider === "runpod-pod"
      ? typeof choice.gpu === "string"
      : typeof choice.endpoint === "string");
  if (!valid) throw new Error("The inference input is not a valid choice.");
  return choice;
}

function zero(): Budgeted["recorded"] {
  return { spent: 0 };
}

/** The GPU cloud of an account that rents GPUs, with the account's key. */
export function gpuProvider(account: string, key: string): GpuProvider {
  if (account === "runpod") return new Runpod(key);
  throw new Error(`Unknown GPU account "${account}".`);
}

/**
 * The inference provider a key job uses, with the credentials of its inputs; pods use the pod
 * registry in Codeman's store.
 */
export function inferenceProvider(runtime: Runtime, store: () => Store): InferenceProvider {
  const choice = parseInferenceChoice(runtime.input("inference"));
  if (choice.provider === "openrouter") {
    return openRouterProvider(runtime, runtime.input("management-key", { required: true }));
  }
  return selfHosted(choice, runtime.repository, {
    accountKey: runtime.input("gpu-key", { required: true }),
    image: runtime.input("pod-image") || POD_IMAGE,
    usage: runtime.input("gateway-usage"),
    store,
  });
}

function openRouterProvider(runtime: Runtime, managementKey: string): OpenRouterProvider {
  return new OpenRouterProvider(new OpenRouter(managementKey), runtime.repository, () =>
    positiveNumber(runtime, "key-expiry-hours"),
  );
}

/** The providers' accounts that the budgets read, with the key jobs' credentials. */
export function providerAccounts(runtime: Runtime): ProviderAccounts {
  const credential = (name: string) => {
    const found = ACCOUNTS[name];
    if (!found) throw new Error(`Unknown account "${name}".`);
    return { ...found, key: runtime.input(found.input) };
  };
  return {
    missing: (name) => {
      const { key, secret } = credential(name);
      return key === "" ? secret : undefined;
    },
    taskCosts: async (task) => {
      const { key } = credential("openrouter");
      return key === "" ? undefined : openRouterProvider(runtime, key).taskCosts(task);
    },
    billedHours: async (name, start, end) => {
      if (!isHourlyAccount(name)) throw new Error(`${name} has no hourly billing.`);
      return gpuProvider(name, credential(name).key).billedHours(start, end);
    },
  };
}

/** Self-hosted inference for a choice, with the account key and the jobs' other inputs. */
export function selfHosted(
  choice: Exclude<InferenceChoice, { provider: "openrouter" }>,
  repository: RepositoryRef,
  inputs: {
    accountKey: string;
    image: string;
    usage: string;
    store: () => Store;
    gpu?: GpuProvider;
  },
): InferenceProvider {
  const gpu = inputs.gpu ?? gpuProvider(accountOf(choice.provider), inputs.accountKey);
  const engine = ENGINES[choice.engine];
  if (!engine) throw new Error(`Unknown engine "${choice.engine}".`);
  const common = { model: choice.model, engine, pods: choice.pods };
  if (choice.provider === "runpod-pod") {
    return new PodInference(
      {
        ...common,
        gpuType: choice.gpu,
        image: inputs.image,
        reuse: choice.podReuse,
      },
      { repository, gpu, accountKey: inputs.accountKey, store: inputs.store() },
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
