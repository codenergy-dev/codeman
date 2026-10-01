import type { CiResults } from "../platform.ts";
import type { CiArtifact, CiJob, CiRun, RepositoryRef } from "../types.ts";
import type { Octokit } from "./platform.ts";

/** GitHub Actions' shape of a workflow run, as far as Codeman reads it. */
export interface GitHubWorkflowRun {
  id: number;
  name?: string | null;
  path: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
}

export function toCiRun(run: GitHubWorkflowRun): CiRun {
  return {
    id: run.id,
    name: run.name ?? run.path,
    path: run.path,
    finished: run.status === "completed",
    conclusion: run.conclusion,
    url: run.html_url,
  };
}

/** The results of GitHub Actions workflows in one repository. */
export class GitHubActionsResults implements CiResults {
  readonly #octokit: Octokit;
  readonly #scope: { owner: string; repo: string };

  constructor(client: Octokit, repository: RepositoryRef) {
    this.#octokit = client;
    this.#scope = { owner: repository.owner, repo: repository.name };
  }

  async runsForCommit(sha: string): Promise<CiRun[]> {
    const { data } = await this.#octokit.rest.actions.listWorkflowRunsForRepo({
      ...this.#scope,
      head_sha: sha,
      per_page: 100,
    });
    return data.workflow_runs.map(toCiRun);
  }

  async runJobs(runId: number): Promise<CiJob[]> {
    const jobs = await this.#octokit.paginate(this.#octokit.rest.actions.listJobsForWorkflowRun, {
      ...this.#scope,
      run_id: runId,
      per_page: 100,
    });
    return jobs.map((job) => ({ id: job.id, name: job.name, conclusion: job.conclusion }));
  }

  async jobLog(jobId: number): Promise<string> {
    const response = await this.#octokit.rest.actions.downloadJobLogsForWorkflowRun({
      ...this.#scope,
      job_id: jobId,
    });
    return typeof response.data === "string" ? response.data : String(response.data);
  }

  async runArtifacts(runId: number): Promise<CiArtifact[]> {
    const artifacts = await this.#octokit.paginate(
      this.#octokit.rest.actions.listWorkflowRunArtifacts,
      { ...this.#scope, run_id: runId, per_page: 100 },
    );
    return artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      bytes: artifact.size_in_bytes,
      expired: artifact.expired,
    }));
  }

  async downloadArtifact(artifactId: number): Promise<Buffer> {
    const response = await this.#octokit.rest.actions.downloadArtifact({
      ...this.#scope,
      artifact_id: artifactId,
      archive_format: "zip",
    });
    return Buffer.from(response.data as ArrayBuffer);
  }
}
