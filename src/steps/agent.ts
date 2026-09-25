import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import { collectChanges, copyAgentFile, type Manifest } from "../collect.ts";
import { decrypt } from "../crypto.ts";
import { harnesses } from "../harness/index.ts";
import {
  HARNESS_PROMPT,
  implementPrompt,
  OUTPUT_DIR,
  OUTPUT_FILE,
  planPrompt,
  TASK_FILE,
} from "../prompt.ts";
import {
  AGENT_HOME,
  copyToAgent,
  createAgentUser,
  installForAgent,
  killAgentProcesses,
  runAsAgent,
  writeAsAgent,
} from "../sandbox.ts";
import { oneLine } from "../text.ts";
import { positiveNumber, readTask, resultDir, workdir } from "./common.ts";

export const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Runs the harness on a copy of the checkout, as an unprivileged user, and collects what it
 * changed. This job has a read-only token; the apply job validates and writes the result.
 */
export async function agent(): Promise<void> {
  const task = readTask();
  const apiKey = decrypt(
    core.getInput("encrypted-key", { required: true }),
    core.getInput("encryption-secret", { required: true }),
  );
  core.setSecret(apiKey);
  const harnessName = core.getInput("harness") || "opencode";
  const harness = harnesses[harnessName];
  if (!harness) throw new Error(`Unknown harness "${harnessName}".`);
  const minutes = positiveNumber("agent-minutes");
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) throw new Error("GITHUB_WORKSPACE is not set; check out the repository first.");

  core.startGroup(`Install ${harness.name}`);
  createAgentUser();
  const executable = installForAgent(
    await harness.install(join(workdir(), "harness")),
    harness.name,
  );
  core.endGroup();

  const worktree = `${AGENT_HOME}/work`;
  copyToAgent(workspace, worktree);
  const prompt = task.action === "implement" ? implementPrompt(task, minutes) : planPrompt(task);
  writeAsAgent(`${worktree}/${TASK_FILE}`, prompt);

  core.info(`Running ${harness.name} with ${task.model} for up to ${minutes} minutes.`);
  const run = await runAsAgent(
    harness.command({ executable, model: task.model, apiKey, prompt: HARNESS_PROMPT }),
    worktree,
    minutes * 60_000,
  );
  killAgentProcesses();

  const out = resultDir();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const changes = collectChanges({
    gitDir: join(workspace, ".git"),
    worktree,
    outDir: out,
    exclude: [OUTPUT_DIR],
  });
  const outputFile = join(out, "output.json");
  if (!copyAgentFile(`${worktree}/${OUTPUT_FILE}`, outputFile, MAX_OUTPUT_BYTES)) {
    rmSync(outputFile, { force: true });
  }
  const manifest: Manifest = {
    version: 1,
    harness: harness.name,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    changes,
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

  core.info(`Changed ${changes.length} file(s):`);
  for (const change of changes) core.info(`  ${change.status} ${oneLine(change.path)}`);
  // The result is kept either way: apply commits unfinished work so the next run continues.
  if (run.timedOut) core.setFailed(`The agent did not finish within ${minutes} minutes.`);
  else if (run.exitCode !== 0) core.setFailed(`The agent exited with code ${run.exitCode}.`);
}
