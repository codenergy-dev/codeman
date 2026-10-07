import {
  type BilledHours,
  costsByWorkflowRun,
  expired,
  MIN_RUN_BUDGET,
  monthStart,
  taskTotal,
  usd,
} from "../budget.ts";
import { encrypt } from "../crypto.ts";
import {
  choiceProvider,
  gpuProvider,
  isGpuProvider,
  parseInferenceChoice,
} from "../inference/index.ts";
import type { OpenedRun, PodEvent } from "../inference/provider.ts";
import { releasePod } from "../inference/selfhosted.ts";
import { type Ledger, ledgerRun } from "../ledger.ts";
import type { Services } from "../services.ts";
import { oneLine } from "../text.ts";
import { positiveNumber } from "./common.ts";

/**
 * Gives the run its access to a model, limited to what remains of the task's budget, unless that
 * is too little or the repository's or the organization's monthly budget would be exceeded. The
 * budgets come from Codeman's ledger, where the run's limit is reserved before the run opens, so
 * runs that open at once never pass them together. With `closeKey`, the only job that holds the
 * providers' management credentials.
 */
export async function openKey(services: Services): Promise<void> {
  const { runtime } = services;
  const run = ledgerRun(runtime);
  // The backend first: a run the ledger cannot record opens nothing.
  const ledger = services.ledger("open-key");
  await ledger.check(runtime);
  const outcome = await open(services, ledger, run);
  if (outcome.status === "opened") ledger.open(run, outcome.limit, outcome.pods);
  else ledger.refuse(run, outcome.status, outcome.reason);
  await ledger.flush(runtime);
}

/** What `open` did: opened the run with a limit, or refused it, and why. */
type Opened =
  | { status: "opened"; limit: number; pods: PodEvent[] | undefined }
  | {
      status:
        | "missing-credentials"
        | "task-budget-spent"
        | "over-budget"
        | "over-organization-budget";
      reason: string;
    };

async function open(services: Services, ledger: Ledger, run: string): Promise<Opened> {
  const { runtime, inference } = services;
  const secret = runtime.input("encryption-secret", { required: true });
  const task = runtime.input("task", { required: true });
  const taskBudget = positiveNumber(runtime, "task-budget");
  const monthlyBudget = positiveNumber(runtime, "monthly-budget");
  // Only the organization's settings set it; empty when they do not.
  const organizationBudget =
    runtime.input("organization-monthly-budget") === ""
      ? undefined
      : positiveNumber(runtime, "organization-monthly-budget");
  const choice = parseInferenceChoice(runtime.input("inference"));
  if (choice.profile) runtime.info(`The run uses the inference profile \`${choice.profile}\`.`);
  const refuse = (status: Exclude<Opened["status"], "opened">, reason: string): Opened => {
    runtime.output("status", status);
    runtime.output("reason", reason);
    return { status, reason };
  };

  // The run's provider; with an organization's budget, also each GPU account whose billing
  // reconciles the organization's month: those the settings name, and those its runs used.
  const accounts = services.accounts();
  const now = new Date();
  const needed = new Set([choiceProvider(choice)]);
  if (organizationBudget !== undefined) {
    const used = (await ledger.monthRuns(runtime)).map((other) => other.provider);
    for (const name of [...choice.providers, ...used]) if (isGpuProvider(name)) needed.add(name);
  }
  const missing = [...needed].flatMap((name) => accounts.missing(name) ?? []);
  if (missing.length > 0) {
    const secrets = missing.map((name) => `\`${name}\``).join(", ");
    const reason = `The run needs secrets the workflow does not pass: ${secrets}. Its provider's account opens the run, and with \`organization-monthly-budget\`, each GPU account's billing counts in the organization's month. Add them to the repository's or the organization's secrets.`;
    runtime.error(reason);
    return refuse("missing-credentials", reason);
  }
  const billed = new Map<string, BilledHours>();
  if (organizationBudget !== undefined) {
    for (const name of needed) {
      if (isGpuProvider(name))
        billed.set(name, await accounts.billedHours(name, monthStart(now), now));
    }
  }

  // A run that never closed counts its limit; once it expired, OpenRouter's keys tell its cost.
  const runs = await ledger.taskRuns(run, runtime);
  if (runs.some((other) => other.provider === "openrouter" && expired(other, now))) {
    const costs = await accounts.taskCosts(task).catch((error: unknown) => {
      runtime.warning(
        `Could not read what the task's OpenRouter runs spent: ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    });
    if (costs) await ledger.refresh(runs, { costs }, runtime);
  }

  const reservation = await ledger.reserve(run, {
    task: Number(task),
    taskBudget,
    monthlyBudget,
    organizationBudget,
    recorded: choice.recorded.spent,
    billed,
  });
  const { limit } = reservation;
  runtime.output("task-spent", reservation.task.toFixed(4));
  runtime.output("month-spent", reservation.month.toFixed(4));
  runtime.info(`This task has spent ${usd(reservation.task)} of ${usd(taskBudget)}.`);
  const { reserved } = reservation;
  const held =
    reserved.runs > 0
      ? `, of which ${reserved.runs} open run(s) reserve ${usd(reserved.amount)}`
      : "";
  runtime.info(
    `This month, the repository's runs count ${usd(reservation.month)} of ${usd(monthlyBudget)}${held}.`,
  );
  if (reservation.organization !== undefined && organizationBudget !== undefined) {
    runtime.output("organization-month-spent", reservation.organization.toFixed(4));
    const hours =
      billed.size > 0 ? `, with ${[...billed.keys()].join(" and ")}'s hourly billing` : "";
    runtime.info(
      `This month, the organization's runs count ${usd(reservation.organization)} of ${usd(organizationBudget)}${hours}.`,
    );
  }

  if (reservation.outcome === "task-budget-spent" || limit === undefined) {
    return refuse(
      "task-budget-spent",
      `The task has spent ${usd(reservation.task)} of its ${usd(taskBudget)} budget, and a run needs at least ${usd(MIN_RUN_BUDGET)}. A maintainer can raise it with \`/codeman set task-budget <usd>\`.`,
    );
  }
  if (reservation.outcome === "over-budget") {
    return refuse(
      "over-budget",
      `The monthly budget is reached: ${usd(reservation.month)} used of ${usd(monthlyBudget)}, and this run may use up to ${usd(limit)}.`,
    );
  }
  if (reservation.outcome === "over-organization-budget") {
    return refuse(
      "over-organization-budget",
      `The organization's monthly budget is reached: ${usd(reservation.organization ?? 0)} used of ${usd(organizationBudget ?? 0)}, and this run may use up to ${usd(limit)}.`,
    );
  }
  runtime.info(`Reserved ${usd(limit)} for this run in Codeman's ledger.`);

  let opened: OpenedRun;
  try {
    opened = await inference().open({ task, runId: runtime.run.id, limit }, runtime);
  } catch (error) {
    // The reservation ends; a reservation that cannot be ended counts until it expires.
    ledger.fail(run, oneLine(error instanceof Error ? error.message : String(error)));
    await ledger.flush(runtime).catch((flushError: unknown) => {
      runtime.warning(
        `Could not end the run's reservation, which counts its limit until it expires: ${flushError instanceof Error ? flushError.message : flushError}`,
      );
    });
    throw error;
  }
  runtime.mask(opened.credential);
  runtime.output("status", "opened");
  runtime.output("key-limit", limit.toFixed(2));
  runtime.output("handle", opened.handle);
  // Older workflow files pass the handle on by this name.
  runtime.output("key-hash", opened.handle);
  runtime.output("encrypted-key", encrypt(opened.credential, secret));
  if (opened.baseUrl) runtime.output("base-url", opened.baseUrl);
  if (opened.contextLength) runtime.output("context-length", String(opened.contextLength));
  return { status: "opened", limit, pods: opened.pods };
}

/**
 * Ends the run's access to the model, whatever happened, then reads what it spent and used, and
 * records it in the ledger, with what the providers now say each earlier run of the task spent.
 * Reports the task's total and each run's cost from the ledger, so apply can refresh the costs
 * that earlier runs read too soon.
 */
export async function closeKey(services: Services): Promise<void> {
  const { runtime, inference } = services;
  const handle = runtime.input("handle") || runtime.input("key-hash", { required: true });
  const usage = await inference().close(handle, runtime);

  runtime.output("run-cost", usage.cost.toFixed(4));
  runtime.info(`This run spent ${usd(usage.cost)}.`);
  if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    runtime.output("input-tokens", String(usage.inputTokens));
    runtime.output("output-tokens", String(usage.outputTokens));
    runtime.info(
      `This run used ${usage.inputTokens} input and ${usage.outputTokens} output tokens.`,
    );
  }
  if (usage.requests !== undefined) {
    runtime.output("requests", String(usage.requests));
    if (usage.maxInputTokens !== undefined) {
      runtime.output("max-input-tokens", String(usage.maxInputTokens));
    }
    if (usage.tokensPerSecond !== undefined) {
      runtime.output("tokens-per-second", usage.tokensPerSecond.toFixed(1));
    }
    runtime.info(
      `Requests: ${usage.requests}; largest prompt: ${usage.maxInputTokens ?? "unknown"} tokens; mean throughput: ${usage.tokensPerSecond?.toFixed(1) ?? "unknown"} tokens per second.`,
    );
  }
  if (usage.pod) runtime.output("pod", usage.pod);
  if (usage.podShared) runtime.output("pod-shared", "true");
  if (usage.keptPod) runtime.output("kept-pod", usage.keptPod);

  // Last: the run's access is ended and its usage reported whatever the ledger does.
  const ledger = services.ledger("close-key");
  const run = ledgerRun(runtime);
  ledger.close(run, usage, runtime.input("agent-job-result"));
  await ledger.flush(runtime);
  const runs = await ledger.refresh(
    await ledger.taskRuns(run, runtime),
    { costs: usage.taskCosts, pods: usage.podCosts },
    runtime,
  );
  const total = taskTotal(runs);
  runtime.output("task-total", total.toFixed(4));
  runtime.output("task-costs", JSON.stringify(costsByWorkflowRun(runs)));
  runtime.info(`The task has spent ${usd(total)} in all.`);
}

/**
 * Terminates the pod that `closeKey` kept for the task's next run, once `apply` says the task
 * does not go on to one now; a pod the run's tasks share stays while another task uses or keeps
 * it. A kept pod that this job does not reach terminates itself after its idle limit.
 */
export async function release(services: Services): Promise<void> {
  const { runtime } = services;
  const choice = parseInferenceChoice(runtime.input("inference"));
  if (choice.inference !== "self-hosted" || choice.mode !== "pod") {
    runtime.info("Nothing to release: the run had no pod.");
    return;
  }
  const accountKey = runtime.input("gpu-key", { required: true });
  const gpu = gpuProvider(choice.gpuProvider, accountKey);
  if (!gpu.pods) throw new Error(`${gpu.name} has no pods.`);
  const handle = runtime.input("handle", { required: true });
  const pods = await releasePod(gpu.pods, handle, runtime, { accountKey });
  const ledger = services.ledger("release-pod");
  ledger.release(ledgerRun(runtime), pods);
  await ledger.flush(runtime);
}
