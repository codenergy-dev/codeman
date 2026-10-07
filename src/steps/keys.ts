import { MIN_RUN_BUDGET, runLimit, usd } from "../budget.ts";
import { encrypt } from "../crypto.ts";
import { gpuProvider, parseInferenceChoice } from "../inference/index.ts";
import { releasePod } from "../inference/selfhosted.ts";
import type { Services } from "../services.ts";
import { positiveNumber } from "./common.ts";

/**
 * Gives the run its access to a model, limited to what remains of the task's budget, unless that
 * is too little or the repository's monthly budget would be exceeded, across every provider the
 * settings name. With `closeKey`, the only job that holds the providers' management credentials.
 */
export async function openKey({ runtime, inference, budget: budgets }: Services): Promise<void> {
  const secret = runtime.input("encryption-secret", { required: true });
  const task = runtime.input("task", { required: true });
  const taskBudget = positiveNumber(runtime, "task-budget");
  const monthlyBudget = positiveNumber(runtime, "monthly-budget");
  const { profile } = parseInferenceChoice(runtime.input("inference"));
  if (profile) runtime.info(`The run uses the inference profile \`${profile}\`.`);

  // Every provider the settings name counts in the month, so each needs its credentials.
  const budget = budgets();
  if (budget.missing.length > 0) {
    const secrets = budget.missing.map((name) => `\`${name}\``).join(", ");
    const reason = `The inference settings name a provider whose secret the workflow does not pass: ${secrets}. Add it to the repository's or the organization's secrets, or remove the profiles that name its provider.`;
    runtime.error(reason);
    runtime.output("status", "missing-credentials");
    runtime.output("reason", reason);
    return;
  }
  const spent = await budget.taskSpent(task);
  const months = await budget.monthSpent();
  const used = months.reduce((sum, month) => sum + month.spent, 0);
  runtime.output("task-spent", spent.toFixed(4));
  runtime.output("month-spent", used.toFixed(4));
  runtime.info(`This task has spent ${usd(spent)} of ${usd(taskBudget)}.`);
  const parts = months.map((month) => `${month.provider} ${usd(month.spent)}`).join(", ");
  runtime.info(`Usage this month (${parts}): ${usd(used)} of ${usd(monthlyBudget)}.`);

  const limit = runLimit(taskBudget, spent);
  if (limit === undefined) {
    runtime.output("status", "task-budget-spent");
    runtime.output(
      "reason",
      `The task has spent ${usd(spent)} of its ${usd(taskBudget)} budget, and a run needs at least ${usd(MIN_RUN_BUDGET)}. A maintainer can raise it with \`/codeman set task-budget <usd>\`.`,
    );
    return;
  }
  if (used + limit > monthlyBudget) {
    runtime.output("status", "over-budget");
    runtime.output(
      "reason",
      `The monthly budget is reached: ${usd(used)} used of ${usd(monthlyBudget)}, and this run may use up to ${usd(limit)}.`,
    );
    return;
  }

  const run = await inference().open({ task, runId: runtime.run.id, limit }, runtime);
  runtime.mask(run.credential);
  runtime.output("status", "opened");
  runtime.output("key-limit", limit.toFixed(2));
  runtime.output("handle", run.handle);
  // Older workflow files pass the handle on by this name.
  runtime.output("key-hash", run.handle);
  runtime.output("encrypted-key", encrypt(run.credential, secret));
  if (run.baseUrl) runtime.output("base-url", run.baseUrl);
  if (run.contextLength) runtime.output("context-length", String(run.contextLength));
}

/**
 * Ends the run's access to the model, whatever happened, then reads what it spent and used, and
 * what each run of the task spent, so apply can refresh the costs that earlier runs read too soon.
 */
export async function closeKey({ runtime, inference }: Services): Promise<void> {
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
  if (usage.taskCosts) runtime.output("task-costs", JSON.stringify(usage.taskCosts));
  if (usage.pod) runtime.output("pod", usage.pod);
  if (usage.podCosts) runtime.output("pod-costs", JSON.stringify(usage.podCosts));
  if (usage.keptPod) runtime.output("kept-pod", usage.keptPod);
}

/**
 * Terminates the pod that `closeKey` kept for the task's next run, once `apply` says the task
 * does not go on to one now. A kept pod that this job does not reach terminates itself after its
 * idle limit.
 */
export async function release({ runtime }: Services): Promise<void> {
  const choice = parseInferenceChoice(runtime.input("inference"));
  if (choice.inference !== "self-hosted" || choice.mode !== "pod") {
    runtime.info("Nothing to release: the run had no pod.");
    return;
  }
  const gpu = gpuProvider(choice.gpuProvider, runtime.input("gpu-key", { required: true }));
  if (!gpu.pods) throw new Error(`${gpu.name} has no pods.`);
  await releasePod(gpu.pods, runtime.input("handle", { required: true }), runtime);
}
