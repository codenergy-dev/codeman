import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import type { Conventions } from "../platform/conventions.ts";
import { GitHubActionsResults } from "../platform/github/ci.ts";
import { GITHUB } from "../platform/github/conventions.ts";
import { contextRepository, GitHubPlatform, octokit } from "../platform/github/platform.ts";
import type { CiResults, Platform } from "../platform/platform.ts";
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

export const conventions: Conventions = GITHUB;

export function platform(input = "github-token", appSlug?: string): Platform {
  return new GitHubPlatform(
    octokit(core.getInput(input, { required: true })),
    contextRepository(),
    {
      appSlug,
    },
  );
}

export function ciResults(input = "github-token"): CiResults {
  return new GitHubActionsResults(
    octokit(core.getInput(input, { required: true })),
    contextRepository(),
  );
}

export function runUrl(): string {
  const { serverUrl, runId } = github.context;
  const { owner, repo } = github.context.repo;
  return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
}
