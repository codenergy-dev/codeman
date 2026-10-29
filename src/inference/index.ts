import { E2E } from "../e2e.ts";
import type { RepositoryRef } from "../platform/types.ts";
import { isLogin, isPoolId, MAX_POOL_MEMBERS, type Pool, soloPool } from "../pool.ts";
import type { Runtime } from "../runtime/runtime.ts";
import { MAX_TASKS, type Settings } from "../settings.ts";
import { positiveNumber } from "../steps/common.ts";
import type { Store } from "../store/store.ts";
import type { ProviderAccounts } from "./budget.ts";
import { ENGINES } from "./engines.ts";
import type { GpuProvider } from "./gpu.ts";
import type { ModelHub } from "./huggingface.ts";
import { podImage } from "./images.ts";
import { type OllamaSettings, ollamaEnvironment } from "./ollama.ts";
import { OpenRouter, OpenRouterProvider } from "./openrouter.ts";
import type { InferenceProvider } from "./provider.ts";
import { ACCOUNTS, accountOf, isHourlyAccount, isProviderName } from "./providers.ts";
import { Runpod } from "./runpod.ts";
import { PodInference, ServerlessInference } from "./selfhosted.ts";
import type { PodSpend } from "./spend.ts";
import {
  checkedVllm,
  type VllmSettings,
  vllmArguments,
  vllmContextLength,
  vllmProblems,
} from "./vllm.ts";

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
      /** The `ollama` settings, by key; absent without any. */
      ollama?: OllamaSettings | undefined;
      /** The `vllm` settings, by key; absent without any. */
      vllm?: VllmSettings | undefined;
      /**
       * The most tasks the run's profile serves at once, which `num-parallel` defaults to on
       * images that apply Ollama settings (choices 5 and 6 of the plan for fitting Ollama to the
       * GPU); absent from older choices.
       */
      parallel?: number | undefined;
      /**
       * The batch the task runs in, whose pod it joins (decision 13 of the plan for GPU batches
       * across repositories); absent for a task of no batch, and from older choices.
       */
      batch?: string | undefined;
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
  /**
   * The pool whose registry and accounts the run uses: its ID, and the members that agree on it
   * (choice 22 of the plan for GPU batches across repositories). Absent from older choices: the
   * organization alone.
   */
  pool?: Pool | undefined;
  /**
   * The run's batch key, and how many instances of it run at once, each serving at most `tasks`
   * tasks: pods on `runpod-pod`, batches of runs on other providers (the plan for limiting
   * concurrent instances of a profile). Absent from older choices: no cap.
   */
  concurrency?: ChoiceConcurrency | undefined;
}

/** A run's cap on the instances of its batch key. */
export interface ChoiceConcurrency {
  key: string;
  instances: number;
  tasks: number;
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
    /** The most tasks the run's profile serves at once (`mostTasks`). */
    parallel?: number | undefined;
    pool?: Pool | undefined;
    /** The batch of a pod's task. */
    batch?: string | undefined;
    /** The run's batch key, which its `concurrency` caps. */
    key?: string | undefined;
  } = {},
): InferenceChoice {
  const budgeted: Budgeted = {
    ...(options.profile ? { profile: options.profile } : {}),
    accounts: [...new Set([accountOf(settings.provider), ...(options.accounts ?? [])])],
    recorded: { spent: record?.spent ?? 0 },
    ...(options.pool ? { pool: options.pool } : {}),
    ...(options.key === undefined
      ? {}
      : {
          concurrency: {
            key: options.key,
            instances: settings.concurrency,
            tasks: options.parallel ?? 1,
          },
        }),
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
        ...(settings.ollama && Object.keys(settings.ollama).length > 0
          ? { ollama: settings.ollama }
          : {}),
        ...(settings.vllm && Object.keys(settings.vllm).length > 0 ? { vllm: settings.vllm } : {}),
        ...(options.parallel === undefined ? {} : { parallel: options.parallel }),
        ...(options.batch === undefined ? {} : { batch: options.batch }),
      };
}

/** A batch's ID: the workflow run and attempt that formed it, and its place among them. */
export function isBatchId(text: string): boolean {
  return /^\d+-\d+-\d+$/.test(text);
}

/**
 * The pool a choice names, which must include the repository's owner; the owner alone for a
 * choice without one.
 */
export function choicePool(choice: InferenceChoice, owner: string): Pool {
  const pool = choice.pool ?? soloPool(owner);
  if (!pool.members.includes(owner.toLowerCase())) {
    throw new Error(`The inference input names pool ${pool.id}, without ${owner.toLowerCase()}.`);
  }
  return pool;
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
    (choice.profile === undefined || typeof choice.profile === "string") &&
    (choice.pool === undefined || validPool(choice.pool)) &&
    (choice.concurrency === undefined || validConcurrency(choice.concurrency));
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
  if (choice.provider === "runpod-pod") {
    // The pod's environment comes from them: only the keys and values the lists take.
    for (const [block, check] of [
      [choice.ollama, ollamaEnvironment],
      [choice.vllm, vllmArguments],
    ] as const) {
      if (block === undefined) continue;
      const value: unknown = block;
      const strings =
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every((text) => typeof text === "string");
      if (!strings) throw new Error("The inference input is not a valid choice.");
      check(block);
    }
  }
  if (
    choice.provider === "runpod-pod" &&
    choice.batch !== undefined &&
    (typeof choice.batch !== "string" || !isBatchId(choice.batch))
  ) {
    throw new Error("The inference input is not a valid choice.");
  }
  if (choice.provider === "runpod-pod" && choice.parallel !== undefined) {
    const { parallel } = choice;
    if (!Number.isInteger(parallel) || parallel < 1 || parallel > MAX_TASKS) {
      throw new Error("The inference input is not a valid choice.");
    }
  }
  return choice;
}

/** A cap as a choice carries it: a batch key, and counts from 1 to `MAX_TASKS`. */
function validConcurrency(value: unknown): boolean {
  const cap = value as Partial<ChoiceConcurrency> | null;
  const count = (number: unknown) =>
    Number.isInteger(number) && (number as number) >= 1 && (number as number) <= MAX_TASKS;
  return (
    typeof cap?.key === "string" &&
    /^[0-9a-f]{16}$/.test(cap.key) &&
    count(cap.instances) &&
    count(cap.tasks)
  );
}

/** A pool as a choice carries it: its ID, and some of its members, by their lowercase logins. */
function validPool(value: unknown): boolean {
  const pool = value as Partial<Pool> | null;
  const members = pool?.members;
  return (
    typeof pool?.id === "string" &&
    isPoolId(pool.id) &&
    Array.isArray(members) &&
    members.length > 0 &&
    members.length <= MAX_POOL_MEMBERS &&
    members.every(
      (member) =>
        typeof member === "string" &&
        isLogin(member) &&
        member === member.toLowerCase() &&
        pool.id?.split("+").includes(member),
    )
  );
}

function zero(): Budgeted["recorded"] {
  return { spent: 0 };
}

/** The GPU cloud of an account that rents GPUs, with the account's key. */
export function gpuProvider(account: string, key: string): GpuProvider {
  if (account === "runpod") return E2E ? E2E.gpu(new Runpod(key, E2E.fetch)) : new Runpod(key);
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
    image: podImage(choice.engine, runtime.input("pod-image")),
    usage: runtime.input("gateway-usage"),
    store,
    fetch: E2E?.fetch,
  });
}

function openRouterProvider(runtime: Runtime, managementKey: string): OpenRouterProvider {
  return new OpenRouterProvider(new OpenRouter(managementKey, E2E?.fetch), runtime.repository, () =>
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
    /** For tests and the e2e build: the gateways' fetch, and where vLLM's models are checked. */
    fetch?: typeof fetch;
    hub?: ModelHub;
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
        ollama: ollamaEnvironment(choice.ollama),
        ...(choice.engine === "vllm" ? { vllm: checkedVllm(choice.vllm) } : {}),
        parallel: choice.parallel,
        batch: choice.batch,
        ...(choice.concurrency
          ? { concurrency: { key: choice.concurrency.key, pods: choice.concurrency.instances } }
          : {}),
      },
      {
        repository,
        gpu,
        accountKey: inputs.accountKey,
        store: inputs.store(),
        pool: choicePool(choice, repository.owner),
        ...(inputs.fetch ? { fetch: inputs.fetch } : {}),
        ...(inputs.hub ? { hub: inputs.hub } : {}),
      },
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
