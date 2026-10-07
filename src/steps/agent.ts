import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectChanges, copyAgentFile, type Manifest } from "../collect.ts";
import { decrypt } from "../crypto.ts";
import { harnesses } from "../harness/index.ts";
import { type AgentAccess, agentAccess } from "../inference/access.ts";
import { ENGINES } from "../inference/engines.ts";
import { agentMode, inferenceChoice } from "../inference/index.ts";
import { outputLimits, outputProblems } from "../output.ts";
import {
  fixPrompt,
  HARNESS_PROMPT,
  OUTPUT_DIR,
  OUTPUT_FILE,
  planPrompt,
  RULES_PATH,
  routePrompt,
  stagePrompt,
  TASK_FILE,
  WEB_TOOL_PATH,
} from "../prompt.ts";
import { nextDecisionId } from "../record.ts";
import { downloadResults, RESULTS_DIR } from "../results.ts";
import { agentRules, readRules } from "../rules.ts";
import {
  AGENT_HOME,
  copyToAgent,
  createAgentUser,
  installForAgent,
  killAgentProcesses,
  runAsAgent,
  writeAsAgent,
} from "../sandbox.ts";
import type { Services } from "../services.ts";
import { oneLine } from "../text.ts";
import { GENERIC_TOOL } from "../webdocs.ts";
import { positiveNumber, readTask, resultDir, workdir } from "./common.ts";

export const MAX_OUTPUT_BYTES = 1024 * 1024;
/** Time the agent needs at least to fix its output in the same run. */
const FIX_MS = 2 * 60_000;

/**
 * Runs the harness on a copy of the checkout, as an unprivileged user, and collects what it
 * changed. This job has a read-only token; the apply job validates and writes the result.
 */
export async function agent(services: Services): Promise<void> {
  let reached = false;
  try {
    await agentJob(services, () => {
      reached = true;
    });
  } catch (error) {
    // Before the agent could reach its model, the run used nothing; without a report, close-key
    // would count a Serverless run's whole limit.
    if (!reached) services.runtime.output("gateway-usage", JSON.stringify(NOTHING_USED));
    throw error;
  }
}

const NOTHING_USED = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0, start: 0, end: 0 };

async function agentJob(services: Services, reached: () => void): Promise<void> {
  const { runtime, conventions } = services;
  const task = readTask(runtime);
  const apiKey = decrypt(
    runtime.input("encrypted-key", { required: true }),
    runtime.input("encryption-secret", { required: true }),
  );
  runtime.mask(apiKey);
  const harnessName = runtime.input("harness") || "opencode";
  const harness = harnesses[harnessName];
  if (!harness) throw new Error(`Unknown harness "${harnessName}".`);
  const minutes = positiveNumber(runtime, "agent-minutes");
  const workspace = runtime.workspace();

  runtime.startGroup(`Install ${harness.name}`);
  createAgentUser();
  const executable = installForAgent(
    await harness.install(join(workdir(runtime), "harness")),
    harness.name,
  );
  runtime.endGroup();

  const worktree = `${AGENT_HOME}/work`;
  copyToAgent(workspace, worktree);
  if (task.workflowRuns?.length) {
    runtime.startGroup("Download the results of the workflows the agent asked for");
    const results = join(workdir(runtime), "workflow-results");
    await downloadResults(services.ci(), task.workflowRuns, results);
    copyToAgent(results, `${worktree}/${RESULTS_DIR}`);
    runtime.endGroup();
  }
  const prompt =
    task.action === "implement"
      ? stagePrompt(task, minutes, conventions)
      : task.action === "route"
        ? routePrompt(task, conventions)
        : planPrompt(task, conventions);
  writeAsAgent(`${worktree}/${TASK_FILE}`, prompt);
  if (task.action === "implement" && task.stage === "web") {
    writeAsAgent(`${worktree}/${WEB_TOOL_PATH}`, readFileSync(GENERIC_TOOL, "utf8"));
  }
  const rules = agentRules(readRules(), repositoryRules(workspace));
  if (rules.omitted.length > 0) {
    runtime.info(`The repository's instructions already cover: ${rules.omitted.join(", ")}.`);
  }
  writeAsAgent(`${worktree}/${RULES_PATH}`, rules.text);

  const access = await modelAccess(runtime, task, apiKey);
  reached();
  let run: Awaited<ReturnType<typeof runAsAgent>>;
  let durationMs: number;
  try {
    runtime.info(`Running ${harness.name} with ${task.model} for up to ${minutes} minutes.`);
    const started = Date.now();
    const options = {
      executable,
      model: task.model,
      apiKey: access.apiKey,
      provider: access.baseUrl
        ? { baseUrl: access.baseUrl, contextLength: access.contextLength }
        : undefined,
      prompt: HARNESS_PROMPT,
      instructions: `${worktree}/${RULES_PATH}`,
    };
    run = await runAsAgent(
      harness.command(options),
      worktree,
      minutes * 60_000,
      runtime,
      access.stopped,
    );

    // Once, while time is left: an output Codeman would reject or cut goes back to the agent.
    const left = started + minutes * 60_000 - Date.now();
    if (!run.timedOut && !access.stopped?.aborted && left >= FIX_MS) {
      const stage =
        task.action === "implement"
          ? (task.stage ?? "code")
          : task.action === "route"
            ? "route"
            : undefined;
      const problems = outputProblems(
        readAgentOutput(runtime, `${worktree}/${OUTPUT_FILE}`),
        stage,
        outputLimits(task.settings),
        conventions.workflows,
        nextDecisionId(task.record),
      );
      if (problems.length > 0) {
        runtime.info(`Asking the agent to fix ${OUTPUT_FILE}:`);
        for (const problem of problems) runtime.info(`  ${oneLine(problem)}`);
        const fix = await runAsAgent(
          harness.command({ ...options, prompt: fixPrompt(problems), resume: true }),
          worktree,
          left,
          runtime,
          access.stopped,
        );
        // A fix can only help: one that fails leaves the first outcome, and apply validates both.
        if (fix.exitCode === 0 && !fix.timedOut) run = fix;
        else runtime.warning(`The agent did not finish fixing ${OUTPUT_FILE}.`);
      }
    }
    durationMs = Date.now() - started;
    killAgentProcesses();
  } finally {
    // The run's token stops working, and what the gateway measured goes to close-key.
    const usage = await access.finish();
    if (usage) runtime.output("gateway-usage", JSON.stringify(usage));
  }

  const out = resultDir(runtime);
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
    durationMs,
    changes,
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

  runtime.info(`Changed ${changes.length} file(s):`);
  for (const change of changes) runtime.info(`  ${change.status} ${oneLine(change.path)}`);
  // The result is kept either way: apply commits unfinished work so the next run continues.
  if (access.stopped?.aborted) runtime.fail(`The run stopped: ${stopReason(access.stopped)}`);
  else if (run.timedOut) runtime.fail(`The agent did not finish within ${minutes} minutes.`);
  else if (run.exitCode !== 0) runtime.fail(`The agent exited with code ${run.exitCode}.`);
}

/**
 * The agent's access to its model, for the task's inference. A Serverless endpoint's key is an
 * input of this step only: the gateway that holds it runs here, outside the sandbox.
 */
async function modelAccess(
  runtime: Services["runtime"],
  task: ReturnType<typeof readTask>,
  credential: string,
): Promise<AgentAccess> {
  const choice = inferenceChoice(task.settings, task.record);
  const serverlessKey = runtime.input("serverless-key");
  if (serverlessKey) runtime.mask(serverlessKey);
  const contextLength = Number(runtime.input("context-length"));
  return agentAccess({
    mode: agentMode(choice),
    credential,
    baseUrl: runtime.input("base-url") || undefined,
    contextLength: Number.isInteger(contextLength) && contextLength > 0 ? contextLength : undefined,
    handle: runtime.input("handle"),
    serverlessKey: serverlessKey || undefined,
    engine: choice.inference === "self-hosted" ? ENGINES[choice.engine] : undefined,
    log: (message) => runtime.info(oneLine(message)),
  });
}

function stopReason(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason.message : String(reason);
}

/** The agent's output as it is now, if it wrote one Codeman would read. */
function readAgentOutput(runtime: Services["runtime"], source: string): string | undefined {
  const copy = join(workdir(runtime), "output-check.json");
  try {
    return copyAgentFile(source, copy, MAX_OUTPUT_BYTES) ? readFileSync(copy, "utf8") : undefined;
  } finally {
    rmSync(copy, { force: true });
  }
}

/** The repository's own instructions, as the harness finds them: `AGENTS.md`, else `CLAUDE.md`. */
function repositoryRules(workspace: string): string | undefined {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = join(workspace, name);
    if (existsSync(file) && lstatSync(file).isFile()) return readFileSync(file, "utf8");
  }
  return undefined;
}
