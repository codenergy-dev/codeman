import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeRequest, FakeServer, HttpError, json, type ListenOptions } from "../http.ts";
import { registerArtifacts } from "./artifacts.ts";
import { GitHubError, type Permissions } from "./auth.ts";
import { registerGraphql } from "./graphql.ts";
import { Api, answer, registerRest } from "./rest.ts";
import { registerSmartHttp } from "./smarthttp.ts";
import {
  type Artifact,
  artifactJson,
  commentJson,
  type Dispatch,
  type GitHubEvent,
  type Installation,
  issueJson,
  type Job,
  type Repository,
  type ReviewState,
  ROLES,
  type Role,
  type Run,
  type RunStatus,
  repositoryJson,
  reviewJson,
  runJson,
  type Token,
  World,
} from "./world.ts";
import { readZip } from "./zip.ts";

/**
 * A fake GitHub for the e2e suite: the REST subset and GraphQL operations Codeman, `gh` and the
 * pinned actions use, under `/api/v3` and `/api/graphql` as on GitHub Enterprise Server; git over
 * HTTP(S) on bare repositories; the artifact service of `upload-artifact` and
 * `download-artifact`; App installation tokens and `GITHUB_TOKEN`s whose permissions it enforces;
 * and users who act as collaborators of a role.
 *
 * The e2e runtime drives it in process through `GitHubFake`, or over HTTP through the control
 * API under `/_fake/github/`. What the runtime reads back: the events users and tokens cause,
 * with the payload a job gets at `GITHUB_EVENT_PATH`; the `workflow_dispatch`es it should run;
 * and the violations, such as a token the fake did not give, a scenario asserts there are none of.
 */

export type ActAction =
  | { action: "open-issue"; title: string; body?: string; labels?: string[] }
  | { action: "comment"; issue: number; body: string }
  | { action: "label" | "unlabel"; issue: number; label: string }
  | { action: "close" | "reopen"; issue: number }
  | {
      action: "review";
      pull: number;
      state: "approve" | "request-changes" | "comment";
      body?: string;
      comments?: { path: string; line?: number; body: string }[];
    }
  | {
      action: "push";
      branch: string;
      files: Record<string, string | null>;
      message?: string;
      base?: string;
      force?: boolean;
    };

/** A user's action, as the scenario's `as:` names the user. */
export type Act = ActAction & { as: string; repository: string };

export interface ActResult {
  /** The issue's number, the review's ID or the commit's SHA. */
  result: number | string;
  events: GitHubEvent[];
}

const REVIEW_STATES: Record<string, ReviewState> = {
  approve: "APPROVED",
  "request-changes": "CHANGES_REQUESTED",
  comment: "COMMENTED",
};

export class GitHubFake {
  readonly server: FakeServer;
  readonly world: World;

  constructor(options: { root?: string; serverUrl?: string; now?: () => number } = {}) {
    this.world = new World({
      root: options.root ?? mkdtempSync(join(tmpdir(), "codeman-e2e-github-")),
      ...(options.serverUrl ? { serverUrl: options.serverUrl } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    this.server = new FakeServer("github");
    const api = new Api(this.server, this.world);
    registerRest(api);
    registerArtifacts(this.server, api, this.world);
    registerGraphql(this.server, this.world);
    registerSmartHttp(this.server, this.world);
    this.#controls();
    this.server.onReset(() => this.world.clear());
  }

  /** Starts serving; without a `serverUrl`, the URLs in answers use the origin it returns. */
  async listen(options: ListenOptions = {}): Promise<string> {
    const origin = await this.server.listen(options);
    this.world.adopt(origin);
    return origin;
  }

  close(): Promise<void> {
    return this.server.close();
  }

  // The scenario API

  addUser(login: string, type: "User" | "Bot" = "User") {
    return this.world.addUser(login, type);
  }

  addOrganization(options: Parameters<World["addOrganization"]>[0]) {
    return this.world.addOrganization(options);
  }

  addRepository(options: Parameters<World["addRepository"]>[0]): Promise<Repository> {
    return this.world.addRepository(options);
  }

  setCollaborator(repository: string, login: string, role: Role | null): void {
    this.world.setCollaborator(this.world.repository(repository), login, role);
  }

  /** An App; with no public key given, the private key PEM that signs its JWTs is returned too. */
  registerApp(options: Parameters<World["registerApp"]>[0]) {
    return this.world.registerApp(options);
  }

  install(options: Parameters<World["install"]>[0]): Installation {
    return this.world.install(options);
  }

  /** A `GITHUB_TOKEN` for one repository, with a job's `permissions` (and `metadata: read`). */
  jobToken(repository: string, permissions: Permissions, runId?: number): Token {
    return this.world.jobToken({ repository, permissions, ...(runId ? { runId } : {}) });
  }

  /** A user acts on a repository, if the user's role allows it; returns the events it caused. */
  async act(act: Act): Promise<ActResult> {
    const world = this.world;
    const repository = world.repository(act.repository);
    const user = world.user(act.as);
    const first = world.events.length;
    const allow = (role: Role, verb: string) => {
      if (!world.allows(repository, user.login, role)) {
        throw new GitHubError(
          403,
          `${user.login} may not ${verb} in ${repository.fullName}: it needs ${role}.`,
        );
      }
    };
    let result: number | string;
    switch (act.action) {
      case "open-issue": {
        allow("read", "open an issue");
        if (act.labels?.length) allow("triage", "label");
        result = world.openIssue(repository, user, act).number;
        break;
      }
      case "comment": {
        allow("read", "comment");
        result = world.comment(repository, world.issue(repository, act.issue), user, act.body).id;
        break;
      }
      case "label":
      case "unlabel": {
        allow("triage", act.action);
        const issue = world.issue(repository, act.issue);
        if (act.action === "label") world.addLabels(repository, issue, [act.label], user);
        else world.removeLabel(repository, issue, act.label, user);
        result = issue.number;
        break;
      }
      case "close":
      case "reopen": {
        const issue = world.issue(repository, act.issue);
        if (issue.user.id !== user.id) allow("triage", act.action);
        const state = act.action === "close" ? "closed" : "open";
        if (issue.pull) await world.editPullRequest(repository, issue, user, { state });
        else world.editIssue(repository, issue, user, { state });
        result = issue.number;
        break;
      }
      case "review": {
        allow("read", "review");
        const state = REVIEW_STATES[act.state];
        if (!state) throw new GitHubError(422, `No review state ${act.state}.`);
        const review = await world.review(repository, world.issue(repository, act.pull), user, {
          state,
          ...(act.body !== undefined ? { body: act.body } : {}),
          ...(act.comments ? { comments: act.comments } : {}),
        });
        result = review.id;
        break;
      }
      case "push": {
        allow("write", "push");
        result = await world.push(repository, user, act);
        break;
      }
      default:
        throw new GitHubError(422, `No action ${(act as { action: string }).action}.`);
    }
    await world.settled();
    return { result, events: world.events.slice(first) };
  }

  startRun(options: Parameters<World["startRun"]>[0]): Run {
    return this.world.startRun(options);
  }

  updateRun(id: number, changes: Parameters<World["updateRun"]>[1]): void {
    this.world.updateRun(this.world.run(id), changes);
  }

  /** A job of a run, with the `ACTIONS_RUNTIME_TOKEN` its artifact actions need. */
  startJob(runId: number, name: string): { job: Job; runtimeToken: string } {
    return this.world.startJob(this.world.run(runId), name);
  }

  finishJob(jobId: number, options: { conclusion: string; log?: string }): void {
    const job = this.world.jobs.get(jobId);
    if (!job) throw new GitHubError(404, "Not Found");
    this.world.finishJob(job, options);
  }

  /** An artifact of a run, zipped from `files`, past the artifact protocol: the simulator's path. */
  uploadArtifact(runId: number, name: string, files: Record<string, string | Buffer>): Artifact {
    return this.world.addArtifact(this.world.run(runId), name, files);
  }

  /** An artifact's files, unzipped. */
  artifactFiles(id: number): Map<string, Buffer> {
    const artifact = this.world.artifacts.get(id);
    if (!artifact?.finalized) throw new GitHubError(404, "Not Found");
    return new Map(readZip(artifact.data).map((entry) => [entry.path, entry.data]));
  }

  get events(): readonly GitHubEvent[] {
    return this.world.events;
  }

  get dispatches(): readonly Dispatch[] {
    return this.world.dispatches;
  }

  get violations() {
    return this.world.violations;
  }

  /** Called with each event, after it is recorded; returns a function that stops it. */
  onEvent(listener: (event: GitHubEvent) => unknown): () => void {
    return this.world.onEvent(listener);
  }

  /** Called with each `workflow_dispatch` and the queued run it made, for the runtime to run it. */
  onDispatch(listener: (dispatch: Dispatch, run: Run) => unknown): () => void {
    return this.world.onDispatch(listener);
  }

  // The control API, under /_fake/github

  #controls(): void {
    const world = this.world;
    const control = (method: string, pattern: string, handler: (request: FakeRequest) => unknown) =>
      this.server.control(method, `/github${pattern}`, (request) =>
        answer(async () => {
          world.adopt(request.origin);
          const result = await handler(request);
          if (result === undefined) return { status: 204 };
          return json(result, method === "POST" ? 201 : 200);
        }),
      );
    const body = (request: FakeRequest) => object(request.json());
    control("POST", "/users", (request) => {
      const value = body(request);
      return world.addUser(string(value, "login"), value.type === "Bot" ? "Bot" : "User");
    });
    control("POST", "/orgs", (request) => {
      const value = body(request);
      const organization = world.addOrganization({
        login: string(value, "login"),
        ...(value.owners !== undefined ? { owners: strings(value, "owners") } : {}),
        ...(value.members !== undefined ? { members: strings(value, "members") } : {}),
        ...(value.basePermission !== undefined
          ? { basePermission: role(value.basePermission, true) }
          : {}),
      });
      return {
        ...organization.account,
        owners: [...organization.owners],
        members: [...organization.members],
      };
    });
    control("POST", "/repos", async (request) => {
      const value = body(request);
      const collaborators: Record<string, Role> = {};
      for (const [login, given] of Object.entries(object(value.collaborators ?? {}))) {
        collaborators[login] = role(given, false) as Role;
      }
      const files =
        value.files === undefined ? undefined : (object(value.files) as Record<string, string>);
      const submodules =
        value.submodules === undefined
          ? undefined
          : (object(value.submodules) as Record<string, string>);
      const repository = await world.addRepository({
        owner: string(value, "owner"),
        name: string(value, "name"),
        ...(typeof value.private === "boolean" ? { private: value.private } : {}),
        ...(typeof value.defaultBranch === "string" ? { defaultBranch: value.defaultBranch } : {}),
        ...(typeof value.fixture === "string" ? { fixture: value.fixture } : {}),
        ...(typeof value.source === "string" ? { source: value.source } : {}),
        ...(files ? { files } : {}),
        ...(submodules ? { submodules } : {}),
        ...(typeof value.drafts === "boolean" ? { drafts: value.drafts } : {}),
        collaborators,
      });
      return repositoryJson(world, repository);
    });
    control("PUT", "/repos/{owner}/{repo}/collaborators/{login}", (request) => {
      const value = body(request);
      const repository = world.repository(`${request.params.owner}/${request.params.repo}`);
      world.setCollaborator(
        repository,
        request.params.login ?? "",
        value.role === null ? null : (role(value.role, false) as Role),
      );
      return undefined;
    });
    control("GET", "/repos/{owner}/{repo}/issues", async (request) => {
      const repository = world.repository(`${request.params.owner}/${request.params.repo}`);
      return [...repository.issues.values()].map((issue) => ({
        ...issueJson(world, repository, issue),
        comment_list: issue.comments.map((comment) =>
          commentJson(world, repository, issue, comment),
        ),
        ...(issue.pull
          ? {
              head: issue.pull.head,
              base: issue.pull.base,
              reviews: issue.pull.reviews.map((review) =>
                reviewJson(world, repository, issue, review),
              ),
            }
          : {}),
      }));
    });
    control("POST", "/apps", (request) => {
      const value = body(request);
      const { app, privateKey } = world.registerApp({
        slug: string(value, "slug"),
        ...(typeof value.name === "string" ? { name: value.name } : {}),
        ...(typeof value.clientId === "string" ? { clientId: value.clientId } : {}),
        ...(typeof value.publicKey === "string" ? { publicKey: value.publicKey } : {}),
      });
      return {
        id: app.id,
        slug: app.slug,
        clientId: app.clientId,
        ...(privateKey ? { privateKey } : {}),
      };
    });
    control("POST", "/installations", (request) => {
      const value = body(request);
      const installation = world.install({
        app: typeof value.app === "number" ? value.app : string(value, "app"),
        owner: string(value, "owner"),
        ...(value.repositories === "all" || value.repositories === undefined
          ? {}
          : { repositories: strings(value, "repositories") }),
        permissions: permissionsOf(value.permissions),
      });
      return { id: installation.id };
    });
    control("POST", "/tokens", (request) => {
      const value = body(request);
      const token = world.jobToken({
        repository: string(value, "repository"),
        permissions: permissionsOf(value.permissions),
        ...(typeof value.runId === "number" ? { runId: value.runId } : {}),
      });
      return {
        token: token.value,
        expiresAt: world.iso(token.expiresAt),
        permissions: token.permissions,
      };
    });
    control("POST", "/act", async (request) => this.act(body(request) as unknown as Act));
    control("POST", "/runs", (request) => {
      const value = body(request);
      const run = world.startRun({
        repository: string(value, "repository"),
        workflow: string(value, "workflow"),
        event: string(value, "event"),
        ...(typeof value.name === "string" ? { name: value.name } : {}),
        ...(typeof value.headBranch === "string" ? { headBranch: value.headBranch } : {}),
        ...(typeof value.headSha === "string" ? { headSha: value.headSha } : {}),
        ...(typeof value.status === "string" ? { status: value.status as RunStatus } : {}),
        ...(typeof value.concurrency === "string" ? { concurrency: value.concurrency } : {}),
        ...(typeof value.actor === "string" ? { actor: value.actor } : {}),
        ...(typeof value.runAttempt === "number" ? { runAttempt: value.runAttempt } : {}),
        ...(value.inputs !== undefined
          ? { inputs: object(value.inputs) as Record<string, string> }
          : {}),
      });
      return { ...runJson(world, run), backend_id: run.backendId };
    });
    control("PATCH", "/runs/{id}", (request) => {
      const value = body(request);
      const run = world.run(Number(request.params.id));
      world.updateRun(run, {
        ...(typeof value.status === "string" ? { status: value.status as RunStatus } : {}),
        ...(value.conclusion !== undefined
          ? { conclusion: value.conclusion as string | null }
          : {}),
        ...(value.concurrency !== undefined
          ? { concurrency: value.concurrency as string | null }
          : {}),
      });
      return runJson(world, run);
    });
    control("POST", "/runs/{id}/jobs", (request) => {
      const { job, runtimeToken } = this.startJob(
        Number(request.params.id),
        string(body(request), "name"),
      );
      return { id: job.id, backendId: job.backendId, runtimeToken };
    });
    control("PATCH", "/jobs/{id}", (request) => {
      const value = body(request);
      this.finishJob(Number(request.params.id), {
        conclusion: string(value, "conclusion"),
        ...(typeof value.log === "string" ? { log: value.log } : {}),
      });
      return undefined;
    });
    control("POST", "/runs/{id}/artifacts", (request) => {
      const value = body(request);
      const files: Record<string, Buffer> = {};
      for (const [path, content] of Object.entries(object(value.files))) {
        files[path] = Buffer.from(String(content), "base64");
      }
      return artifactJson(
        world,
        this.uploadArtifact(Number(request.params.id), string(value, "name"), files),
      );
    });
    control("GET", "/artifacts/{id}/files", (request) =>
      Object.fromEntries(
        [...this.artifactFiles(Number(request.params.id))].map(([path, data]) => [
          path,
          data.toString("base64"),
        ]),
      ),
    );
    // Long polls: `after` the last ID seen, `wait` up to so many milliseconds for a new one.
    const poll = async <T extends { id: number }>(
      request: FakeRequest,
      list: () => readonly T[],
    ) => {
      const after = Number(request.query.get("after") ?? 0);
      const wait = Math.min(Number(request.query.get("wait") ?? 0) || 0, 60_000);
      const deadline = Date.now() + wait;
      const fresh = () => list().filter((item) => item.id > after);
      while (fresh().length === 0 && Date.now() < deadline) await world.wait(deadline - Date.now());
      return fresh();
    };
    control("GET", "/events", (request) => {
      const repository = request.query.get("repository")?.toLowerCase();
      return poll(request, () =>
        world.events.filter(
          (event) => !repository || event.repository.toLowerCase() === repository,
        ),
      );
    });
    control("GET", "/dispatches", (request) => poll(request, () => world.dispatches));
    // The workflow runs, oldest first, as a scenario checks them: a pending run that a newer one
    // replaced in its concurrency group ends cancelled.
    control("GET", "/runs", () =>
      [...world.runs.values()].map((run) => ({
        id: run.id,
        repository: run.repository.fullName,
        workflow: run.workflowPath,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        concurrency: run.concurrency ?? null,
        ...(run.inputs ? { inputs: run.inputs } : {}),
      })),
    );
    control("GET", "/violations", () => world.violations);
  }
}

/** The fake for e2e/fakes/main.ts: `FAKE_GITHUB_ROOT` holds the bare repositories, a new temporary directory by default; `FAKE_GITHUB_SERVER_URL` is the origin in URLs, the first request's by default. */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  return new GitHubFake({
    ...(env.FAKE_GITHUB_ROOT ? { root: env.FAKE_GITHUB_ROOT } : {}),
    ...(env.FAKE_GITHUB_SERVER_URL ? { serverUrl: env.FAKE_GITHUB_SERVER_URL } : {}),
  }).server;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, { message: "Expected a JSON object." });
  }
  return value as Record<string, unknown>;
}

function string(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== "string" || field === "") {
    throw new HttpError(400, { message: `${name} must be a non-empty string.` });
  }
  return field;
}

function strings(value: Record<string, unknown>, name: string): string[] {
  const field = value[name];
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) {
    throw new HttpError(400, { message: `${name} must be a list of strings.` });
  }
  return field;
}

function role(value: unknown, none: boolean): Role | "none" {
  if (
    typeof value === "string" &&
    ((ROLES as readonly string[]).includes(value) || (none && value === "none"))
  ) {
    return value as Role | "none";
  }
  throw new HttpError(400, {
    message: `A role is one of ${ROLES.join(", ")}${none ? ", none" : ""}.`,
  });
}

function permissionsOf(value: unknown): Permissions {
  const permissions = object(value ?? {});
  for (const [name, level] of Object.entries(permissions)) {
    if (level !== "read" && level !== "write" && level !== "admin") {
      throw new HttpError(400, { message: `The permission ${name} must be read, write or admin.` });
    }
  }
  return permissions as Permissions;
}
