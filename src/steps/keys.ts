import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  costsByRun,
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
 * Disables the run's key, then reads what it spent and used, and what each run of the task
 * spent, so apply can refresh the costs that earlier runs read too soon.
 */
export async function closeKey(): Promise<void> {
  const router = new OpenRouter(core.getInput("management-key", { required: true }));
  const hash = core.getInput("key-hash", { required: true });
  await router.disableKey(hash);
  core.info("Disabled the key.");

  let cost = await runCost(router, hash, false);
  const tokens = await runTokens(router, hash, cost > 0);
  if (cost === 0 && tokens && tokens.input + tokens.output > 0) {
    // The analytics counted requests that the key's usage does not show yet.
    core.info("OpenRouter has tokens for this run's key but no cost yet; reading it again.");
    cost = await runCost(router, hash, true);
    if (cost === 0) core.warning("OpenRouter has no cost for this run's key yet.");
  }
  core.setOutput("run-cost", cost.toFixed(4));
  core.info(`This run spent ${usd(cost)}.`);
  if (tokens) {
    core.setOutput("input-tokens", String(tokens.input));
    core.setOutput("output-tokens", String(tokens.output));
    core.info(`This run used ${tokens.input} input and ${tokens.output} output tokens.`);
  }

  const costs = await taskCosts(router, hash);
  if (costs) core.setOutput("task-costs", JSON.stringify(costs));
}

/**
 * What the key spent. OpenRouter may count the last requests a little later, so the usage is
 * read until it stops changing, for up to about half a minute. For a key known to be `used`, a
 * usage of zero is not final: it is read for up to about a minute.
 */
export async function runCost(
  router: Pick<OpenRouter, "keyUsage">,
  hash: string,
  used: boolean,
  wait = sleep,
): Promise<number> {
  let cost = await router.keyUsage(hash);
  for (let attempt = 0; attempt < (used ? 12 : 6); attempt++) {
    await wait(5_000);
    const latest = await router.keyUsage(hash);
    if (latest === cost && (latest > 0 || !used)) break;
    cost = latest;
  }
  return cost;
}

/**
 * What each run of the key's task spent, by run ID, rounded as `run-cost` is. The task comes
 * from the key's name. Failures are only logged: apply then keeps the costs it has.
 */
export async function taskCosts(
  router: Pick<OpenRouter, "key" | "listKeys">,
  hash: string,
): Promise<Record<string, number> | undefined> {
  try {
    const { name } = await router.key(hash);
    const { owner, repo } = github.context.repo;
    const prefix = name.slice(0, name.lastIndexOf("/") + 1);
    if (!prefix.startsWith(keyPrefix(owner, repo)) || prefix === keyPrefix(owner, repo)) {
      throw new Error("the key's name is not a task key's.");
    }
    const costs = costsByRun(await router.listKeys(), prefix);
    return Object.fromEntries(
      Object.entries(costs).map(([run, cost]) => [run, Number(cost.toFixed(4))]),
    );
  } catch (error) {
    core.warning(
      `Could not read what the task's runs spent: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

/** How far back the key's tokens are counted: longer than any key lives. */
const KEY_LIFETIME_MS = 48 * 3_600_000;

/**
 * The key's tokens, from OpenRouter's analytics. A request may show up there some time after
 * it is billed, so while a key that spent something has no tokens yet, this asks again, for up
 * to about a minute. Failures are only logged: the tokens are informational.
 */
export async function runTokens(
  router: Pick<OpenRouter, "keyTokens">,
  hash: string,
  spent: boolean,
  wait = sleep,
): Promise<{ input: number; output: number } | undefined> {
  try {
    for (let attempt = 0; ; attempt++) {
      const now = new Date();
      const tokens = await router.keyTokens(hash, new Date(now.getTime() - KEY_LIFETIME_MS), now);
      const counted = tokens !== undefined && tokens.input + tokens.output > 0;
      if (counted || !spent) return tokens ?? (spent ? undefined : { input: 0, output: 0 });
      if (attempt === 6) {
        core.warning("OpenRouter's analytics has no tokens for this run's key yet.");
        return undefined;
      }
      await wait(10_000);
    }
  } catch (error) {
    core.warning(
      `Could not read this run's tokens: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
