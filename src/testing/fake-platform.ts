import { createHash } from "node:crypto";
import type { ProviderAccounts } from "../inference/budget.ts";
import type { InferenceProvider } from "../inference/provider.ts";
import { Ledger } from "../ledger.ts";
import type { Conventions } from "../platform/conventions.ts";
import type { CiResults, Platform } from "../platform/platform.ts";
import type {
  ChangeRequest,
  CiArtifact,
  CiJob,
  CiRun,
  Comment,
  FileChange,
  FileMode,
  Issue,
  RepositoryRef,
  Review,
  ReviewComment,
  TreeFile,
  User,
} from "../platform/types.ts";
import type { Runtime } from "../runtime/runtime.ts";
import type { Services } from "../services.ts";
import { OPT_IN_LABEL, STATES, type State, stateLabel } from "../state.ts";
import { MemoryStore } from "../store/memory.ts";
import type { Store } from "../store/store.ts";
import { FakeAccounts, FakeInference } from "./fake-inference.ts";
import { FakeRuntime } from "./fake-runtime.ts";

/**
 * A platform unlike GitHub, so tests show the domain logic assumes nothing of it: CI lives in
 * `.ci/workflows/`, change requests are numbered apart from issues and referred to as `!12`.
 */
export const FAKE_CONVENTIONS: Conventions = {
  name: "Forge",
  markdown: { references: /[@!]|#(?=\d)/g, mentions: /[@!]/g },
  commentLimit: 65_536,
  workflows: {
    dir: ".ci/workflows/",
    file: /^\.ci\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/,
    fileDescription: "files directly under .ci/workflows/",
    protect: "# CI configuration.\n/.ci/**\n",
    probes: [".ci/workflows/build.yml"],
    agentRules: (branch) => `- Write CI files under \`.ci/workflows/\`; they run on \`${branch}\`.`,
    reviewCheck: "Check the staged CI files.",
  },
};

interface File {
  sha: string;
  mode: FileMode;
}

interface Commit {
  sha: string;
  parent: string | undefined;
  message: string;
  /** ISO 8601. */
  time: string;
  files: Map<string, File>;
}

interface StoredChangeRequest extends ChangeRequest {
  number: number;
  head: string;
  base: string;
  open: boolean;
}

/** An in-memory platform with one repository. Comment and review IDs grow across it. */
export class FakePlatform implements Platform {
  readonly repository: RepositoryRef = { owner: "o", name: "r" };
  readonly issues = new Map<number, Issue>();
  readonly comments = new Map<number, Comment[]>();
  readonly changeRequests = new Map<number, StoredChangeRequest>();
  readonly changeRequestComments = new Map<number, Comment[]>();
  readonly reviews = new Map<number, Review[]>();
  readonly reviewComments = new Map<number, ReviewComment[]>();
  readonly maintainers = new Set<string>();
  readonly branches = new Map<string, string>();
  readonly commits = new Map<string, Commit>();
  readonly blobs = new Map<string, Buffer>();
  readonly bot: User = { login: "codeman-bot", bot: true };
  readonly defaultBranchName = "main";
  #nextId = 1;
  #nextChangeRequest = 1001;
  #clock = Date.parse("2026-10-01T12:00:00Z");

  constructor(files: Record<string, string> = {}) {
    const sha = this.#store(undefined, "Initial commit", new Map(), files);
    this.branches.set(this.defaultBranchName, sha);
  }

  // Test helpers.

  /** Opens an issue, labeled to opt in unless `labels` says otherwise. */
  openIssue(author: string, title: string, body = "", labels = [OPT_IN_LABEL]): number {
    const number = this.issues.size + 1;
    this.issues.set(number, {
      number,
      kind: "issue",
      title,
      body,
      url: `https://forge.test/o/r/issues/${number}`,
      labels: [...labels],
      author: { login: author, bot: false },
    });
    this.comments.set(number, []);
    return number;
  }

  /** A comment by a person, on an issue. */
  say(issue: number, author: string, body: string): number {
    return this.#addComment(
      this.#thread(this.comments, issue),
      { login: author, bot: false },
      body,
    );
  }

  /** The text of a file on a branch, or undefined. */
  file(branch: string, path: string): string | undefined {
    const sha = this.branches.get(branch);
    const file = sha ? this.commits.get(sha)?.files.get(path) : undefined;
    return file ? this.blobs.get(file.sha)?.toString("utf8") : undefined;
  }

  /** Codeman's comments on an issue, oldest first. */
  botComments(issue: number): string[] {
    return (this.comments.get(issue) ?? [])
      .filter((comment) => comment.author?.login === this.bot.login)
      .map((comment) => comment.body);
  }

  // Tasks and states.

  async listOptedIn(): Promise<Issue[]> {
    return [...this.issues.values()]
      .filter((issue) => issue.labels.includes(OPT_IN_LABEL))
      .map((issue) => ({ ...issue, labels: [...issue.labels] }));
  }

  async currentLabels(issue: number): Promise<string[]> {
    return [...this.#issue(issue).labels];
  }

  async setState(issue: number, _labels: readonly string[], state: State | "new"): Promise<void> {
    const stored = this.#issue(issue);
    const states = new Set(STATES.map(stateLabel));
    stored.labels = stored.labels.filter((label) => !states.has(label));
    if (state !== "new") stored.labels.push(stateLabel(state));
  }

  // Conversation.

  async listComments(issue: number): Promise<Comment[]> {
    return [...(this.comments.get(issue) ?? [])];
  }

  async listChangeRequestComments(number: number): Promise<Comment[]> {
    return [...(this.changeRequestComments.get(number) ?? [])];
  }

  async comment(issue: number, body: string): Promise<number> {
    this.#issue(issue);
    return this.#addComment(this.#thread(this.comments, issue), this.bot, body);
  }

  async commentOnChangeRequest(number: number, body: string): Promise<number> {
    this.#changeRequest(number);
    return this.#addComment(this.#thread(this.changeRequestComments, number), this.bot, body);
  }

  async upsertComment(issue: number, commentId: number | null, body: string): Promise<number> {
    const existing = this.comments.get(issue)?.find((comment) => comment.id === commentId);
    if (existing) {
      existing.body = body;
      return existing.id;
    }
    return this.comment(issue, body);
  }

  // Change requests.

  async findChangeRequest(branch: string): Promise<number | undefined> {
    return [...this.changeRequests.values()].find((cr) => cr.open && cr.head === branch)?.number;
  }

  async getChangeRequest(number: number): Promise<ChangeRequest> {
    const { title, body, draft } = this.#changeRequest(number);
    return { title, body, draft };
  }

  async openChangeRequest(options: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<number> {
    if (!this.branches.has(options.head)) throw new Error(`No branch ${options.head}.`);
    const number = this.#nextChangeRequest++;
    this.changeRequests.set(number, {
      number,
      head: options.head,
      base: options.base,
      title: options.title,
      body: options.body,
      draft: options.draft ?? false,
      open: true,
    });
    return number;
  }

  async updateChangeRequest(
    number: number,
    options: { title: string; body: string },
  ): Promise<void> {
    Object.assign(this.#changeRequest(number), options);
  }

  async markReady(number: number): Promise<void> {
    this.#changeRequest(number).draft = false;
  }

  async listReviews(number: number): Promise<Review[]> {
    return [...(this.reviews.get(number) ?? [])];
  }

  async listReviewComments(number: number): Promise<ReviewComment[]> {
    return [...(this.reviewComments.get(number) ?? [])];
  }

  // Access.

  async isMaintainer(login: string): Promise<boolean> {
    return this.maintainers.has(login);
  }

  self(): string {
    return this.bot.login;
  }

  // Content.

  async defaultBranch(): Promise<string> {
    return this.defaultBranchName;
  }

  async branchSha(branch: string): Promise<string | undefined> {
    return this.branches.get(branch);
  }

  async commitAt(branch: string, time: string): Promise<string | undefined> {
    let sha = this.branches.get(branch);
    while (sha) {
      const commit = this.commits.get(sha);
      if (!commit) return undefined;
      if (commit.time <= time) return sha;
      sha = commit.parent;
    }
    return undefined;
  }

  async readFile(ref: string, path: string): Promise<string | undefined> {
    const file = this.#commit(ref)?.files.get(path);
    return file ? this.blobs.get(file.sha)?.toString("utf8") : undefined;
  }

  async filesUnder(ref: string, prefix: string): Promise<Map<string, TreeFile>> {
    const commit = this.#commit(ref);
    if (!commit) throw new Error(`No branch or commit ${ref}.`);
    return new Map([...commit.files].filter(([path]) => path.startsWith(prefix)));
  }

  async commit(options: {
    branch: string;
    baseSha: string;
    createBranch: boolean;
    changes: readonly FileChange[];
    message: string;
  }): Promise<string> {
    const head = this.branches.get(options.branch);
    if (options.createBranch ? head !== undefined : head !== options.baseSha) {
      throw new Error(`${options.branch} moved since ${options.baseSha}.`);
    }
    const base = this.commits.get(options.baseSha);
    if (!base) throw new Error(`No commit ${options.baseSha}.`);
    const files = new Map(base.files);
    for (const change of options.changes) {
      if (change.sha) {
        if (!this.blobs.has(change.sha)) throw new Error(`No blob ${change.sha}.`);
        files.set(change.path, { sha: change.sha, mode: change.mode ?? "100644" });
      } else if (change.content === null) {
        files.delete(change.path);
      } else {
        files.set(change.path, {
          sha: this.#blob(change.content),
          mode: change.mode ?? "100644",
        });
      }
    }
    const sha = this.#store(options.baseSha, options.message, files, {});
    this.branches.set(options.branch, sha);
    return sha;
  }

  // Links and references.

  fileUrl(branch: string, path: string): string {
    return `https://forge.test/o/r/files/${branch}/${path}`;
  }

  changeRequestUrl(number: number): string {
    return `https://forge.test/o/r/changes/${number}`;
  }

  commentUrl(issueUrl: string, commentId: number): string {
    return `${issueUrl}#comment-${commentId}`;
  }

  changeRequestReference(number: number): string {
    return `!${number}`;
  }

  closingReference(issue: number): string {
    return `Fixes issue ${issue}`;
  }

  #issue(number: number): Issue {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`No issue ${number}.`);
    return issue;
  }

  #changeRequest(number: number): StoredChangeRequest {
    const changeRequest = this.changeRequests.get(number);
    if (!changeRequest) throw new Error(`No change request ${number}.`);
    return changeRequest;
  }

  #thread(threads: Map<number, Comment[]>, number: number): Comment[] {
    const thread = threads.get(number) ?? [];
    threads.set(number, thread);
    return thread;
  }

  #addComment(thread: Comment[], author: User, body: string): number {
    const id = this.#nextId++;
    thread.push({ id, author, body, createdAt: this.#tick() });
    return id;
  }

  #commit(ref: string): Commit | undefined {
    return this.commits.get(this.branches.get(ref) ?? ref);
  }

  #blob(content: Buffer): string {
    const sha = createHash("sha1").update(content).digest("hex");
    this.blobs.set(sha, content);
    return sha;
  }

  #store(
    parent: string | undefined,
    message: string,
    files: Map<string, File>,
    added: Record<string, string>,
  ): string {
    for (const [path, text] of Object.entries(added)) {
      files.set(path, { sha: this.#blob(Buffer.from(text, "utf8")), mode: "100644" });
    }
    const time = this.#tick();
    const sha = createHash("sha1")
      .update(`${parent ?? ""}\n${message}\n${time}\n${this.commits.size}`)
      .digest("hex");
    this.commits.set(sha, { sha, parent, message, time, files });
    return sha;
  }

  /** Time moves one second with each event, so comments and commits are ordered. */
  #tick(): string {
    this.#clock += 1000;
    return new Date(this.#clock).toISOString();
  }
}

/** CI results kept in memory. */
export class FakeCi implements CiResults {
  readonly runs: (CiRun & { sha: string })[] = [];
  readonly jobs = new Map<number, CiJob[]>();
  readonly logs = new Map<number, string>();
  readonly artifacts = new Map<number, (CiArtifact & { zip: Buffer })[]>();

  async runsForCommit(sha: string): Promise<CiRun[]> {
    return this.runs.filter((run) => run.sha === sha).map(({ sha: _, ...run }) => run);
  }

  async runJobs(runId: number): Promise<CiJob[]> {
    return this.jobs.get(runId) ?? [];
  }

  async jobLog(jobId: number): Promise<string> {
    return this.logs.get(jobId) ?? "";
  }

  async runArtifacts(runId: number): Promise<CiArtifact[]> {
    return (this.artifacts.get(runId) ?? []).map(({ zip: _, ...artifact }) => artifact);
  }

  async downloadArtifact(artifactId: number): Promise<Buffer> {
    for (const artifacts of this.artifacts.values()) {
      const artifact = artifacts.find((candidate) => candidate.id === artifactId);
      if (artifact) return artifact.zip;
    }
    throw new Error(`No artifact ${artifactId}.`);
  }
}

/** Services over a fake platform, CI and inference, for one step with this runtime. */
export function fakeServices(
  platform: FakePlatform,
  runtime: Runtime = new FakeRuntime(),
  ci: CiResults = new FakeCi(),
  inference: InferenceProvider = new FakeInference(),
  accounts: ProviderAccounts = new FakeAccounts(),
  store: Store = new MemoryStore(),
): Services {
  return {
    runtime,
    conventions: FAKE_CONVENTIONS,
    platform: () => platform,
    ci: () => ci,
    inference: () => inference,
    accounts: () => accounts,
    store: () => store,
    // No waits between attempts: a store that fails, fails at once.
    ledger: (job) => new Ledger(store, { runtime, job }, { wait: async () => undefined }),
  };
}
