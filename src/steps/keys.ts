import { MIN_RUN_BUDGET, runLimit, usd } from "../budget.ts";
import { encrypt } from "../crypto.ts";
import type { Services } from "../services.ts";
import { positiveNumber } from "./common.ts";

/**
 * Gives the run its access to a model, limited to what remains of the task's budget, unless that
 * is too little or the repository's monthly budget would be exceeded. With `closeKey`, the only
 * job that holds the inference provider's management credentials.
 */
export async function openKey({ runtime, inference }: Services): Promise<void> {
  const provider = inference();
  const secret = runtime.input("encryption-secret", { required: true });
  const task = runtime.input("task", { required: true });
  const taskBudget = positiveNumber(runtime, "task-budget");
  const monthlyBudget = positiveNumber(runtime, "monthly-budget");

  const spent = await provider.taskSpent(task);
  const used = await provider.monthSpent();
  runtime.output("task-spent", spent.toFixed(4));
  runtime.output("month-spent", used.toFixed(4));
  runtime.info(`This task has spent ${usd(spent)} of ${usd(taskBudget)}.`);
  runtime.info(`Usage this month (${provider.name}): ${usd(used)} of ${usd(monthlyBudget)}.`);

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

  const run = await provider.open({ task, runId: runtime.run.id, limit }, runtime);
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
}
