import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { Repository } from "../github.ts";
import type { TaskContext } from "../tasks.ts";

export function positiveNumber(name: string): number {
  const value = Number(core.getInput(name, { required: true }));
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Input ${name} must be a positive number.`);
  return value;
}

/** Where jobs keep Codeman's files. The workflow uploads and downloads these as artifacts. */
export function workdir(): string {
  return core.getInput("workdir") || join(process.env.RUNNER_TEMP ?? "/tmp", "codeman");
}

export const taskFile = () => join(workdir(), "task", "task.json");
export const resultDir = () => join(workdir(), "result");

export function readTask(): TaskContext {
  const task = JSON.parse(readFileSync(taskFile(), "utf8")) as TaskContext;
  if (task.version !== 1) throw new Error("The task file has an unknown version.");
  return task;
}

export function repository(): Repository {
  const octokit = github.getOctokit(core.getInput("github-token", { required: true }));
  const { owner, repo } = github.context.repo;
  return new Repository(octokit, owner, repo);
}

export function runUrl(): string {
  const { serverUrl, runId } = github.context;
  const { owner, repo } = github.context.repo;
  return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
}

export function fileUrl(task: TaskContext, path: string): string {
  return `${github.context.serverUrl}/${task.owner}/${task.repo}/blob/${task.branch}/${path}`;
}
