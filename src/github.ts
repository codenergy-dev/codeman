import type { getOctokit } from "@actions/github";
import { OPT_IN_LABEL, STATES, type State, stateLabel } from "./state.ts";
import type { CommentLike, IssueLike } from "./tasks.ts";

type Octokit = ReturnType<typeof getOctokit>;

export interface FileChange {
  path: string;
  /** `null` deletes the file. */
  content: Buffer | null;
  mode?: "100644" | "100755";
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
