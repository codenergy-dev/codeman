import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Runtime } from "../runtime/runtime.ts";
import type { TaskContext } from "../tasks.ts";

export function positiveNumber(runtime: Runtime, name: string): number {
  const value = Number(runtime.input(name, { required: true }));
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Input ${name} must be a positive number.`);
  return value;
}

/** Where jobs keep Codeman's files. The workflow uploads and downloads these as artifacts. */
export function workdir(runtime: Runtime): string {
  return runtime.input("workdir") || join(runtime.tempDir, "codeman");
}

/**
 * The context of each task `select` picked, by number. `task.json` is the first one's, for
 * workflow files from before parallel tasks, whose jobs pass no `task` input.
 */
export function taskFile(runtime: Runtime, task?: number): string {
  return join(workdir(runtime), "task", task === undefined ? "task.json" : `${task}.json`);
}

export const resultDir = (runtime: Runtime) => join(workdir(runtime), "result");
/** Where `apply` marks that its task moved, for the workflow to upload as an artifact. */
export const chainDir = (runtime: Runtime) => join(workdir(runtime), "chain");

/** The context of the job's task: its `task` input, or the only one an older workflow has. */
export function readTask(runtime: Runtime): TaskContext {
  const input = runtime.input("task");
  if (input !== "" && !/^\d+$/.test(input)) throw new Error("Input task must be an issue number.");
  const number = input === "" ? undefined : Number(input);
  const task = JSON.parse(readFileSync(taskFile(runtime, number), "utf8")) as TaskContext;
  if (task.version !== 1) throw new Error("The task file has an unknown version.");
  if (number !== undefined && task.number !== number) {
    throw new Error(`The task file of #${number} holds #${task.number}.`);
  }
  return task;
}
