import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  expiresAt,
  keyPrefix,
  MIN_RUN_BUDGET,
  OpenRouter,
  runLimit,
  sumUsage,
  taskKeyPrefix,
  usd,
} from "../budget.ts";
import { encrypt } from "../crypto.ts";
import { positiveNumber } from "./common.ts";

/**
 * Creates the run's OpenRouter key, limited to what remains of the task's budget, unless that is
 * too little or the repository's monthly budget would be exceeded. The only job that reads the
 * management key, together with `closeKey`.
 */
export async function openKey(): Promise<void> {
  const router = new OpenRouter(core.getInput("management-key", { required: true }));
  const secret = core.getInput("encryption-secret", { required: true });
  const task = core.getInput("task", { required: true });
  const taskBudget = positiveNumber("task-budget");
  const monthlyBudget = positiveNumber("monthly-budget");
  const hours = positiveNumber("key-expiry-hours");
  const { owner, repo } = github.context.repo;
  const prefix = keyPrefix(owner, repo);

  const keys = await router.listKeys();
  const spent = sumUsage(keys, taskKeyPrefix(owner, repo, task), "usage");
  const used = sumUsage(keys, prefix, "usage_monthly");
  core.setOutput("task-spent", spent.toFixed(4));
  core.setOutput("month-spent", used.toFixed(4));
  core.info(`This task has spent ${usd(spent)} of ${usd(taskBudget)}.`);
  core.info(`OpenRouter usage this month: ${usd(used)} of ${usd(monthlyBudget)}.`);

  const limit = runLimit(taskBudget, spent);
  if (limit === undefined) {
    core.setOutput("status", "task-budget-spent");
    core.setOutput(
      "reason",
      `The task has spent ${usd(spent)} of its ${usd(taskBudget)} budget, and a run needs at least ${usd(MIN_RUN_BUDGET)}. A maintainer can raise it with \`/codeman set task-budget <usd>\`.`,
    );
    return;
  }
  if (used + limit > monthlyBudget) {
    core.setOutput("status", "over-budget");
    core.setOutput(
      "reason",
      `The monthly budget is reached: ${usd(used)} used of ${usd(monthlyBudget)}, and this run may use up to ${usd(limit)}.`,
    );
    return;
  }

  const { key, hash } = await router.createKey({
    name: `${prefix}${task}/${github.context.runId}`,
    limit,
    expiresAt: expiresAt(new Date(), hours),
  });
  core.setSecret(key);
  core.setOutput("status", "opened");
  core.setOutput("key-limit", limit.toFixed(2));
  core.setOutput("key-hash", hash);
  core.setOutput("encrypted-key", encrypt(key, secret));
  core.info(`Created a key limited to ${usd(limit)}, expiring in ${hours} hours.`);
}

/**
 * Disables the run's key, then reads what it spent. OpenRouter may count the last requests a
 * little later, so the usage is read until it stops changing, for up to about half a minute.
 */
export async function closeKey(): Promise<void> {
  const router = new OpenRouter(core.getInput("management-key", { required: true }));
  const hash = core.getInput("key-hash", { required: true });
  await router.disableKey(hash);
  core.info("Disabled the key.");

  let cost = await router.keyUsage(hash);
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const latest = await router.keyUsage(hash);
    if (latest === cost) break;
    cost = latest;
  }
  core.setOutput("run-cost", cost.toFixed(4));
  core.info(`This run spent ${usd(cost)}.`);
}
