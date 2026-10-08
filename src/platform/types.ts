/**
 * What Codeman reads from a code hosting platform, in the platform's terms normalized. Each
 * adapter maps its platform's shapes to these. See docs/development/platforms.md.
 */

/** The repository Codeman works on. `owner` may hold several segments, such as a group path. */
export interface RepositoryRef {
  owner: string;
  name: string;
}

export interface User {
  login: string;
  /** Bots never steer Codeman, whatever their access. */
  bot: boolean;
}

/** An issue, or a change request where the platform lists them as issues. */
export interface Issue {
  number: number;
  kind: "issue" | "change-request";
  title: string;
  body: string;
  url: string;
  labels: string[];
  /** Null for a deleted account. */
  author: User | null;
}

/**
 * A comment on an issue or a change request. IDs grow with time within a conversation: Codeman
 * marks comments as handled by the highest ID it has read.
 */
export interface Comment {
  id: number;
  /** Null for a deleted account. */
  author: User | null;
  body: string;
  /** ISO 8601. */
  createdAt: string;
}

/** What a review asks for. `pending` is a review not submitted yet. */
export type ReviewVerdict =
  | "approved"
  | "changes-requested"
  | "commented"
  | "dismissed"
  | "pending";

/** A submitted review of a change request. IDs grow with time, as with comments. */
export interface Review {
  id: number;
  /** Null for a deleted account. */
  author: User | null;
  verdict: ReviewVerdict;
  body: string;
}

/** A review's comment on a line of the diff. */
export interface ReviewComment {
  /** The review it belongs to, if any. */
  reviewId: number | null;
  path: string;
  /** The line it is on, or was on when the diff changed since. */
  line: number | null;
  body: string;
}

export interface ChangeRequest {
  title: string;
  body: string;
  draft: boolean;
}

/** A git file mode Codeman writes: a regular file, or an executable one. */
export type FileMode = "100644" | "100755";

export interface FileChange {
  path: string;
  /** `null` deletes the file. */
  content: Buffer | null;
  /** The git blob SHA of an existing file to use instead of `content`. */
  sha?: string;
  mode?: FileMode;
}

/** A regular file in a commit. */
export interface TreeFile {
  /** Its git blob SHA: equal SHAs, equal content. */
  sha: string;
  mode: FileMode;
}

/** A run of a CI pipeline or workflow on a commit. */
export interface CiRun {
  id: number;
  /** Its name, or else its path. */
  name: string;
  /** The file that defines it, such as `.github/workflows/ios.yml`. */
  path: string;
  finished: boolean;
  /** `success`, `failure`, `skipped`, `cancelled` or another word; null while it runs. */
  conclusion: string | null;
  url: string;
}

export interface CiJob {
  id: number;
  name: string;
  /** As in `CiRun`. */
  conclusion: string | null;
}

export interface CiArtifact {
  id: number;
  name: string;
  bytes: number;
  expired: boolean;
}
