import * as core from "@actions/core";
import * as github from "@actions/github";
import { expiresAt, keyPrefix, OpenRouter } from "../budget.ts";
import { encrypt } from "../crypto.ts";
import { positiveNumber } from "./common.ts";

/**
 * Creates the task's OpenRouter key, unless the repository's monthly budget would be exceeded.
 * The only job that reads the management key, together with `closeKey`.
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

  const used = await router.monthlyUsage(prefix);
  core.info(`OpenRouter usage this month: US$ ${used.toFixed(2)} of US$ ${monthlyBudget}.`);
  if (used + taskBudget > monthlyBudget) {
    core.setOutput("status", "over-budget");
    core.setOutput(
      "reason",
      `The monthly budget is reached: US$ ${used.toFixed(2)} used of US$ ${monthlyBudget}, and a task may use up to US$ ${taskBudget}.`,
    );
    return;
  }

  const { key, hash } = await router.createKey({
    name: `${prefix}${task}/${github.context.runId}`,
    limit: taskBudget,
    expiresAt: expiresAt(new Date(), hours),
  });
  core.setSecret(key);
  core.setOutput("status", "opened");
  core.setOutput("key-hash", hash);
  core.setOutput("encrypted-key", encrypt(key, secret));
  core.info(`Created a key limited to US$ ${taskBudget}, expiring in ${hours} hours.`);
}

export async function closeKey(): Promise<void> {
  const router = new OpenRouter(core.getInput("management-key", { required: true }));
  await router.disableKey(core.getInput("key-hash", { required: true }));
  core.info("Disabled the task key.");
}
