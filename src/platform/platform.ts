import type { State } from "../state.ts";
import type {
  ChangeRequest,
  CiArtifact,
  CiJob,
  CiRun,
  Comment,
  FileChange,
  Issue,
  RepositoryRef,
  Review,
  ReviewComment,
  TreeFile,
} from "./types.ts";

/**
 * A code hosting platform's API, scoped to one repository: everything Codeman reads and writes
 * there, except CI results. Each method states what adapters must guarantee; see
 * docs/development/platforms.md.
 */
export interface Platform {
  readonly repository: RepositoryRef;

  // Tasks and states.

  /** Open issues with the opt-in label, change requests included where the platform lists them. */
  listOptedIn(): Promise<Issue[]>;
  /** The issue's labels as they are now. */
  currentLabels(issue: number): Promise<string[]>;
  /** Leaves exactly one state label on the issue (none for `new`), given its current labels. */
  setState(issue: number, labels: readonly string[], state: State | "new"): Promise<void>;

  // Conversation. Comment IDs grow with time within an issue or change request.

  listComments(issue: number): Promise<Comment[]>;
  listChangeRequestComments(number: number): Promise<Comment[]>;
  /** Comments on an issue, and returns the comment's ID. */
  comment(issue: number, body: string): Promise<number>;
  /** Comments on a change request, and returns the comment's ID. */
  commentOnChangeRequest(number: number, body: string): Promise<number>;
  /**
   * Updates one of Codeman's comments on the issue, or creates it if `commentId` is null or the
   * comment is gone, and returns its ID.
   */
  upsertComment(issue: number, commentId: number | null, body: string): Promise<number>;

  // Change requests (pull requests, merge requests).

  /** The open change request from `branch`, if any. */
  findChangeRequest(branch: string): Promise<number | undefined>;
  getChangeRequest(number: number): Promise<ChangeRequest>;
  /** Opens a change request. A draft falls back to a regular one where drafts are not available. */
  openChangeRequest(options: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<number>;
  updateChangeRequest(number: number, options: { title: string; body: string }): Promise<void>;
  /** Marks a draft ready for review; does nothing to one that is not a draft. */
  markReady(number: number): Promise<void>;
  /** Submitted and pending reviews. Review IDs grow with time. */
  listReviews(number: number): Promise<Review[]>;
  listReviewComments(number: number): Promise<ReviewComment[]>;

  // Access.

  /**
   * Whether the user may steer Codeman: write access to the repository or more. Must be read
   * from the platform's permissions, never from what the user's comment says about them.
   */
  isMaintainer(login: string): Promise<boolean>;
  /**
   * The login Codeman writes as. Only comments by this account can hold Codeman's records, so
   * nobody else may be able to post as it.
   */
  self(): string;

  // Content.

  defaultBranch(): Promise<string>;
  /** The commit a branch points to, or undefined if the branch does not exist. */
  branchSha(branch: string): Promise<string | undefined>;
  /** A text file at a branch or commit, or undefined if it is missing. */
  readFile(ref: string, path: string): Promise<string | undefined>;
  /** Regular files under `prefix` in a branch or commit. */
  filesUnder(ref: string, prefix: string): Promise<Map<string, TreeFile>>;
  /**
   * The paths that differ from commit `base` to commit `head`, both paths of a rename included.
   * Undefined if `head` does not descend from `base`, or if the platform cannot list them all.
   */
  changedPaths(base: string, head: string): Promise<string[] | undefined>;
  /**
   * Commits every change at once, without running git on files the agent produced, and returns
   * the new commit. Fails, changing nothing, if the branch moved since `baseSha`.
   */
  commit(options: {
    branch: string;
    baseSha: string;
    createBranch: boolean;
    changes: readonly FileChange[];
    message: string;
  }): Promise<string>;

  // Links and references, as the platform renders them.

  fileUrl(branch: string, path: string): string;
  changeRequestUrl(number: number): string;
  /** A link to one comment on the issue at `issueUrl`. */
  commentUrl(issueUrl: string, commentId: number): string;
  /** How a change request is referred to in text, such as `#12`. */
  changeRequestReference(number: number): string;
  /** A line in a change request's description that closes the issue when it merges. */
  closingReference(issue: number): string;
}

/**
 * An attachment link in a text, as the platform recognizes it: a file attached to the
 * conversation, an asset of a release of a repository, or a whole release, whose assets
 * `Attachments.expand` lists.
 */
export interface AttachmentLink {
  kind: "attachment" | "release-asset" | "release";
  /** The URL, as the text has it. */
  url: string;
  /** What identifies the file on the platform, such as GitHub's file ID or asset UUID. */
  id: string;
  /** The file's name, when the link has one. */
  name?: string | undefined;
}

/** A text of the conversation, so that an adapter can read it again, as the platform renders it. */
export type TextRef =
  | { kind: "issue"; number: number }
  | { kind: "comment"; id: number }
  | { kind: "review"; changeRequest: number; id: number }
  | { kind: "review-comment"; id: number };

/** Why a download failed: over its size limit, refused by the platform, or anything else. */
export type DownloadProblem = "too-large" | "refused" | "failed";

export type Download =
  | { ok: true; data: Buffer; name?: string | undefined }
  | {
      ok: false;
      problem: DownloadProblem;
      detail?: string | undefined;
      /**
       * A page that explains why the platform refuses this kind of file, when it is a limit of
       * the platform rather than of this file.
       */
      reference?: string | undefined;
    };

/** A release's assets, or why they could not be listed. */
export type Expansion =
  | { ok: true; links: AttachmentLink[] }
  | { ok: false; problem: "refused" | "failed"; detail?: string | undefined };

/**
 * Files attached to the conversation (issues, comments and reviews), and the release assets it
 * links to. Read only.
 */
export interface Attachments {
  /** The attachment links in a text, in order, each once. Links to anything else are not. */
  find(text: string): AttachmentLink[];
  /**
   * The links to a release's assets, in the release's order, for a `release` link; any other
   * link alone. Never throws.
   */
  expand(link: AttachmentLink, signal: AbortSignal): Promise<Expansion>;
  /**
   * Downloads one attachment of the text `where`, of at most `maxBytes`. Never throws: a
   * failure is a problem, and `signal` aborting it is `failed`.
   */
  download(
    link: AttachmentLink,
    where: TextRef,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Download>;
}

/** The results of a repository's CI: runs on a commit, their jobs, logs and artifacts. */
export interface CiResults {
  runsForCommit(sha: string): Promise<CiRun[]>;
  runJobs(runId: number): Promise<CiJob[]>;
  jobLog(jobId: number): Promise<string>;
  runArtifacts(runId: number): Promise<CiArtifact[]>;
  /** The artifact as a zip archive. */
  downloadArtifact(artifactId: number): Promise<Buffer>;
}
