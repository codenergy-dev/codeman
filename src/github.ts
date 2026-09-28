import type { getOctokit } from "@actions/github";
import { replaceFooter } from "./pull.ts";
import { OPT_IN_LABEL, STATES, type State, stateLabel } from "./state.ts";
import type {
  CommentLike,
  IssueLike,
  ReviewCommentLike,
  ReviewLike,
  WorkflowRunLike,
} from "./tasks.ts";

type Octokit = ReturnType<typeof getOctokit>;

export interface FileChange {
  path: string;
  /** `null` deletes the file. */
  content: Buffer | null;
  /** An existing blob to use instead of `content`. */
  sha?: string;
  mode?: "100644" | "100755";
}

export interface TreeFile {
  sha: string;
  mode: "100644" | "100755";
}

/** The GitHub API calls Codeman makes, scoped to one repository. */
export class Repository {
  readonly #octokit: Octokit;
  readonly owner: string;
  readonly repo: string;

  constructor(octokit: Octokit, owner: string, repo: string) {
    this.#octokit = octokit;
    this.owner = owner;
    this.repo = repo;
  }

  get #scope() {
    return { owner: this.owner, repo: this.repo };
  }

  listOptedIn(): Promise<IssueLike[]> {
    return this.#octokit.paginate(this.#octokit.rest.issues.listForRepo, {
      ...this.#scope,
      state: "open",
      labels: OPT_IN_LABEL,
      per_page: 100,
    });
  }

  listComments(issue: number): Promise<CommentLike[]> {
    return this.#octokit.paginate(this.#octokit.rest.issues.listComments, {
      ...this.#scope,
      issue_number: issue,
      per_page: 100,
    });
  }

  listReviews(pullRequest: number): Promise<ReviewLike[]> {
    return this.#octokit.paginate(this.#octokit.rest.pulls.listReviews, {
      ...this.#scope,
      pull_number: pullRequest,
      per_page: 100,
    });
  }

  listReviewComments(pullRequest: number): Promise<ReviewCommentLike[]> {
    return this.#octokit.paginate(this.#octokit.rest.pulls.listReviewComments, {
      ...this.#scope,
      pull_number: pullRequest,
      per_page: 100,
    });
  }

  /** The commit a branch pointed to at `time`: its newest commit up to then. */
  async commitAt(branch: string, time: string): Promise<string | undefined> {
    const { data } = await this.#octokit.rest.repos.listCommits({
      ...this.#scope,
      sha: branch,
      until: time,
      per_page: 1,
    });
    return data[0]?.sha;
  }

  /** Regular files under `prefix` in a commit, with their blob SHAs. */
  async filesUnder(commit: string, prefix: string): Promise<Map<string, TreeFile>> {
    const { data } = await this.#octokit.rest.git.getTree({
      ...this.#scope,
      tree_sha: commit,
      recursive: "true",
    });
    if (data.truncated) throw new Error("The repository's tree is too large to list.");
    const files = new Map<string, TreeFile>();
    for (const entry of data.tree) {
      if (entry.type === "blob" && entry.path?.startsWith(prefix) && entry.sha) {
        files.set(entry.path, {
          sha: entry.sha,
          mode: entry.mode === "100755" ? "100755" : "100644",
        });
      }
    }
    return files;
  }

  /** Workflow runs for one commit. */
  async runsForCommit(sha: string): Promise<WorkflowRunLike[]> {
    const { data } = await this.#octokit.rest.actions.listWorkflowRunsForRepo({
      ...this.#scope,
      head_sha: sha,
      per_page: 100,
    });
    return data.workflow_runs;
  }

  async runJobs(runId: number): Promise<{ id: number; name: string; conclusion: string | null }[]> {
    return this.#octokit.paginate(this.#octokit.rest.actions.listJobsForWorkflowRun, {
      ...this.#scope,
      run_id: runId,
      per_page: 100,
    });
  }

  async jobLog(jobId: number): Promise<string> {
    const response = await this.#octokit.rest.actions.downloadJobLogsForWorkflowRun({
      ...this.#scope,
      job_id: jobId,
    });
    return typeof response.data === "string" ? response.data : String(response.data);
  }

  async runArtifacts(
    runId: number,
  ): Promise<{ id: number; name: string; size_in_bytes: number; expired: boolean }[]> {
    return this.#octokit.paginate(this.#octokit.rest.actions.listWorkflowRunArtifacts, {
      ...this.#scope,
      run_id: runId,
      per_page: 100,
    });
  }

  async downloadArtifact(artifactId: number): Promise<Buffer> {
    const response = await this.#octokit.rest.actions.downloadArtifact({
      ...this.#scope,
      artifact_id: artifactId,
      archive_format: "zip",
    });
    return Buffer.from(response.data as ArrayBuffer);
  }

  /** The user's legacy permission on the repository: admin, write, read or none. */
  async permission(username: string): Promise<string> {
    try {
      const { data } = await this.#octokit.rest.repos.getCollaboratorPermissionLevel({
        ...this.#scope,
        username,
      });
      return data.permission;
    } catch (error) {
      if (status(error) === 404) return "none";
      throw error;
    }
  }

  async defaultBranch(): Promise<string> {
    const { data } = await this.#octokit.rest.repos.get(this.#scope);
    return data.default_branch;
  }

  /** The commit a branch points to, or undefined if the branch does not exist. */
  async branchSha(branch: string): Promise<string | undefined> {
    try {
      const { data } = await this.#octokit.rest.git.getRef({
        ...this.#scope,
        ref: `heads/${branch}`,
      });
      return data.object.sha;
    } catch (error) {
      if (status(error) === 404) return undefined;
      throw error;
    }
  }

  async readFile(ref: string, path: string): Promise<string | undefined> {
    try {
      const { data } = await this.#octokit.rest.repos.getContent({ ...this.#scope, path, ref });
      if (Array.isArray(data) || data.type !== "file") return undefined;
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (error) {
      if (status(error) === 404) return undefined;
      throw error;
    }
  }

  /**
   * Commits through the Git Data API, so no git process runs on files the agent produced, and
   * GitHub signs the commit as the App. Fails if the branch moved since `baseSha`.
   */
  async commit(options: {
    branch: string;
    baseSha: string;
    createBranch: boolean;
    changes: readonly FileChange[];
    message: string;
  }): Promise<string> {
    const git = this.#octokit.rest.git;
    const base = await git.getCommit({ ...this.#scope, commit_sha: options.baseSha });
    const tree = await Promise.all(
      options.changes.map(async (change) => {
        const mode = change.mode ?? "100644";
        if (change.sha) return { path: change.path, mode, type: "blob" as const, sha: change.sha };
        if (change.content === null) {
          return { path: change.path, mode, type: "blob" as const, sha: null };
        }
        const blob = await git.createBlob({
          ...this.#scope,
          content: change.content.toString("base64"),
          encoding: "base64",
        });
        return { path: change.path, mode, type: "blob" as const, sha: blob.data.sha };
      }),
    );
    const newTree = await git.createTree({
      ...this.#scope,
      base_tree: base.data.tree.sha,
      tree,
    });
    const commit = await git.createCommit({
      ...this.#scope,
      message: options.message,
      tree: newTree.data.sha,
      parents: [options.baseSha],
    });
    if (options.createBranch) {
      await git.createRef({
        ...this.#scope,
        ref: `refs/heads/${options.branch}`,
        sha: commit.data.sha,
      });
    } else {
      await git.updateRef({
        ...this.#scope,
        ref: `heads/${options.branch}`,
        sha: commit.data.sha,
        force: false,
      });
    }
    return commit.data.sha;
  }

  /** The open pull request from `branch`, if any. */
  async findPullRequest(branch: string): Promise<number | undefined> {
    const { data } = await this.#octokit.rest.pulls.list({
      ...this.#scope,
      head: `${this.owner}:${branch}`,
      state: "open",
      per_page: 1,
    });
    return data[0]?.number;
  }

  /**
   * Opens a pull request. A draft falls back to a regular pull request where drafts are not
   * available (private repositories on some plans).
   */
  async openPullRequest(options: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<number> {
    try {
      const { data } = await this.#octokit.rest.pulls.create({ ...this.#scope, ...options });
      return data.number;
    } catch (error) {
      if (!options.draft || status(error) !== 422) throw error;
      const { data } = await this.#octokit.rest.pulls.create({
        ...this.#scope,
        ...options,
        draft: false,
      });
      return data.number;
    }
  }

  /** Marks a draft pull request ready for review. REST cannot; GraphQL can. */
  async markReady(number: number): Promise<void> {
    const { data } = await this.#octokit.rest.pulls.get({ ...this.#scope, pull_number: number });
    if (!data.draft) return;
    await this.#octokit.graphql(
      "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }",
      { id: data.node_id },
    );
  }

  /** Comments on an issue or pull request, and returns the comment's ID. */
  async comment(issue: number, body: string): Promise<number> {
    const { data } = await this.#octokit.rest.issues.createComment({
      ...this.#scope,
      issue_number: issue,
      body,
    });
    return data.id;
  }

  async updatePullRequest(number: number, options: { title: string; body: string }): Promise<void> {
    await this.#octokit.rest.pulls.update({ ...this.#scope, pull_number: number, ...options });
  }

  /** Updates the last line of Codeman's description, if a human has not removed it. */
  async updatePullRequestFooter(number: number, footer: string): Promise<void> {
    const { data } = await this.#octokit.rest.pulls.get({ ...this.#scope, pull_number: number });
    const body = data.body ?? "";
    const updated = replaceFooter(body, footer);
    if (updated !== body)
      await this.updatePullRequest(number, { title: data.title, body: updated });
  }

  /** Leaves exactly one state label on the issue (none for `new`). */
  async setState(issue: number, labels: readonly string[], state: State | "new"): Promise<void> {
    for (const other of STATES) {
      const label = stateLabel(other);
      if (other !== state && labels.includes(label)) {
        try {
          await this.#octokit.rest.issues.removeLabel({
            ...this.#scope,
            issue_number: issue,
            name: label,
          });
        } catch (error) {
          if (status(error) !== 404) throw error;
        }
      }
    }
    if (state !== "new") {
      await this.#octokit.rest.issues.addLabels({
        ...this.#scope,
        issue_number: issue,
        labels: [stateLabel(state)],
      });
    }
  }

  async currentLabels(issue: number): Promise<string[]> {
    const { data } = await this.#octokit.rest.issues.get({ ...this.#scope, issue_number: issue });
    return data.labels.map((label) => (typeof label === "string" ? label : (label.name ?? "")));
  }

  /** Creates or updates Codeman's status comment and returns its ID. */
  async upsertComment(issue: number, commentId: number | null, body: string): Promise<number> {
    if (commentId !== null) {
      await this.#octokit.rest.issues.updateComment({
        ...this.#scope,
        comment_id: commentId,
        body,
      });
      return commentId;
    }
    const { data } = await this.#octokit.rest.issues.createComment({
      ...this.#scope,
      issue_number: issue,
      body,
    });
    return data.id;
  }
}

function status(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : undefined;
}
