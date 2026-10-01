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

export const taskFile = (runtime: Runtime) => join(workdir(runtime), "task", "task.json");
export const resultDir = (runtime: Runtime) => join(workdir(runtime), "result");

export function readTask(runtime: Runtime): TaskContext {
  const task = JSON.parse(readFileSync(taskFile(runtime), "utf8")) as TaskContext;
  if (task.version !== 1) throw new Error("The task file has an unknown version.");
  return task;
}
