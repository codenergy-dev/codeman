import * as github from "@actions/github";
import { OPT_IN_LABEL, STATES, type State, stateLabel } from "../../state.ts";
import type { Platform } from "../platform.ts";
import type {
  ChangeRequest,
  Comment,
  FileChange,
  Issue,
  RepositoryRef,
  Review,
  ReviewComment,
  ReviewVerdict,
  TreeFile,
  User,
} from "../types.ts";

export type Octokit = ReturnType<typeof github.getOctokit>;

/** The GitHub client for a token, with the server and API of the workflow's repository. */
export function octokit(token: string): Octokit {
  return github.getOctokit(token);
}

/** GitHub's REST shapes, as far as Codeman reads them. */
export interface GitHubUser {
  login: string;
  type?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  pull_request?: unknown;
  labels: ReadonlyArray<string | { name?: string }>;
  /** Null for a deleted account. */
  user?: GitHubUser | null;
}

export interface GitHubComment {
  id: number;
  body?: string | undefined;
  user: GitHubUser | null;
  created_at: string;
}

export interface GitHubReview {
  id: number;
  body?: string | null;
  state: string;
  user: GitHubUser | null;
}

export interface GitHubReviewComment {
  pull_request_review_id: number | null;
  path: string;
  line?: number | null;
  original_line?: number | null;
  body: string;
}

export function toUser(user: GitHubUser | null | undefined): User | null {
  return user ? { login: user.login, bot: user.type === "Bot" } : null;
}

export function toIssue(issue: GitHubIssue): Issue {
  return {
    number: issue.number,
    kind: issue.pull_request ? "change-request" : "issue",
    title: issue.title,
    body: issue.body ?? "",
    url: issue.html_url,
    labels: labelNames(issue.labels),
    author: toUser(issue.user),
  };
}

export function toComment(comment: GitHubComment): Comment {
  return {
    id: comment.id,
    author: toUser(comment.user),
    body: comment.body ?? "",
    createdAt: comment.created_at,
  };
}

const VERDICTS: Record<string, ReviewVerdict> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

export function toReview(review: GitHubReview): Review {
  return {
    id: review.id,
    author: toUser(review.user),
    verdict: VERDICTS[review.state] ?? "commented",
    body: review.body ?? "",
  };
}

export function toReviewComment(comment: GitHubReviewComment): ReviewComment {
  return {
    reviewId: comment.pull_request_review_id,
    path: comment.path,
    line: comment.line ?? comment.original_line ?? null,
    body: comment.body,
  };
}

function labelNames(labels: ReadonlyArray<string | { name?: string }>): string[] {
  return labels
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter((name) => name !== "");
}

/** Repository permissions that make a user a maintainer. `maintain` is reported as `write`. */
const MAINTAINER_PERMISSIONS: ReadonlySet<string> = new Set(["admin", "write"]);

/** GitHub's API, scoped to one repository. */
export class GitHubPlatform implements Platform {
  readonly #octokit: Octokit;
  readonly repository: RepositoryRef;
  readonly #serverUrl: string;
  readonly #appSlug: string | undefined;

  constructor(
    client: Octokit,
    repository: RepositoryRef,
    options: { serverUrl?: string; appSlug?: string | undefined } = {},
  ) {
    this.#octokit = client;
    this.repository = repository;
    this.#serverUrl = options.serverUrl ?? github.context.serverUrl;
    this.#appSlug = options.appSlug;
  }

  get #scope() {
    return { owner: this.repository.owner, repo: this.repository.name };
  }

  get #web(): string {
    return `${this.#serverUrl}/${this.repository.owner}/${this.repository.name}`;
  }

  async listOptedIn(): Promise<Issue[]> {
    const issues = await this.#octokit.paginate(this.#octokit.rest.issues.listForRepo, {
      ...this.#scope,
      state: "open",
      labels: OPT_IN_LABEL,
      per_page: 100,
    });
    return issues.map(toIssue);
  }

  async currentLabels(issue: number): Promise<string[]> {
    const { data } = await this.#octokit.rest.issues.get({ ...this.#scope, issue_number: issue });
    return data.labels.map((label) => (typeof label === "string" ? label : (label.name ?? "")));
  }

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

  async listComments(issue: number): Promise<Comment[]> {
    const comments = await this.#octokit.paginate(this.#octokit.rest.issues.listComments, {
      ...this.#scope,
      issue_number: issue,
      per_page: 100,
    });
    return comments.map(toComment);
  }

  /** A pull request is an issue: its conversation is the issue's. */
  listChangeRequestComments(number: number): Promise<Comment[]> {
    return this.listComments(number);
  }

  async comment(issue: number, body: string): Promise<number> {
    const { data } = await this.#octokit.rest.issues.createComment({
      ...this.#scope,
      issue_number: issue,
      body,
    });
    return data.id;
  }

  commentOnChangeRequest(number: number, body: string): Promise<number> {
    return this.comment(number, body);
  }

  async upsertComment(issue: number, commentId: number | null, body: string): Promise<number> {
    if (commentId !== null) {
      try {
        await this.#octokit.rest.issues.updateComment({
          ...this.#scope,
          comment_id: commentId,
          body,
        });
        return commentId;
      } catch (error) {
        if (status(error) !== 404) throw error;
      }
    }
    return this.comment(issue, body);
  }

  async findChangeRequest(branch: string): Promise<number | undefined> {
    const { data } = await this.#octokit.rest.pulls.list({
      ...this.#scope,
      head: `${this.repository.owner}:${branch}`,
      state: "open",
      per_page: 1,
    });
    return data[0]?.number;
  }

  async getChangeRequest(number: number): Promise<ChangeRequest> {
    const { data } = await this.#octokit.rest.pulls.get({ ...this.#scope, pull_number: number });
    return { title: data.title, body: data.body ?? "", draft: data.draft ?? false };
  }

  /** Drafts are not available in private repositories on some plans. */
  async openChangeRequest(options: {
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

  async updateChangeRequest(
    number: number,
    options: { title: string; body: string },
  ): Promise<void> {
    await this.#octokit.rest.pulls.update({ ...this.#scope, pull_number: number, ...options });
  }

  /** REST cannot; GraphQL can. */
  async markReady(number: number): Promise<void> {
    const { data } = await this.#octokit.rest.pulls.get({ ...this.#scope, pull_number: number });
    if (!data.draft) return;
    await this.#octokit.graphql(
      "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }",
      { id: data.node_id },
    );
  }

  async listReviews(number: number): Promise<Review[]> {
    const reviews = await this.#octokit.paginate(this.#octokit.rest.pulls.listReviews, {
      ...this.#scope,
      pull_number: number,
      per_page: 100,
    });
    return reviews.map(toReview);
  }

  async listReviewComments(number: number): Promise<ReviewComment[]> {
    const comments = await this.#octokit.paginate(this.#octokit.rest.pulls.listReviewComments, {
      ...this.#scope,
      pull_number: number,
      per_page: 100,
    });
    return comments.map(toReviewComment);
  }

  /**
   * From the user's legacy permission on the repository. `author_association` is not used:
   * GitHub computes it for the reader, and an App token sees private organization members as
   * contributors.
   */
  async isMaintainer(login: string): Promise<boolean> {
    try {
      const { data } = await this.#octokit.rest.repos.getCollaboratorPermissionLevel({
        ...this.#scope,
        username: login,
      });
      return MAINTAINER_PERMISSIONS.has(data.permission);
    } catch (error) {
      if (status(error) === 404) return false;
      throw error;
    }
  }

  /** The GitHub App's bot account. Only the App can post as it. */
  self(): string {
    if (!this.#appSlug) throw new Error("The GitHub App's slug is not set.");
    return `${this.#appSlug}[bot]`;
  }

  async defaultBranch(): Promise<string> {
    const { data } = await this.#octokit.rest.repos.get(this.#scope);
    return data.default_branch;
  }

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

  async commitAt(branch: string, time: string): Promise<string | undefined> {
    const { data } = await this.#octokit.rest.repos.listCommits({
      ...this.#scope,
      sha: branch,
      until: time,
      per_page: 1,
    });
    return data[0]?.sha;
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

  async filesUnder(ref: string, prefix: string): Promise<Map<string, TreeFile>> {
    const { data } = await this.#octokit.rest.git.getTree({
      ...this.#scope,
      tree_sha: ref,
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

  /**
   * Through the Git Data API, so GitHub signs the commit as the App. `updateRef` without `force`
   * fails if the branch moved since `baseSha`.
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

  fileUrl(branch: string, path: string): string {
    return `${this.#web}/blob/${branch}/${path}`;
  }

  changeRequestUrl(number: number): string {
    return `${this.#web}/pull/${number}`;
  }

  commentUrl(issueUrl: string, commentId: number): string {
    return `${issueUrl}#issuecomment-${commentId}`;
  }

  changeRequestReference(number: number): string {
    return `#${number}`;
  }

  closingReference(issue: number): string {
    return `Closes #${issue}`;
  }
}

function status(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : undefined;
}
