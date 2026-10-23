import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  credential,
  decodeJwt,
  forbidden,
  GitHubError,
  grants,
  jwtProblem,
  masked,
  type Need,
  notFound,
  type Permissions,
  signJwt,
  tokenValue,
  unprocessable,
} from "./auth.ts";
import { BareRepository, type CommitObject, type Identity, ZERO_SHA } from "./git.ts";
import { workflowInfo } from "./workflows.ts";
import { writeZip } from "./zip.ts";

/**
 * The fake GitHub's state and what changes it: accounts, organizations, repositories on bare git
 * repositories, issues and pull requests, Apps, their installations and tokens, workflow runs,
 * artifacts, and the events, dispatches and violations the e2e runtime reads. REST, GraphQL and
 * the scenario API all change it through the same methods, so a user's action and an App's API
 * call give the same events.
 */

export type AccountType = "User" | "Organization" | "Bot";

export interface Account {
  login: string;
  id: number;
  nodeId: string;
  type: AccountType;
}

/** A collaborator's role, from most to least: GitHub's repository roles. */
export type Role = "admin" | "maintain" | "write" | "triage" | "read";
export const ROLES: readonly Role[] = ["admin", "maintain", "write", "triage", "read"];
const RANK: Record<Role | "none", number> = {
  none: 0,
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5,
};

export interface Organization {
  account: Account;
  /** Owners are admins of every repository. */
  owners: Set<string>;
  members: Set<string>;
  /** Members' role on every repository; `read` by default, as GitHub's base permission. */
  basePermission: Role | "none";
}

export interface Label {
  id: number;
  nodeId: string;
  name: string;
  color: string;
}

export interface Comment {
  id: number;
  nodeId: string;
  user: Account;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";

export interface Review {
  id: number;
  nodeId: string;
  user: Account;
  body: string;
  state: ReviewState;
  submittedAt: string;
  commitId: string;
}

export interface ReviewComment {
  id: number;
  nodeId: string;
  reviewId: number;
  user: Account;
  path: string;
  line: number | null;
  body: string;
  createdAt: string;
  commitId: string;
}

export interface PullRequest {
  id: number;
  nodeId: string;
  head: string;
  base: string;
  /** The head's last known SHA, kept when the branch goes. */
  headSha: string;
  draft: boolean;
  reviews: Review[];
  reviewComments: ReviewComment[];
}

export interface Issue {
  id: number;
  nodeId: string;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  stateReason: string | null;
  labels: string[];
  user: Account;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  comments: Comment[];
  pull?: PullRequest;
}

export interface Repository {
  id: number;
  nodeId: string;
  owner: Account;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  git: BareRepository;
  collaborators: Map<string, Role>;
  labels: Map<string, Label>;
  issues: Map<number, Issue>;
  nextNumber: number;
  workflowIds: Map<string, number>;
  /** False as on a plan without draft pull requests: creating one answers 422. */
  drafts: boolean;
  createdAt: string;
}

export interface App {
  id: number;
  slug: string;
  name: string;
  clientId: string;
  publicKey: KeyObject;
  bot: Account;
}

export interface Installation {
  id: number;
  app: App;
  account: Account;
  /** Repository names of the account, or all of them. */
  repositories: Set<string> | "all";
  permissions: Permissions;
}

export interface Token {
  value: string;
  kind: "installation" | "job";
  actor: Account;
  owner: string;
  /** Full names, lowercase, or every repository of `owner`. */
  repositories: Set<string> | "all";
  permissions: Permissions;
  expiresAt: number;
  revoked: boolean;
  installation?: Installation;
  runId?: number;
  /** The template's job that asked for it, as `<workflow file>/<job id>`, when the runtime said. */
  job?: string;
}

export type RunStatus = "queued" | "pending" | "waiting" | "in_progress" | "completed";

export interface Job {
  id: number;
  runId: number;
  name: string;
  status: RunStatus;
  conclusion: string | null;
  log: string;
  backendId: string;
  startedAt: string;
  completedAt: string | null;
}

export interface Run {
  id: number;
  nodeId: string;
  repository: Repository;
  workflowPath: string;
  name: string;
  event: string;
  status: RunStatus;
  conclusion: string | null;
  headBranch: string;
  headSha: string;
  runNumber: number;
  runAttempt: number;
  createdAt: string;
  updatedAt: string;
  /** The workflow's concurrency group, which `concurrency_groups` lists. */
  concurrency?: string;
  actor: Account;
  backendId: string;
  inputs?: Record<string, string>;
  jobs: Job[];
}

export interface Artifact {
  id: number;
  nodeId: string;
  run: Run;
  jobBackendId: string;
  name: string;
  size: number;
  /** `sha256:<hex>` of the zip. */
  digest: string;
  data: Buffer;
  blocks: Map<string, Buffer>;
  finalized: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface GitHubEvent {
  id: number;
  /** The event's name, as `github.event_name`: `issues`, `issue_comment`, `push`… */
  name: string;
  repository: string;
  /** As `GITHUB_EVENT_PATH` holds it. */
  payload: Record<string, unknown>;
  at: string;
  /**
   * False when `GITHUB_TOKEN` caused it: GitHub then starts no workflow, except for
   * `workflow_dispatch`.
   */
  triggers: boolean;
}

export interface Dispatch {
  id: number;
  repository: string;
  workflow: string;
  workflowId: number;
  ref: string;
  inputs: Record<string, string>;
  sender: string;
  runId: number;
  at: string;
}

export interface Violation {
  /** `unknown-token`, `expired-token`, `revoked-token`, `unknown-app`, `unsupported`, `listener`. */
  kind: string;
  method?: string;
  path?: string;
  detail: string;
  at: string;
}

/** Who calls: nobody, a token the fake gave, or an App by its JWT. */
export type Caller =
  | { kind: "anonymous" }
  | { kind: "token"; token: Token }
  | { kind: "app"; app: App };

export interface WorldOptions {
  /** Where the bare repositories go, as `<root>/<owner>/<name>.git`. */
  root: string;
  /** The web origin in URLs, such as `https://github-e2e.localhost:8443`. */
  serverUrl?: string;
  now?: () => number;
}

/** `github-actions[bot]`, who acts with `GITHUB_TOKEN`. */
const ACTIONS_BOT = { login: "github-actions[bot]", id: 41898282, type: "Bot" as const };
const HOUR = 3600 * 1000;

export class World {
  readonly root: string;
  serverUrl: string;
  readonly now: () => number;
  readonly users = new Map<string, Account>();
  readonly organizations = new Map<string, Organization>();
  readonly repositories = new Map<string, Repository>();
  readonly apps = new Map<number, App>();
  readonly installations = new Map<number, Installation>();
  readonly tokens = new Map<string, Token>();
  readonly runs = new Map<number, Run>();
  readonly jobs = new Map<number, Job>();
  readonly artifacts = new Map<number, Artifact>();
  readonly runtimeTokens = new Map<string, { run: Run; job: Job }>();
  readonly events: GitHubEvent[] = [];
  readonly dispatches: Dispatch[] = [];
  readonly violations: Violation[] = [];
  /** SHAs of the commits made through the API, which GitHub signs. */
  readonly signed = new Set<string>();
  readonly secret = randomBytes(32);
  readonly #eventListeners = new Set<(event: GitHubEvent) => unknown>();
  readonly #dispatchListeners = new Set<(dispatch: Dispatch, run: Run) => unknown>();
  readonly #waiters = new Set<() => void>();
  readonly #pending = new Set<Promise<void>>();
  #adopted: boolean;
  #nextId = 1000;
  #nextRun = 1;

  constructor(options: WorldOptions) {
    this.root = options.root;
    this.serverUrl = options.serverUrl ?? "http://127.0.0.1";
    this.#adopted = options.serverUrl !== undefined;
    this.now = options.now ?? Date.now;
    mkdirSync(this.root, { recursive: true });
    this.users.set(ACTIONS_BOT.login, { ...ACTIONS_BOT, nodeId: nodeId("Bot", ACTIONS_BOT.id) });
  }

  /** Back to an empty world: no account, repository, token or record, and no bare repository. */
  clear(): void {
    for (const repository of this.repositories.values()) {
      rmSync(repository.git.path, { recursive: true, force: true });
    }
    for (const map of [
      this.users,
      this.organizations,
      this.repositories,
      this.apps,
      this.installations,
      this.tokens,
      this.runs,
      this.jobs,
      this.artifacts,
      this.runtimeTokens,
    ]) {
      map.clear();
    }
    this.events.length = 0;
    this.dispatches.length = 0;
    this.violations.length = 0;
    this.signed.clear();
    this.users.set(ACTIONS_BOT.login, { ...ACTIONS_BOT, nodeId: nodeId("Bot", ACTIONS_BOT.id) });
  }

  /** Without a configured `serverUrl`, the first request's origin becomes it. */
  adopt(origin: string): void {
    if (this.#adopted) return;
    this.#adopted = true;
    this.serverUrl = origin;
  }

  /** Resolves once every event still being built (a pull request's) is recorded. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  id(): number {
    return this.#nextId++;
  }

  iso(time = this.now()): string {
    return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  // Accounts

  addUser(login: string, type: "User" | "Bot" = "User"): Account {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*(\[bot\])?$/.test(login)) {
      throw new GitHubError(422, `${login} is not a valid login.`);
    }
    if (this.#account(login)) throw new GitHubError(422, `${login} already exists.`);
    const id = this.id();
    const account = { login, id, nodeId: nodeId(type, id), type };
    this.users.set(login.toLowerCase(), account);
    return account;
  }

  addOrganization(options: {
    login: string;
    owners?: string[];
    members?: string[];
    basePermission?: Role | "none";
  }): Organization {
    if (this.#account(options.login)) {
      throw new GitHubError(422, `${options.login} already exists.`);
    }
    const id = this.id();
    const organization: Organization = {
      account: {
        login: options.login,
        id,
        nodeId: nodeId("Organization", id),
        type: "Organization",
      },
      owners: new Set((options.owners ?? []).map((login) => this.user(login).login.toLowerCase())),
      members: new Set(
        (options.members ?? []).map((login) => this.user(login).login.toLowerCase()),
      ),
      basePermission: options.basePermission ?? "read",
    };
    this.organizations.set(options.login.toLowerCase(), organization);
    return organization;
  }

  /** A user or bot by login; a 404 when there is none. */
  user(login: string): Account {
    const account = this.users.get(login.toLowerCase());
    if (!account) throw new GitHubError(404, `${login} is not a user`);
    return account;
  }

  #account(login: string): Account | undefined {
    return (
      this.users.get(login.toLowerCase()) ?? this.organizations.get(login.toLowerCase())?.account
    );
  }

  owner(login: string): Account {
    const account = this.#account(login);
    if (!account) throw new GitHubError(404, "Not Found");
    return account;
  }

  // Repositories

  /**
   * A repository on a new bare repository: empty, from a fixture directory (one commit on the
   * default branch, with a fixed author and date, so its SHA is the same each time), from
   * `files`, or as a copy of another git repository (`source`).
   */
  async addRepository(options: {
    owner: string;
    name: string;
    private?: boolean;
    defaultBranch?: string;
    fixture?: string;
    files?: Record<string, string | Buffer>;
    /** Submodules of the first commit, with `files`: each path's commit, as a gitlink. */
    submodules?: Record<string, string>;
    source?: string;
    collaborators?: Record<string, Role>;
    drafts?: boolean;
  }): Promise<Repository> {
    const owner = this.owner(options.owner);
    const full = `${owner.login}/${options.name}`;
    if (!/^[A-Za-z0-9._-]+$/.test(options.name) || options.name.endsWith(".git")) {
      throw new GitHubError(422, `${options.name} is not a valid repository name.`);
    }
    if (this.repositories.has(full.toLowerCase())) {
      throw new GitHubError(422, `${full} already exists.`);
    }
    const path = join(this.root, owner.login.toLowerCase(), `${options.name.toLowerCase()}.git`);
    let defaultBranch = options.defaultBranch ?? "main";
    let git: BareRepository;
    if (options.source) {
      git = await BareRepository.clone(options.source, path);
      const head = await git.text(["symbolic-ref", "--short", "HEAD"]).catch(() => "");
      if (options.defaultBranch) {
        await git.run(["symbolic-ref", "HEAD", `refs/heads/${options.defaultBranch}`]);
      } else if (head) defaultBranch = head;
    } else {
      git = await BareRepository.init(path, defaultBranch);
      const fixed: Identity = {
        name: "Codeman e2e",
        email: "e2e@codeman.invalid",
        date: "2026-01-01T00:00:00Z",
      };
      let tree: string | undefined;
      if (options.fixture) {
        const index = join(path, "fixture-index");
        const env = { GIT_INDEX_FILE: index, GIT_WORK_TREE: options.fixture };
        await git.run(["add", "-A", "--", "."], { env, cwd: options.fixture });
        tree = await git.text(["write-tree"], { env });
        rmSync(index, { force: true });
      } else if (options.files) {
        for (const [file, sha] of Object.entries(options.submodules ?? {})) {
          if (!/^[0-9a-f]{40}$/.test(sha)) {
            throw new GitHubError(422, `Submodule ${file}'s commit must be a full SHA.`);
          }
        }
        tree = await git.buildTree(undefined, [
          ...Object.entries(options.files).map(([file, content]) => ({
            path: file,
            mode: "100644",
            type: "blob" as const,
            content: Buffer.from(content),
          })),
          // A gitlink, as `git submodule add` records it; the commit need not exist here.
          ...Object.entries(options.submodules ?? {}).map(([file, sha]) => ({
            path: file,
            mode: "160000",
            type: "commit" as const,
            sha,
          })),
        ]);
      }
      if (tree) {
        const sha = await git.commitTree({
          tree,
          parents: [],
          message: "Initial commit\n",
          author: fixed,
          committer: fixed,
        });
        await git.updateRef(`refs/heads/${defaultBranch}`, sha, ZERO_SHA);
      }
    }
    const id = this.id();
    const repository: Repository = {
      id,
      nodeId: nodeId("Repository", id),
      owner,
      name: options.name,
      fullName: full,
      private: options.private ?? true,
      defaultBranch,
      git,
      collaborators: new Map(),
      labels: new Map(),
      issues: new Map(),
      nextNumber: 1,
      workflowIds: new Map(),
      drafts: options.drafts ?? true,
      createdAt: this.iso(),
    };
    for (const [login, role] of Object.entries(options.collaborators ?? {})) {
      repository.collaborators.set(this.user(login).login.toLowerCase(), role);
    }
    this.repositories.set(full.toLowerCase(), repository);
    return repository;
  }

  repository(fullName: string): Repository {
    const repository = this.repositories.get(fullName.toLowerCase());
    if (!repository) throw notFound();
    return repository;
  }

  setCollaborator(repository: Repository, login: string, role: Role | null): void {
    const key = this.user(login).login.toLowerCase();
    if (role) repository.collaborators.set(key, role);
    else repository.collaborators.delete(key);
  }

  /** A user's role on a repository, from ownership, the organization and collaborators. */
  role(repository: Repository, login: string): Role | "none" {
    const key = login.toLowerCase();
    if (repository.owner.type === "User" && repository.owner.login.toLowerCase() === key) {
      return "admin";
    }
    const organization = this.organizations.get(repository.owner.login.toLowerCase());
    if (organization?.owners.has(key)) return "admin";
    let role: Role | "none" = repository.collaborators.get(key) ?? "none";
    if (organization?.members.has(key) && RANK[organization.basePermission] > RANK[role]) {
      role = organization.basePermission;
    }
    return role;
  }

  /** At least `role`, counting public repositories as readable by everyone. */
  allows(repository: Repository, login: string, role: Role): boolean {
    const held = this.role(repository, login);
    const effective = !repository.private && RANK[held] < RANK.read ? "read" : held;
    return RANK[effective] >= RANK[role];
  }

  /** The legacy permission GitHub reports: `maintain` as `write`, `triage` as `read`. */
  permission(repository: Repository, login: string): { permission: string; role: string } {
    const role = this.role(repository, login);
    const legacy = {
      admin: "admin",
      maintain: "write",
      write: "write",
      triage: "read",
      read: "read",
    };
    if (role === "none") {
      return repository.private
        ? { permission: "none", role: "none" }
        : { permission: "read", role: "read" };
    }
    return { permission: legacy[role], role };
  }

  authorAssociation(repository: Repository, login: string): string {
    const key = login.toLowerCase();
    if (repository.owner.login.toLowerCase() === key) return "OWNER";
    const organization = this.organizations.get(repository.owner.login.toLowerCase());
    if (organization?.owners.has(key) || organization?.members.has(key)) return "MEMBER";
    if (repository.collaborators.has(key)) return "COLLABORATOR";
    return "NONE";
  }

  // Apps and tokens

  /** An App and its bot account; with no `publicKey`, a new key pair whose private key it returns. */
  registerApp(options: { slug: string; name?: string; clientId?: string; publicKey?: string }): {
    app: App;
    privateKey?: string;
  } {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(options.slug)) {
      throw new GitHubError(422, `${options.slug} is not a valid App slug.`);
    }
    if ([...this.apps.values()].some((app) => app.slug === options.slug)) {
      throw new GitHubError(422, `The App ${options.slug} already exists.`);
    }
    let privateKey: string | undefined;
    let publicKey: KeyObject;
    if (options.publicKey) publicKey = createPublicKey(options.publicKey);
    else {
      const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
      publicKey = pair.publicKey;
      privateKey = pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    }
    const id = this.id();
    const bot = this.addUser(`${options.slug}[bot]`, "Bot");
    const app: App = {
      id,
      slug: options.slug,
      name: options.name ?? options.slug,
      clientId: options.clientId ?? `Iv23${randomBytes(8).toString("hex")}`,
      publicKey,
      bot,
    };
    this.apps.set(id, app);
    return { app, ...(privateKey ? { privateKey } : {}) };
  }

  app(slugOrId: string | number): App {
    const app = [...this.apps.values()].find(
      (candidate) => candidate.slug === slugOrId || candidate.id === Number(slugOrId),
    );
    if (!app) throw new GitHubError(404, `No App ${slugOrId}.`);
    return app;
  }

  install(options: {
    app: string | number;
    owner: string;
    repositories?: string[] | "all";
    permissions: Permissions;
  }): Installation {
    const app = this.app(options.app);
    const account = this.owner(options.owner);
    const repositories =
      options.repositories === undefined || options.repositories === "all"
        ? ("all" as const)
        : new Set(options.repositories.map((name) => name.toLowerCase()));
    const installation: Installation = {
      id: this.id(),
      app,
      account,
      repositories,
      permissions: { metadata: "read", ...options.permissions },
    };
    this.installations.set(installation.id, installation);
    return installation;
  }

  /** The installation of `app` on `owner`, which covers `repository` when given. */
  installationFor(app: App, owner: string, repository?: string): Installation | undefined {
    return [...this.installations.values()].find(
      (installation) =>
        installation.app.id === app.id &&
        installation.account.login.toLowerCase() === owner.toLowerCase() &&
        (repository === undefined ||
          installation.repositories === "all" ||
          installation.repositories.has(repository.toLowerCase())),
    );
  }

  /**
   * An installation token, as `POST /app/installations/{id}/access_tokens` gives one: for the
   * repositories asked (all the installation's by default) and the permissions asked (all the
   * installation's by default), neither beyond the installation's.
   */
  installationToken(
    installation: Installation,
    options: { repositories?: string[]; permissions?: Permissions } = {},
  ): Token {
    const owner = installation.account.login;
    let repositories: Set<string> | "all" = installation.repositories;
    if (options.repositories && options.repositories.length > 0) {
      const names = options.repositories.map((name) => name.toLowerCase());
      const inside = (name: string) =>
        this.repositories.has(`${owner}/${name}`.toLowerCase()) &&
        (installation.repositories === "all" || installation.repositories.has(name));
      if (!names.every(inside)) {
        throw unprocessable(
          "There is at least one repository that does not exist or is not accessible to the parent installation.",
        );
      }
      repositories = new Set(names);
    }
    let permissions = installation.permissions;
    if (options.permissions && Object.keys(options.permissions).length > 0) {
      const beyond = Object.entries(options.permissions).filter(
        ([name, level]) =>
          !grants(installation.permissions, name, level === "read" ? "read" : "write"),
      );
      if (beyond.length > 0) {
        throw unprocessable("The permissions requested are not granted to this installation.");
      }
      permissions = { ...options.permissions };
    }
    return this.#token({
      kind: "installation",
      actor: installation.app.bot,
      owner,
      repositories:
        repositories === "all"
          ? "all"
          : new Set([...repositories].map((name) => `${owner}/${name}`.toLowerCase())),
      permissions,
      installation,
    });
  }

  /** A `GITHUB_TOKEN` for a job: one repository, the job's permissions, and `metadata: read`. */
  jobToken(options: {
    repository: string;
    permissions: Permissions;
    runId?: number;
    job?: string;
  }): Token {
    const repository = this.repository(options.repository);
    return this.#token({
      kind: "job",
      actor: this.user(ACTIONS_BOT.login),
      owner: repository.owner.login,
      repositories: new Set([repository.fullName.toLowerCase()]),
      permissions: { ...options.permissions, metadata: "read" },
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
      ...(options.job !== undefined ? { job: options.job } : {}),
    });
  }

  #token(fields: Omit<Token, "value" | "expiresAt" | "revoked">): Token {
    const token: Token = {
      ...fields,
      value: tokenValue(),
      expiresAt: this.now() + HOUR,
      revoked: false,
    };
    this.tokens.set(token.value, token);
    return token;
  }

  /** Who a request's `Authorization` names; a 401, recorded as a violation, for anything else. */
  identify(authorization: string | undefined, method: string, path: string): Caller {
    const value = credential(authorization);
    if (!value) return { kind: "anonymous" };
    const token = this.tokens.get(value);
    if (token) {
      if (token.revoked) this.#refuse("revoked-token", method, path, masked(value));
      if (token.expiresAt <= this.now()) this.#refuse("expired-token", method, path, masked(value));
      return { kind: "token", token };
    }
    const jwt = decodeJwt(value);
    if (jwt && typeof jwt.payload.iss !== "undefined") {
      const issuer = String(jwt.payload.iss);
      const app = [...this.apps.values()].find(
        (candidate) => candidate.clientId === issuer || String(candidate.id) === issuer,
      );
      if (!app) this.#refuse("unknown-app", method, path, `JWT issued by ${issuer}`);
      const problem = jwtProblem(jwt, app.publicKey, Math.floor(this.now() / 1000));
      if (problem) throw new GitHubError(401, problem);
      return { kind: "app", app };
    }
    this.#refuse("unknown-token", method, path, masked(value));
  }

  #refuse(kind: string, method: string, path: string, detail: string): never {
    this.violate({ kind, method, path, detail });
    throw new GitHubError(401, "Bad credentials");
  }

  violate(violation: Omit<Violation, "at">): void {
    this.violations.push({ ...violation, at: this.iso() });
    this.#wake();
  }

  /**
   * Whether `caller` may use an endpoint of `repository` that needs `need`: a 404 when it may not
   * see the repository, a 403 like GitHub's when it may see it but lacks the permission. Public
   * repositories are readable by any caller.
   */
  authorize(caller: Caller, repository: Repository, need: Need): void {
    if (caller.kind === "app") throw new GitHubError(403, "Resource not accessible by integration");
    const read = need.level === "read";
    if (caller.kind === "anonymous") {
      if (!repository.private && read) return;
      if (repository.private) throw notFound();
      throw new GitHubError(401, "Requires authentication");
    }
    const { token } = caller;
    if (!this.covers(token, repository)) {
      if (!repository.private && read) return;
      if (repository.private) throw notFound();
      throw new GitHubError(403, "Resource not accessible by integration");
    }
    const names = typeof need.permission === "string" ? [need.permission] : need.permission;
    if (!names.some((name) => grants(token.permissions, name, need.level))) {
      if (!repository.private && read && names.some((name) => PUBLIC_READS.has(name))) return;
      throw forbidden(need);
    }
  }

  covers(token: Token, repository: Repository): boolean {
    return token.repositories === "all"
      ? repository.owner.login.toLowerCase() === token.owner.toLowerCase()
      : token.repositories.has(repository.fullName.toLowerCase());
  }

  /** The account an API caller acts as. */
  actor(caller: Caller): Account {
    if (caller.kind === "token") return caller.token.actor;
    throw new GitHubError(401, "Requires authentication");
  }

  // Issues and pull requests

  issue(repository: Repository, number: number): Issue {
    const issue = repository.issues.get(number);
    if (!issue) throw notFound();
    return issue;
  }

  findComment(repository: Repository, id: number): { issue: Issue; comment: Comment } {
    for (const issue of repository.issues.values()) {
      const comment = issue.comments.find((candidate) => candidate.id === id);
      if (comment) return { issue, comment };
    }
    throw notFound();
  }

  #label(repository: Repository, name: string): Label {
    const found = [...repository.labels.values()].find(
      (label) => label.name.toLowerCase() === name.toLowerCase(),
    );
    if (found) return found;
    const id = this.id();
    const label = { id, nodeId: nodeId("Label", id), name, color: "ededed" };
    repository.labels.set(name, label);
    return label;
  }

  label(repository: Repository, name: string): Label {
    return this.#label(repository, name);
  }

  openIssue(
    repository: Repository,
    actor: Account,
    options: { title: string; body?: string; labels?: string[] },
    triggers = true,
  ): Issue {
    if (!options.title) {
      throw unprocessable("Validation Failed", {
        errors: [{ resource: "Issue", field: "title", code: "missing_field" }],
      });
    }
    const id = this.id();
    const now = this.iso();
    const issue: Issue = {
      id,
      nodeId: nodeId("Issue", id),
      number: repository.nextNumber++,
      title: options.title,
      body: options.body ?? "",
      state: "open",
      stateReason: null,
      labels: [],
      user: actor,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      comments: [],
    };
    repository.issues.set(issue.number, issue);
    this.emitIssue(repository, issue, "opened", actor, triggers);
    for (const name of options.labels ?? [])
      this.addLabels(repository, issue, [name], actor, triggers);
    return issue;
  }

  editIssue(
    repository: Repository,
    issue: Issue,
    actor: Account,
    changes: { title?: string; body?: string; state?: "open" | "closed"; stateReason?: string },
    triggers = true,
  ): void {
    if (changes.title !== undefined) issue.title = changes.title;
    if (changes.body !== undefined) issue.body = changes.body;
    if (changes.title !== undefined || changes.body !== undefined) {
      issue.updatedAt = this.iso();
      this.emitIssue(repository, issue, "edited", actor, triggers);
    }
    if (changes.state && changes.state !== issue.state) {
      issue.state = changes.state;
      issue.updatedAt = this.iso();
      issue.closedAt = changes.state === "closed" ? this.iso() : null;
      issue.stateReason =
        changes.state === "closed" ? (changes.stateReason ?? "completed") : "reopened";
      this.emitIssue(
        repository,
        issue,
        changes.state === "closed" ? "closed" : "reopened",
        actor,
        triggers,
      );
    }
  }

  addLabels(
    repository: Repository,
    issue: Issue,
    names: readonly string[],
    actor: Account,
    triggers = true,
  ): void {
    for (const name of names) {
      const label = this.#label(repository, name);
      if (issue.labels.includes(label.name)) continue;
      issue.labels.push(label.name);
      issue.updatedAt = this.iso();
      this.emitIssue(repository, issue, "labeled", actor, triggers, {
        label: labelJson(this, repository, label),
      });
    }
  }

  /** False when the issue had no such label. */
  removeLabel(
    repository: Repository,
    issue: Issue,
    name: string,
    actor: Account,
    triggers = true,
  ): boolean {
    const index = issue.labels.findIndex((label) => label.toLowerCase() === name.toLowerCase());
    if (index < 0) return false;
    const [removed = name] = issue.labels.splice(index, 1);
    issue.updatedAt = this.iso();
    const label = this.#label(repository, removed);
    this.emitIssue(repository, issue, "unlabeled", actor, triggers, {
      label: labelJson(this, repository, label),
    });
    return true;
  }

  comment(
    repository: Repository,
    issue: Issue,
    actor: Account,
    body: string,
    triggers = true,
  ): Comment {
    if (!body) {
      throw unprocessable("Validation Failed", {
        errors: [{ resource: "IssueComment", field: "body", code: "missing_field" }],
      });
    }
    const id = this.id();
    const now = this.iso();
    const comment = {
      id,
      nodeId: nodeId("IssueComment", id),
      user: actor,
      body,
      createdAt: now,
      updatedAt: now,
    };
    issue.comments.push(comment);
    issue.updatedAt = now;
    this.emit("issue_comment", repository, actor, triggers, {
      action: "created",
      issue: issueJson(this, repository, issue),
      comment: commentJson(this, repository, issue, comment),
    });
    return comment;
  }

  editComment(
    repository: Repository,
    issue: Issue,
    comment: Comment,
    actor: Account,
    body: string,
    triggers = true,
  ): void {
    const from = comment.body;
    comment.body = body;
    comment.updatedAt = this.iso();
    this.emit("issue_comment", repository, actor, triggers, {
      action: "edited",
      changes: { body: { from } },
      issue: issueJson(this, repository, issue),
      comment: commentJson(this, repository, issue, comment),
    });
  }

  deleteComment(
    repository: Repository,
    issue: Issue,
    comment: Comment,
    actor: Account,
    triggers = true,
  ): void {
    issue.comments = issue.comments.filter((candidate) => candidate.id !== comment.id);
    this.emit("issue_comment", repository, actor, triggers, {
      action: "deleted",
      issue: issueJson(this, repository, issue),
      comment: commentJson(this, repository, issue, comment),
    });
  }

  /** A pull request; 422s as GitHub answers a head without commits, a duplicate or a refused draft. */
  async openPullRequest(
    repository: Repository,
    actor: Account,
    options: { head: string; base: string; title: string; body?: string; draft?: boolean },
    triggers = true,
  ): Promise<Issue> {
    const head = options.head.includes(":") ? (options.head.split(":")[1] ?? "") : options.head;
    const headSha = await repository.git.resolve(`refs/heads/${head}`);
    const baseSha = await repository.git.resolve(`refs/heads/${options.base}`);
    const invalid = (field: string) =>
      unprocessable("Validation Failed", {
        errors: [{ resource: "PullRequest", field, code: "invalid" }],
      });
    if (!headSha) throw invalid("head");
    if (!baseSha) throw invalid("base");
    const open = [...repository.issues.values()].find(
      (issue) =>
        issue.pull &&
        issue.state === "open" &&
        issue.pull.head === head &&
        issue.pull.base === options.base,
    );
    if (open) {
      throw unprocessable("Validation Failed", {
        errors: [
          {
            resource: "PullRequest",
            code: "custom",
            message: `A pull request already exists for ${repository.owner.login}:${head}.`,
          },
        ],
      });
    }
    if (await repository.git.isAncestor(headSha, baseSha)) {
      throw unprocessable("Validation Failed", {
        errors: [
          {
            resource: "PullRequest",
            code: "custom",
            message: `No commits between ${options.base} and ${head}`,
          },
        ],
      });
    }
    if (options.draft && !repository.drafts) {
      throw unprocessable("Validation Failed", {
        errors: [
          {
            resource: "PullRequest",
            code: "custom",
            message: "Draft pull requests are not supported in this repository.",
          },
        ],
      });
    }
    if (!options.title) {
      throw unprocessable("Validation Failed", {
        errors: [{ resource: "PullRequest", field: "title", code: "missing_field" }],
      });
    }
    const id = this.id();
    const now = this.iso();
    const issue: Issue = {
      id: this.id(),
      nodeId: nodeId("Issue", id),
      number: repository.nextNumber++,
      title: options.title,
      body: options.body ?? "",
      state: "open",
      stateReason: null,
      labels: [],
      user: actor,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      comments: [],
      pull: {
        id,
        nodeId: nodeId("PullRequest", id),
        head,
        base: options.base,
        headSha,
        draft: options.draft ?? false,
        reviews: [],
        reviewComments: [],
      },
    };
    repository.issues.set(issue.number, issue);
    await this.emitPull(repository, issue, "opened", actor, triggers);
    return issue;
  }

  async editPullRequest(
    repository: Repository,
    issue: Issue,
    actor: Account,
    changes: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      base?: string;
      draft?: boolean;
    },
    triggers = true,
  ): Promise<void> {
    const pull = this.#pull(issue);
    if (changes.base !== undefined) {
      if (!(await repository.git.resolve(`refs/heads/${changes.base}`))) {
        throw unprocessable("Validation Failed", {
          errors: [{ resource: "PullRequest", field: "base", code: "invalid" }],
        });
      }
      pull.base = changes.base;
    }
    if (changes.title !== undefined) issue.title = changes.title;
    if (changes.body !== undefined) issue.body = changes.body;
    issue.updatedAt = this.iso();
    if (changes.title !== undefined || changes.body !== undefined || changes.base !== undefined) {
      await this.emitPull(repository, issue, "edited", actor, triggers);
    }
    if (changes.draft === false && pull.draft) {
      pull.draft = false;
      await this.emitPull(repository, issue, "ready_for_review", actor, triggers);
    }
    if (changes.state && changes.state !== issue.state) {
      issue.state = changes.state;
      issue.closedAt = changes.state === "closed" ? this.iso() : null;
      await this.emitPull(
        repository,
        issue,
        changes.state === "closed" ? "closed" : "reopened",
        actor,
        triggers,
      );
    }
  }

  #pull(issue: Issue): PullRequest {
    if (!issue.pull) throw notFound();
    return issue.pull;
  }

  async review(
    repository: Repository,
    issue: Issue,
    actor: Account,
    options: {
      state: ReviewState;
      body?: string;
      comments?: { path: string; line?: number; body: string }[];
    },
    triggers = true,
  ): Promise<Review> {
    const pull = this.#pull(issue);
    if (issue.user.id === actor.id && options.state !== "COMMENTED") {
      throw unprocessable("Unprocessable Entity", {
        errors: ["Can not approve or request changes on your own pull request"],
      });
    }
    const commitId = (await repository.git.resolve(`refs/heads/${pull.head}`)) ?? pull.headSha;
    const id = this.id();
    const review: Review = {
      id,
      nodeId: nodeId("PullRequestReview", id),
      user: actor,
      body: options.body ?? "",
      state: options.state,
      submittedAt: this.iso(),
      commitId,
    };
    pull.reviews.push(review);
    for (const comment of options.comments ?? []) {
      const commentId = this.id();
      pull.reviewComments.push({
        id: commentId,
        nodeId: nodeId("PullRequestReviewComment", commentId),
        reviewId: review.id,
        user: actor,
        path: comment.path,
        line: comment.line ?? null,
        body: comment.body,
        createdAt: review.submittedAt,
        commitId,
      });
    }
    this.emit("pull_request_review", repository, actor, triggers, {
      action: "submitted",
      review: { ...reviewJson(this, repository, issue, review), state: review.state.toLowerCase() },
      pull_request: await pullJson(this, repository, issue),
    });
    return review;
  }

  /** A commit on `branch` by `actor`, with `files` (null deletes one), as a push makes it. */
  async push(
    repository: Repository,
    actor: Account,
    options: {
      branch: string;
      files: Record<string, string | Buffer | null>;
      message?: string;
      /** The parent: the branch's head by default, or the default branch's for a new branch. */
      base?: string;
      /** Moves the branch even when the new commit does not descend from its head. */
      force?: boolean;
      /** The commit's author and committer date, which git lets whoever commits choose; now by default. */
      date?: string;
    },
    triggers = true,
  ): Promise<string> {
    const ref = `refs/heads/${options.branch}`;
    const before = await repository.git.resolve(ref);
    const parent =
      (options.base ? await repository.git.resolve(options.base) : undefined) ??
      before ??
      (await repository.git.resolve(`refs/heads/${repository.defaultBranch}`));
    if (options.base && !parent) throw new GitHubError(422, `No commit ${options.base}.`);
    const baseTree = parent ? await repository.git.resolveTree(parent) : undefined;
    const tree = await repository.git.buildTree(
      baseTree,
      Object.entries(options.files).map(([path, content]) => ({
        path,
        mode: "100644",
        type: "blob" as const,
        ...(content === null ? { sha: null } : { content: Buffer.from(content) }),
      })),
    );
    const who = { name: actor.login, email: noreply(actor), date: options.date ?? this.iso() };
    const sha = await repository.git.commitTree({
      tree,
      parents: parent ? [parent] : [],
      message: options.message ?? "Update",
      author: who,
      committer: who,
    });
    if (before && !options.force && !(await repository.git.isAncestor(before, sha))) {
      throw new GitHubError(422, `The push to ${options.branch} is not a fast-forward.`);
    }
    if (!(await repository.git.updateRef(ref, sha, before ?? ZERO_SHA))) {
      throw new GitHubError(409, `${options.branch} moved during the push.`);
    }
    await this.emitPush(repository, actor, ref, before ?? ZERO_SHA, sha, triggers);
    return sha;
  }

  /** A `push` event for a ref that moved from `before` to `after`. */
  async emitPush(
    repository: Repository,
    actor: Account,
    ref: string,
    before: string,
    after: string,
    triggers: boolean,
  ): Promise<void> {
    const commits: CommitObject[] = [];
    if (after !== ZERO_SHA) {
      const range = before === ZERO_SHA ? after : `${before}..${after}`;
      for (const sha of (await repository.git.text(["rev-list", "--reverse", range])).split("\n")) {
        const commit = sha ? await repository.git.readCommit(sha) : undefined;
        if (commit) commits.push(commit);
      }
    }
    const forced =
      before !== ZERO_SHA &&
      after !== ZERO_SHA &&
      !(await repository.git.isAncestor(before, after));
    const pushed = commits.map((commit) => ({
      id: commit.sha,
      tree_id: commit.tree,
      message: commit.message.trimEnd(),
      timestamp: commit.committer.date,
      url: `${this.serverUrl}/${repository.fullName}/commit/${commit.sha}`,
      author: { name: commit.author.name, email: commit.author.email },
      committer: { name: commit.committer.name, email: commit.committer.email },
    }));
    this.emit("push", repository, actor, triggers, {
      ref,
      before,
      after,
      created: before === ZERO_SHA,
      deleted: after === ZERO_SHA,
      forced,
      base_ref: null,
      compare: `${this.serverUrl}/${repository.fullName}/compare/${before.slice(0, 12)}...${after.slice(0, 12)}`,
      commits: pushed,
      head_commit: pushed.at(-1) ?? null,
      pusher: { name: actor.login, email: noreply(actor) },
    });
  }

  // Events

  emitIssue(
    repository: Repository,
    issue: Issue,
    action: string,
    actor: Account,
    triggers: boolean,
    extra: Record<string, unknown> = {},
  ): void {
    if (issue.pull) {
      const pending = this.emitPull(repository, issue, action, actor, triggers, extra);
      this.#pending.add(pending);
      pending.finally(() => this.#pending.delete(pending)).catch(() => undefined);
      return;
    }
    this.emit("issues", repository, actor, triggers, {
      action,
      issue: issueJson(this, repository, issue),
      ...extra,
    });
  }

  async emitPull(
    repository: Repository,
    issue: Issue,
    action: string,
    actor: Account,
    triggers: boolean,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    this.emit("pull_request", repository, actor, triggers, {
      action,
      number: issue.number,
      pull_request: await pullJson(this, repository, issue),
      ...extra,
    });
  }

  /** Records an event with the `repository`, `organization` and `sender` GitHub adds. */
  emit(
    name: string,
    repository: Repository,
    sender: Account,
    triggers: boolean,
    payload: Record<string, unknown>,
  ): GitHubEvent {
    const organization = this.organizations.get(repository.owner.login.toLowerCase());
    const event: GitHubEvent = {
      id: this.events.length + 1,
      name,
      repository: repository.fullName,
      payload: {
        ...payload,
        repository: repositoryJson(this, repository),
        ...(organization ? { organization: accountJson(this, organization.account) } : {}),
        sender: accountJson(this, sender),
      },
      at: this.iso(),
      triggers: triggers || name === "workflow_dispatch",
    };
    this.events.push(event);
    for (const listener of this.#eventListeners) this.#call(() => listener(event));
    this.#wake();
    return event;
  }

  onEvent(listener: (event: GitHubEvent) => unknown): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onDispatch(listener: (dispatch: Dispatch, run: Run) => unknown): () => void {
    this.#dispatchListeners.add(listener);
    return () => this.#dispatchListeners.delete(listener);
  }

  /** Resolves when an event, dispatch or violation is recorded, or after `ms`. */
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.#waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.#waiters.add(done);
    });
  }

  #wake(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }

  /** A listener's failure is a violation, never the request's. */
  #call(listener: () => unknown): void {
    queueMicrotask(() => {
      Promise.resolve()
        .then(listener)
        .catch((error: unknown) =>
          this.violate({
            kind: "listener",
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
    });
  }

  // Workflows and runs

  /** The workflows of the default branch, as `GET /actions/workflows` lists them. */
  async workflows(repository: Repository): Promise<{ id: number; path: string; name: string }[]> {
    const tree = await repository.git.resolveTree(`refs/heads/${repository.defaultBranch}`);
    if (!tree) return [];
    const entries = await repository.git.listTree(tree, true);
    const workflows: { id: number; path: string; name: string }[] = [];
    for (const entry of entries) {
      if (entry.type !== "blob" || !/^\.github\/workflows\/[^/]+\.ya?ml$/.test(entry.path))
        continue;
      const source = (await repository.git.readBlob(entry.sha)).toString("utf8");
      let id = repository.workflowIds.get(entry.path);
      if (id === undefined) {
        id = this.id();
        repository.workflowIds.set(entry.path, id);
      }
      workflows.push({ id, path: entry.path, name: workflowInfo(source).name ?? entry.path });
    }
    return workflows;
  }

  /** A run the runtime starts, or a dispatch does. */
  startRun(options: {
    repository: string;
    workflow: string;
    event: string;
    name?: string;
    headBranch?: string;
    headSha?: string;
    status?: RunStatus;
    concurrency?: string;
    actor?: string;
    inputs?: Record<string, string>;
    runAttempt?: number;
  }): Run {
    const repository = this.repository(options.repository);
    const id = this.#nextRun++ + 9000;
    const now = this.iso();
    const run: Run = {
      id,
      nodeId: nodeId("WorkflowRun", id),
      repository,
      workflowPath: options.workflow,
      name: options.name ?? options.workflow,
      event: options.event,
      status: options.status ?? "queued",
      conclusion: null,
      headBranch: options.headBranch ?? repository.defaultBranch,
      headSha: options.headSha ?? "",
      runNumber:
        [...this.runs.values()].filter((other) => other.repository === repository).length + 1,
      runAttempt: options.runAttempt ?? 1,
      createdAt: now,
      updatedAt: now,
      ...(options.concurrency ? { concurrency: options.concurrency } : {}),
      actor: options.actor ? this.user(options.actor) : this.user(ACTIONS_BOT.login),
      backendId: randomUUID(),
      ...(options.inputs ? { inputs: options.inputs } : {}),
      jobs: [],
    };
    this.runs.set(id, run);
    return run;
  }

  run(id: number): Run {
    const run = this.runs.get(id);
    if (!run) throw notFound();
    return run;
  }

  updateRun(
    run: Run,
    changes: { status?: RunStatus; conclusion?: string | null; concurrency?: string | null },
  ): void {
    if (changes.status) run.status = changes.status;
    if (changes.conclusion !== undefined) run.conclusion = changes.conclusion;
    if (changes.concurrency === null) delete run.concurrency;
    else if (changes.concurrency) run.concurrency = changes.concurrency;
    run.updatedAt = this.iso();
  }

  /** A job of `run`, with the `ACTIONS_RUNTIME_TOKEN` its artifact actions use. */
  startJob(run: Run, name: string): { job: Job; runtimeToken: string } {
    const job: Job = {
      id: this.id(),
      runId: run.id,
      name,
      status: "in_progress",
      conclusion: null,
      log: "",
      backendId: randomUUID(),
      startedAt: this.iso(),
      completedAt: null,
    };
    run.jobs.push(job);
    this.jobs.set(job.id, job);
    const runtimeToken = signJwt(
      {
        scp: `Actions.ExampleScope Actions.Results:${run.backendId}:${job.backendId}`,
        iat: Math.floor(this.now() / 1000),
        exp: Math.floor(this.now() / 1000) + 6 * 3600,
      },
      this.secret,
    );
    this.runtimeTokens.set(runtimeToken, { run, job });
    return { job, runtimeToken };
  }

  finishJob(job: Job, options: { conclusion: string; log?: string }): void {
    job.status = "completed";
    job.conclusion = options.conclusion;
    job.completedAt = this.iso();
    if (options.log !== undefined) job.log = options.log;
  }

  /**
   * Records a `workflow_dispatch` and the queued run it makes, and hands both to the dispatch
   * listeners: GitHub would start the run, the e2e runtime does.
   */
  async dispatch(
    repository: Repository,
    workflow: { id: number; path: string; name: string },
    ref: string,
    inputs: Record<string, string>,
    sender: Account,
  ): Promise<Run> {
    const short = ref.replace(/^refs\/(heads|tags)\//, "");
    const sha =
      (await repository.git.resolve(ref.startsWith("refs/") ? ref : `refs/heads/${ref}`)) ??
      (await repository.git.resolve(`refs/tags/${short}`)) ??
      "";
    const run = this.startRun({
      repository: repository.fullName,
      workflow: workflow.path,
      name: workflow.name,
      event: "workflow_dispatch",
      headBranch: short,
      headSha: sha,
      actor: sender.login,
      inputs,
    });
    const dispatch: Dispatch = {
      id: this.dispatches.length + 1,
      repository: repository.fullName,
      workflow: workflow.path,
      workflowId: workflow.id,
      ref: short,
      inputs,
      sender: sender.login,
      runId: run.id,
      at: this.iso(),
    };
    this.dispatches.push(dispatch);
    this.emit("workflow_dispatch", repository, sender, true, {
      inputs,
      ref: ref.startsWith("refs/") ? ref : `refs/heads/${short}`,
      workflow: workflow.path,
    });
    for (const listener of this.#dispatchListeners) this.#call(() => listener(dispatch, run));
    return run;
  }

  // Artifacts

  /** A finalized artifact of `run`, zipped from `files`: the simulator's path, past the protocol. */
  addArtifact(
    run: Run,
    name: string,
    files: Record<string, string | Buffer>,
    jobBackendId = "",
  ): Artifact {
    if (this.#artifactNamed(run, name)) {
      throw new GitHubError(409, `An artifact named ${name} already exists in run ${run.id}.`);
    }
    const data = writeZip(
      Object.entries(files).map(([path, content]) => ({ path, data: Buffer.from(content) })),
    );
    const artifact = this.newArtifact(run, name, jobBackendId);
    this.finalize(artifact, data);
    return artifact;
  }

  newArtifact(run: Run, name: string, jobBackendId: string, retentionDays = 90): Artifact {
    const id = this.id();
    const artifact: Artifact = {
      id,
      nodeId: nodeId("Artifact", id),
      run,
      jobBackendId,
      name,
      size: 0,
      digest: "",
      data: Buffer.alloc(0),
      blocks: new Map(),
      finalized: false,
      createdAt: this.iso(),
      expiresAt: this.iso(this.now() + retentionDays * 24 * HOUR),
    };
    this.artifacts.set(id, artifact);
    return artifact;
  }

  finalize(artifact: Artifact, data: Buffer): void {
    artifact.data = data;
    artifact.size = data.length;
    artifact.digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
    artifact.finalized = true;
    artifact.blocks.clear();
  }

  #artifactNamed(run: Run, name: string): Artifact | undefined {
    return [...this.artifacts.values()].find(
      (artifact) => artifact.run === run && artifact.name === name && artifact.finalized,
    );
  }

  runArtifacts(run: Run): Artifact[] {
    return [...this.artifacts.values()].filter(
      (artifact) => artifact.run === run && artifact.finalized,
    );
  }
}

/** Endpoints a public repository answers to any caller, whatever its token's permissions. */
const PUBLIC_READS = new Set(["contents", "metadata", "issues", "pull_requests", "actions"]);

export function nodeId(type: string, id: number): string {
  return Buffer.from(`0:${type}${id}`).toString("base64").replace(/=+$/, "");
}

export function noreply(account: Account): string {
  return `${account.id}+${account.login}@users.noreply.github.com`;
}

// GitHub's JSON shapes, as far as Codeman, gh and the actions read them.

export function api(world: World): string {
  return `${world.serverUrl}/api/v3`;
}

export function accountJson(world: World, account: Account): Record<string, unknown> {
  return {
    login: account.login,
    id: account.id,
    node_id: account.nodeId,
    type: account.type,
    site_admin: false,
    url: `${api(world)}/users/${account.login}`,
    html_url: `${world.serverUrl}/${account.login}`,
  };
}

export function repositoryJson(world: World, repository: Repository): Record<string, unknown> {
  const url = `${api(world)}/repos/${repository.fullName}`;
  return {
    id: repository.id,
    node_id: repository.nodeId,
    name: repository.name,
    full_name: repository.fullName,
    owner: accountJson(world, repository.owner),
    private: repository.private,
    visibility: repository.private ? "private" : "public",
    fork: false,
    archived: false,
    disabled: false,
    default_branch: repository.defaultBranch,
    html_url: `${world.serverUrl}/${repository.fullName}`,
    clone_url: `${world.serverUrl}/${repository.fullName}.git`,
    url,
    created_at: repository.createdAt,
  };
}

export function labelJson(
  world: World,
  repository: Repository,
  label: Label,
): Record<string, unknown> {
  return {
    id: label.id,
    node_id: label.nodeId,
    name: label.name,
    color: label.color,
    default: false,
    description: null,
    url: `${api(world)}/repos/${repository.fullName}/labels/${encodeURIComponent(label.name)}`,
  };
}

export function issueJson(
  world: World,
  repository: Repository,
  issue: Issue,
): Record<string, unknown> {
  const url = `${api(world)}/repos/${repository.fullName}/issues/${issue.number}`;
  const web = `${world.serverUrl}/${repository.fullName}`;
  return {
    id: issue.id,
    node_id: issue.nodeId,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    state_reason: issue.stateReason,
    locked: false,
    labels: issue.labels.map((name) => labelJson(world, repository, world.label(repository, name))),
    user: accountJson(world, issue.user),
    assignee: null,
    assignees: [],
    comments: issue.comments.length,
    author_association: world.authorAssociation(repository, issue.user.login),
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    closed_at: issue.closedAt,
    url,
    repository_url: `${api(world)}/repos/${repository.fullName}`,
    comments_url: `${url}/comments`,
    html_url: `${web}/${issue.pull ? "pull" : "issues"}/${issue.number}`,
    ...(issue.pull
      ? {
          draft: issue.pull.draft,
          pull_request: {
            url: `${api(world)}/repos/${repository.fullName}/pulls/${issue.number}`,
            html_url: `${web}/pull/${issue.number}`,
            merged_at: null,
          },
        }
      : {}),
  };
}

export function commentJson(
  world: World,
  repository: Repository,
  issue: Issue,
  comment: Comment,
): Record<string, unknown> {
  const web = `${world.serverUrl}/${repository.fullName}/${issue.pull ? "pull" : "issues"}/${issue.number}`;
  return {
    id: comment.id,
    node_id: comment.nodeId,
    body: comment.body,
    user: accountJson(world, comment.user),
    author_association: world.authorAssociation(repository, comment.user.login),
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    url: `${api(world)}/repos/${repository.fullName}/issues/comments/${comment.id}`,
    html_url: `${web}#issuecomment-${comment.id}`,
    issue_url: `${api(world)}/repos/${repository.fullName}/issues/${issue.number}`,
  };
}

export async function pullJson(
  world: World,
  repository: Repository,
  issue: Issue,
): Promise<Record<string, unknown>> {
  const pull = issue.pull;
  if (!pull) throw notFound();
  const headSha = (await repository.git.resolve(`refs/heads/${pull.head}`)) ?? pull.headSha;
  pull.headSha = headSha;
  const baseSha = (await repository.git.resolve(`refs/heads/${pull.base}`)) ?? "";
  const url = `${api(world)}/repos/${repository.fullName}/pulls/${issue.number}`;
  const side = (ref: string, sha: string) => ({
    label: `${repository.owner.login}:${ref}`,
    ref,
    sha,
    user: accountJson(world, repository.owner),
    repo: repositoryJson(world, repository),
  });
  return {
    id: pull.id,
    node_id: pull.nodeId,
    number: issue.number,
    state: issue.state,
    locked: false,
    title: issue.title,
    body: issue.body,
    draft: pull.draft,
    merged: false,
    merged_at: null,
    mergeable: null,
    user: accountJson(world, issue.user),
    labels: issue.labels.map((name) => labelJson(world, repository, world.label(repository, name))),
    head: side(pull.head, headSha),
    base: side(pull.base, baseSha),
    author_association: world.authorAssociation(repository, issue.user.login),
    requested_reviewers: [],
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    closed_at: issue.closedAt,
    url,
    html_url: `${world.serverUrl}/${repository.fullName}/pull/${issue.number}`,
    issue_url: `${api(world)}/repos/${repository.fullName}/issues/${issue.number}`,
  };
}

export function reviewJson(
  world: World,
  repository: Repository,
  issue: Issue,
  review: Review,
): Record<string, unknown> {
  return {
    id: review.id,
    node_id: review.nodeId,
    user: accountJson(world, review.user),
    body: review.body,
    state: review.state,
    commit_id: review.commitId,
    submitted_at: review.submittedAt,
    author_association: world.authorAssociation(repository, review.user.login),
    html_url: `${world.serverUrl}/${repository.fullName}/pull/${issue.number}#pullrequestreview-${review.id}`,
    pull_request_url: `${api(world)}/repos/${repository.fullName}/pulls/${issue.number}`,
  };
}

export function runJson(world: World, run: Run): Record<string, unknown> {
  const url = `${api(world)}/repos/${run.repository.fullName}/actions/runs/${run.id}`;
  return {
    id: run.id,
    node_id: run.nodeId,
    name: run.name,
    display_title: run.name,
    path: run.workflowPath,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    head_branch: run.headBranch,
    head_sha: run.headSha,
    run_number: run.runNumber,
    run_attempt: run.runAttempt,
    workflow_id: run.repository.workflowIds.get(run.workflowPath) ?? 0,
    actor: accountJson(world, run.actor),
    triggering_actor: accountJson(world, run.actor),
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    run_started_at: run.createdAt,
    url,
    html_url: `${world.serverUrl}/${run.repository.fullName}/actions/runs/${run.id}`,
    jobs_url: `${url}/jobs`,
    logs_url: `${url}/logs`,
    artifacts_url: `${url}/artifacts`,
    repository: repositoryJson(world, run.repository),
  };
}

export function jobJson(world: World, run: Run, job: Job): Record<string, unknown> {
  return {
    id: job.id,
    run_id: run.id,
    run_attempt: run.runAttempt,
    node_id: nodeId("CheckRun", job.id),
    head_sha: run.headSha,
    head_branch: run.headBranch,
    workflow_name: run.name,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    started_at: job.startedAt,
    completed_at: job.completedAt,
    steps: [],
    labels: ["ubuntu-latest"],
    url: `${api(world)}/repos/${run.repository.fullName}/actions/jobs/${job.id}`,
    html_url: `${world.serverUrl}/${run.repository.fullName}/actions/runs/${run.id}/job/${job.id}`,
  };
}

export function artifactJson(world: World, artifact: Artifact): Record<string, unknown> {
  const url = `${api(world)}/repos/${artifact.run.repository.fullName}/actions/artifacts/${artifact.id}`;
  return {
    id: artifact.id,
    node_id: artifact.nodeId,
    name: artifact.name,
    size_in_bytes: artifact.size,
    digest: artifact.digest,
    expired: Date.parse(artifact.expiresAt) <= world.now(),
    created_at: artifact.createdAt,
    updated_at: artifact.createdAt,
    expires_at: artifact.expiresAt,
    url,
    archive_download_url: `${url}/zip`,
    workflow_run: {
      id: artifact.run.id,
      repository_id: artifact.run.repository.id,
      head_repository_id: artifact.run.repository.id,
      head_branch: artifact.run.headBranch,
      head_sha: artifact.run.headSha,
    },
  };
}

/** A token's permissions as `name=level`, sorted, so a scenario can match them exactly. */
export function scopesOf(permissions: Permissions): string[] {
  return Object.entries(permissions)
    .map(([name, level]) => `${name}=${level}`)
    .sort();
}

/**
 * A token as the fake's `tokens` list and each logged request give it: who it is for, the job that
 * asked for it, and its permissions; never its value.
 */
export function tokenJson(world: World, token: Token): Record<string, unknown> {
  return {
    kind: token.kind,
    actor: token.actor.login,
    owner: token.owner,
    repositories: token.repositories === "all" ? "all" : [...token.repositories].sort(),
    scopes: scopesOf(token.permissions),
    job: token.job ?? null,
    run: token.runId ?? null,
    revoked: token.revoked,
    expiresAt: world.iso(token.expiresAt),
  };
}

/** The caller of a request, as its entry in the fake's log notes it. */
export function callerJson(world: World, caller: Caller): Record<string, unknown> {
  if (caller.kind === "token") {
    const { kind, scopes, job, run } = tokenJson(world, caller.token);
    return { kind, scopes, job, run };
  }
  if (caller.kind === "app") return { kind: "app", app: caller.app.slug };
  return { kind: "anonymous" };
}
