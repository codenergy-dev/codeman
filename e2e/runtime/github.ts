import { execFile } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import type { Permissions } from "../fakes/github/auth.ts";
import type { Act, ActResult } from "../fakes/github/github.ts";
import type { GitHubEvent, Role, Violation } from "../fakes/github/world.ts";
import { type FakeClient, FakeHttpError } from "./fakes.ts";
import {
  ActionFailure,
  type AppToken,
  type AppTokenRequest,
  type CheckoutRequest,
  type Dispatched,
  type GitHubPort,
  type JobRecord,
  type RepositoryInfo,
  type RunRecord,
  type UploadedArtifact,
} from "./simulator/github.ts";

const execFileAsync = promisify(execFile);

/**
 * The fake GitHub as the e2e runtime drives it over HTTP: the scenario's users, organizations,
 * repositories and App through the control API (`/_fake/github/`), and the simulator's
 * `GitHubPort`. What a job would ask GitHub itself (an App token, a file, a ref) goes through the
 * fake's REST API with a token the fake gave, as the real action or runner would; checkouts clone
 * over HTTPS. Every token it uses is one the fake issued, so it causes no violation.
 */

/** A dispatch the fake recorded, as its control API lists it. */
export interface DispatchRecord {
  id: number;
  repository: string;
  workflow: string;
  ref: string;
  inputs: Record<string, string>;
  sender: string;
  runId: number;
  at: string;
}

/** An issue as the control API lists it, with its comments and, for a pull request, its sides. */
export interface IssueRecord {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: { name: string }[];
  user: { login: string };
  draft?: boolean;
  pull_request?: unknown;
  head?: string;
  base?: string;
  comment_list: { id: number; body: string; user: { login: string; type: string } }[];
  reviews?: unknown[];
}

interface Cached {
  info: RepositoryInfo;
  private: boolean;
}

const TOKEN_LIFE_MS = 40 * 60 * 1000;

export class RemoteGitHub implements GitHubPort {
  readonly client: FakeClient;
  readonly urls: GitHubPort["urls"];
  /** The fake's origin from the host, for git. */
  readonly #origin: string;
  readonly #caFile: string | undefined;
  readonly #repositories = new Map<string, Cached>();
  readonly #runs = new Map<number, RunRecord & { repository: string; headSha: string }>();
  readonly #tokens = new Map<string, { value: string; at: number }>();
  /** The calls that answer nothing, in order: a later call waits for them. */
  #queue: Promise<unknown> = Promise.resolve();
  #failures: Error[] = [];

  /**
   * `client` reaches the fake from the host; `server` is its origin as the jobs see it, such as
   * `https://github-e2e.localhost`; `caFile` is the session's CA, for git from the host.
   */
  constructor(client: FakeClient, options: { server: string; caFile?: string }) {
    this.client = client;
    this.#origin = client.origin;
    this.#caFile = options.caFile;
    const server = options.server.replace(/\/$/, "");
    this.urls = {
      server,
      api: `${server}/api/v3`,
      graphql: `${server}/api/graphql`,
      results: `${server}/`,
    };
  }

  /** Forgets what it cached of the previous scenario's world. */
  forget(): void {
    this.#repositories.clear();
    this.#runs.clear();
    this.#tokens.clear();
    this.#failures = [];
  }

  /** Waits for the calls that answer nothing; throws the first that failed. */
  async flush(): Promise<void> {
    await this.#queue;
    const [failure] = this.#failures;
    if (failure) {
      this.#failures = [];
      throw failure;
    }
  }

  // The scenario API

  async addUser(login: string): Promise<{ id: number; login: string }> {
    return this.client.json("POST", "/github/users", { login });
  }

  async addOrganization(options: {
    login: string;
    owners: string[];
    members: string[];
  }): Promise<{ id: number; login: string }> {
    return this.client.json("POST", "/github/orgs", options);
  }

  async addRepository(options: {
    owner: string;
    name: string;
    private: boolean;
    drafts: boolean;
    files: Record<string, string>;
    submodules?: Record<string, string>;
    collaborators: Record<string, Role>;
  }): Promise<RepositoryInfo> {
    const json = await this.client.json<Record<string, unknown>>("POST", "/github/repos", options);
    const owner = json.owner as { login: string; id: number; type: string };
    // An event's `organization` is the owner's account, as the repository's `owner` holds it.
    const organization = owner.type === "Organization" ? json.owner : undefined;
    const info: RepositoryInfo = {
      fullName: String(json.full_name),
      id: Number(json.id),
      owner: owner.login,
      ownerId: owner.id,
      defaultBranch: String(json.default_branch),
      payload: { repository: json, ...(organization ? { organization } : {}) },
    };
    this.#repositories.set(info.fullName.toLowerCase(), { info, private: options.private });
    return info;
  }

  /** An App, with the private key that signs its JWTs. */
  async registerApp(slug: string): Promise<{ id: number; clientId: string; privateKey: string }> {
    return this.client.json("POST", "/github/apps", { slug });
  }

  async install(options: {
    app: string;
    owner: string;
    repositories: string[] | "all";
    permissions: Permissions;
  }): Promise<{ id: number }> {
    return this.client.json("POST", "/github/installations", options);
  }

  /** A user acts; the events it caused. */
  async act(act: Act): Promise<ActResult> {
    return this.client.json("POST", "/github/act", act);
  }

  async issues(repository: string): Promise<IssueRecord[]> {
    return this.client.json("GET", `/github/repos/${repository}/issues`);
  }

  /** The events after the ID `after`; with `waitMs`, waits that long for a first one. */
  async events(after = 0, repository?: string, waitMs = 0): Promise<GitHubEvent[]> {
    const query = new URLSearchParams({ after: String(after), wait: String(waitMs) });
    if (repository) query.set("repository", repository);
    return this.client.json("GET", `/github/events?${query}`);
  }

  async dispatches(after = 0, waitMs = 0): Promise<DispatchRecord[]> {
    return this.client.json("GET", `/github/dispatches?after=${after}&wait=${waitMs}`);
  }

  async violations(): Promise<Violation[]> {
    return this.client.json("GET", "/github/violations");
  }

  /** A REST call with a token the fake gave for `repository`. */
  async rest(
    repository: string,
    method: string,
    path: string,
    options: { body?: unknown; ok?: (status: number) => boolean } = {},
  ): Promise<{ status: number; json: unknown }> {
    const token = await this.#ownToken(repository);
    return this.client.request(method, `/api/v3${path}`, {
      ...options,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  /**
   * A token of the runtime's own for reading `repository`: a `GITHUB_TOKEN` with read access
   * only, which the fake issued.
   */
  async #ownToken(repository: string): Promise<string> {
    const key = repository.toLowerCase();
    const known = this.#tokens.get(key);
    if (known && Date.now() - known.at < TOKEN_LIFE_MS) return known.value;
    const { token } = await this.client.json<{ token: string }>("POST", "/github/tokens", {
      repository,
      permissions: { contents: "read", actions: "read", issues: "read", pull_requests: "read" },
      // So a scenario tells the runtime's own reads from the jobs' tokens.
      job: "e2e/runtime",
    });
    this.#tokens.set(key, { value: token, at: Date.now() });
    return token;
  }

  // GitHubPort

  repository(fullName: string): RepositoryInfo {
    const cached = this.#repositories.get(fullName.toLowerCase());
    if (!cached) throw new Error(`The runtime made no repository ${fullName}.`);
    return cached.info;
  }

  async resolve(repository: string, ref: string): Promise<string | undefined> {
    if (/^[0-9a-f]{40}$/.test(ref)) return ref;
    const name = ref.replace(/^refs\/(heads|tags)\//, "");
    const answer = await this.rest(repository, "GET", `/repos/${repository}/commits/${name}`, {
      ok: (status) => status === 200 || status === 404 || status === 422,
    });
    return answer.status === 200 ? String((answer.json as { sha: string }).sha) : undefined;
  }

  async readFile(repository: string, sha: string, path: string): Promise<string | undefined> {
    const answer = await this.rest(
      repository,
      "GET",
      `/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
      { ok: (status) => status === 200 || status === 404 },
    );
    const file = answer.json as { type?: string; content?: string } | undefined;
    if (answer.status !== 200 || file?.type !== "file" || file.content === undefined) {
      return undefined;
    }
    return Buffer.from(file.content, "base64").toString("utf8");
  }

  async workflowFiles(repository: string, sha: string): Promise<string[]> {
    const answer = await this.rest(
      repository,
      "GET",
      `/repos/${repository}/contents/.github/workflows?ref=${sha}`,
      { ok: (status) => status === 200 || status === 404 },
    );
    if (answer.status !== 200 || !Array.isArray(answer.json)) return [];
    return (answer.json as { type: string; path: string }[])
      .filter((entry) => entry.type === "file" && /\.ya?ml$/.test(entry.path))
      .map((entry) => entry.path);
  }

  async startRun(options: Parameters<GitHubPort["startRun"]>[0]): Promise<RunRecord> {
    await this.#queue;
    const run = await this.client.json<Record<string, unknown>>("POST", "/github/runs", {
      ...options,
      status: "queued",
    });
    return this.#remember(run, options.repository);
  }

  async existingRun(id: number): Promise<RunRecord> {
    const known = this.#runs.get(id);
    if (!known) throw new Error(`The runtime has not seen run ${id}: read its dispatch first.`);
    return { id: known.id, runNumber: known.runNumber, runAttempt: known.runAttempt };
  }

  /** The run's record, which the simulator's `existingRun` then answers from. */
  async fetchRun(repository: string, id: number): Promise<RunRecord & { headSha: string }> {
    const run = (await this.rest(repository, "GET", `/repos/${repository}/actions/runs/${id}`))
      .json as Record<string, unknown>;
    const record = this.#remember(run, repository);
    return { ...record, headSha: String(run.head_sha) };
  }

  #remember(run: Record<string, unknown>, repository: string): RunRecord {
    const record = {
      id: Number(run.id),
      runNumber: Number(run.run_number),
      runAttempt: Number(run.run_attempt),
      repository,
      headSha: String(run.head_sha ?? ""),
    };
    this.#runs.set(record.id, record);
    return { id: record.id, runNumber: record.runNumber, runAttempt: record.runAttempt };
  }

  updateRun(id: number, changes: Parameters<GitHubPort["updateRun"]>[1]): void {
    this.#later(() => this.client.control("PATCH", `/github/runs/${id}`, { body: changes }));
  }

  async startJob(runId: number, name: string): Promise<JobRecord> {
    await this.#queue;
    return this.client.json("POST", `/github/runs/${runId}/jobs`, { name });
  }

  finishJob(jobId: number, conclusion: string, log: string): void {
    this.#later(() =>
      this.client.control("PATCH", `/github/jobs/${jobId}`, { body: { conclusion, log } }),
    );
  }

  async jobToken(
    repository: string,
    permissions: Record<string, "read" | "write">,
    runId: number,
    job?: string,
  ): Promise<string> {
    const { token } = await this.client.json<{ token: string }>("POST", "/github/tokens", {
      repository,
      permissions,
      runId,
      ...(job ? { job } : {}),
    });
    return token;
  }

  revokeToken(token: string): void {
    this.#later(() =>
      this.client.request("DELETE", "/api/v3/installation/token", {
        headers: { authorization: `Bearer ${token}` },
        ok: (status) => status === 204 || status === 401,
      }),
    );
  }

  /** As actions/create-github-app-token does: the App's JWT, its installation, then a token. */
  async appToken(request: AppTokenRequest): Promise<AppToken> {
    let jwt: string;
    try {
      jwt = appJwt(request.clientId, request.privateKey);
    } catch (error) {
      throw new ActionFailure(`The private key is not a PEM key: ${(error as Error).message}`);
    }
    const headers = { authorization: `Bearer ${jwt}` };
    const first = request.repositories[0];
    const lookup = first
      ? `/api/v3/repos/${request.owner}/${first}/installation`
      : `/api/v3/orgs/${request.owner}/installation`;
    const any = () => true;
    let found = await this.client.request("GET", lookup, { headers, ok: any });
    if (!first && found.status === 404) {
      found = await this.client.request("GET", `/api/v3/users/${request.owner}/installation`, {
        headers,
        ok: any,
      });
    }
    if (found.status !== 200) {
      throw new ActionFailure(
        `Failed to create token for "${request.owner}" (attempt 1): ${failureText(found.json, found.status)}`,
      );
    }
    const installation = found.json as { id: number; app_slug: string };
    const created = await this.client.request(
      "POST",
      `/api/v3/app/installations/${installation.id}/access_tokens`,
      {
        headers,
        ok: any,
        body: {
          ...(request.repositories.length > 0 ? { repositories: request.repositories } : {}),
          ...(Object.keys(request.permissions).length > 0
            ? { permissions: request.permissions }
            : {}),
        },
      },
    );
    if (created.status !== 201) {
      throw new ActionFailure(
        `Failed to create token for "${request.owner}": ${failureText(created.json, created.status)}`,
      );
    }
    const token = String((created.json as { token: string }).token);
    // The fake records which template job asked for it, for the scenarios' token checks.
    if (request.job) {
      await this.client.control("PATCH", "/github/tokens", { body: { token, job: request.job } });
    }
    return {
      token,
      installationId: installation.id,
      appSlug: installation.app_slug,
    };
  }

  /** A clone over HTTPS with the token, as actions/checkout fetches; then the jobs' remote. */
  async checkout(request: CheckoutRequest): Promise<{ sha: string }> {
    const sha = await this.resolve(
      request.repository,
      request.ref || this.repository(request.repository).defaultBranch,
    );
    if (!sha) {
      throw new ActionFailure(`A branch or tag with the name '${request.ref}' could not be found`);
    }
    mkdirSync(request.path, { recursive: true });
    const basic = Buffer.from(`x-access-token:${request.token}`).toString("base64");
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      ...(this.#caFile ? { GIT_SSL_CAINFO: this.#caFile } : {}),
    };
    const git = (args: string[]) => execFileAsync("git", args, { env, maxBuffer: 64 << 20 });
    try {
      await git([
        "-c",
        `http.extraHeader=Authorization: basic ${basic}`,
        "clone",
        "--quiet",
        "--no-checkout",
        `${this.#origin}/${request.repository}`,
        request.path,
      ]);
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
      throw new ActionFailure(`actions/checkout could not fetch ${request.repository}: ${stderr}`);
    }
    await git([
      "-C",
      request.path,
      "remote",
      "set-url",
      "origin",
      `${this.urls.server}/${request.repository}`,
    ]);
    await git(["-C", request.path, "checkout", "--quiet", "--detach", sha]);
    return { sha };
  }

  async uploadArtifact(
    runId: number,
    _jobBackendId: string,
    name: string,
    files: Record<string, Buffer>,
    options: { retentionDays?: number; overwrite: boolean },
  ): Promise<UploadedArtifact> {
    if (options.overwrite) {
      throw new ActionFailure("The runtime does not overwrite artifacts; no template asks it to.");
    }
    try {
      const artifact = await this.client.json<{ id: number; digest: string }>(
        "POST",
        `/github/runs/${runId}/artifacts`,
        {
          name,
          files: Object.fromEntries(
            Object.entries(files).map(([path, data]) => [path, data.toString("base64")]),
          ),
        },
      );
      const repository = this.#runs.get(runId)?.repository ?? "";
      return {
        id: artifact.id,
        digest: String(artifact.digest).replace(/^sha256:/, ""),
        url: `${this.urls.server}/${repository}/actions/runs/${runId}/artifacts/${artifact.id}`,
      };
    } catch (error) {
      if (error instanceof FakeHttpError && error.status === 409) {
        throw new ActionFailure(
          "Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run",
        );
      }
      throw error;
    }
  }

  async artifacts(runId: number): Promise<Map<string, Map<string, Buffer>>> {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`The runtime has not seen run ${runId}.`);
    const listed = (
      await this.rest(
        run.repository,
        "GET",
        `/repos/${run.repository}/actions/runs/${runId}/artifacts?per_page=100`,
      )
    ).json as { artifacts: { id: number; name: string }[] };
    const result = new Map<string, Map<string, Buffer>>();
    for (const artifact of listed.artifacts) {
      const files = await this.client.json<Record<string, string>>(
        "GET",
        `/github/artifacts/${artifact.id}/files`,
      );
      result.set(
        artifact.name,
        new Map(Object.entries(files).map(([path, data]) => [path, Buffer.from(data, "base64")])),
      );
    }
    return result;
  }

  /** Polls the fake's dispatches and hands each one, with its run, to `listener`. */
  onDispatch(listener: (dispatch: Dispatched) => void): () => void {
    let stopped = false;
    let after = 0;
    const loop = async () => {
      const seen = await this.dispatches(0);
      after = Math.max(0, ...seen.map((dispatch) => dispatch.id));
      while (!stopped) {
        let fresh: DispatchRecord[];
        try {
          fresh = await this.dispatches(after, 5000);
        } catch {
          if (stopped) return;
          continue;
        }
        for (const dispatch of fresh) {
          after = Math.max(after, dispatch.id);
          if (!stopped) listener(await this.dispatched(dispatch));
        }
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }

  /** A dispatch as the simulator takes it, with its run's record fetched. */
  async dispatched(dispatch: DispatchRecord): Promise<Dispatched> {
    const run = await this.fetchRun(dispatch.repository, dispatch.runId);
    return {
      repository: dispatch.repository,
      workflow: dispatch.workflow,
      ref: dispatch.ref,
      inputs: dispatch.inputs,
      sender: dispatch.sender,
      runId: dispatch.runId,
      headSha: run.headSha,
    };
  }

  /** Runs `call` after the calls before it; a failure surfaces at the next `flush`. */
  #later(call: () => Promise<unknown>): void {
    this.#queue = this.#queue.then(call).catch((error: unknown) => {
      this.#failures.push(error instanceof Error ? error : new Error(String(error)));
    });
  }
}

/** The App's JWT, RS256, as GitHub takes it: `iss` the client ID, ten minutes at most. */
export function appJwt(clientId: string, privateKey: string, now = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: clientId })}`;
  const signature = sign("sha256", Buffer.from(body), createPrivateKey(privateKey));
  return `${body}.${signature.toString("base64url")}`;
}

function failureText(json: unknown, status: number): string {
  const message = (json as { message?: unknown } | undefined)?.message;
  return `${typeof message === "string" ? message : "HTTP error"} (${status})`;
}
