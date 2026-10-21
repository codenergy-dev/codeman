import { createPublicKey } from "node:crypto";
import { mkdirSync } from "node:fs";
import { run as git } from "../../fakes/github/git.ts";
import type { GitHubFake } from "../../fakes/github/github.ts";
import { accountJson, repositoryJson } from "../../fakes/github/world.ts";
import { readZip, writeZip } from "../../fakes/github/zip.ts";

/**
 * What the simulator needs of GitHub, as small interfaces: runs and jobs to record, tokens to
 * give, the emulated actions' services (checkout, App tokens, artifacts), workflow files and
 * dispatches. `fakeGitHub` implements them on the e2e suite's fake, in process, so the fake's
 * records (runs, jobs, artifacts, tokens) are those the jobs' own requests see.
 */

export interface RepositoryInfo {
  fullName: string;
  id: number;
  owner: string;
  ownerId: number;
  defaultBranch: string;
  /** The `repository` and `organization` of an event's payload. */
  payload: Record<string, unknown>;
}

export interface CheckoutRequest {
  repository: string;
  /** A branch, tag, `refs/...` or SHA; the default branch when empty. */
  ref: string;
  token: string;
  /** The host directory to fill; it exists and is empty. */
  path: string;
  fetchDepth: number;
}

export interface AppTokenRequest {
  /** The App's client ID, or its numeric ID. */
  clientId: string;
  privateKey: string;
  owner: string;
  /** Names without the owner; empty is every repository of the installation. */
  repositories: string[];
  /** By GitHub's names (`pull_requests`); empty is the installation's. */
  permissions: Record<string, string>;
}

export interface Dispatched {
  repository: string;
  /** The workflow's path, such as `.github/workflows/codeman.yml`. */
  workflow: string;
  ref: string;
  inputs: Record<string, string>;
  sender: string;
  /** The queued run the dispatch made. */
  runId: number;
  headSha: string;
}

export interface RunRecord {
  id: number;
  runNumber: number;
  runAttempt: number;
}

export interface JobRecord {
  id: number;
  runtimeToken: string;
  backendId: string;
}

export interface AppToken {
  token: string;
  installationId: number;
  appSlug: string;
}

export interface UploadedArtifact {
  id: number;
  digest: string;
  url: string;
}

/**
 * Calls that reach the fake may answer with a promise, as a port over its HTTP control API does;
 * the in-process port answers at once.
 */
export interface GitHubPort {
  /** The origins as the jobs reach them. */
  readonly urls: { server: string; api: string; graphql: string; results: string };
  repository(fullName: string): RepositoryInfo;
  /** A commit's SHA, from a branch, tag, `refs/...` or SHA. */
  resolve(repository: string, ref: string): Promise<string | undefined>;
  readFile(repository: string, sha: string, path: string): Promise<string | undefined>;
  /** The files under `.github/workflows/` at `sha`. */
  workflowFiles(repository: string, sha: string): Promise<string[]>;
  startRun(options: {
    repository: string;
    workflow: string;
    name: string;
    event: string;
    headBranch: string;
    headSha: string;
    actor?: string;
    inputs?: Record<string, string>;
  }): RunRecord | Promise<RunRecord>;
  /** The run a dispatch made, which the simulator runs. */
  existingRun(id: number): RunRecord | Promise<RunRecord>;
  updateRun(
    id: number,
    changes: {
      status?: "queued" | "pending" | "in_progress" | "completed";
      conclusion?: string;
      concurrency?: string;
    },
  ): void;
  startJob(runId: number, name: string): JobRecord | Promise<JobRecord>;
  finishJob(jobId: number, conclusion: string, log: string): void;
  /** A `GITHUB_TOKEN`, with GitHub's names (`pull_requests`). */
  jobToken(
    repository: string,
    permissions: Record<string, "read" | "write">,
    runId: number,
  ): string | Promise<string>;
  revokeToken(token: string): void;
  appToken(request: AppTokenRequest): AppToken | Promise<AppToken>;
  checkout(request: CheckoutRequest): Promise<{ sha: string }>;
  uploadArtifact(
    runId: number,
    jobBackendId: string,
    name: string,
    files: Record<string, Buffer>,
    options: { retentionDays?: number; overwrite: boolean },
  ): UploadedArtifact | Promise<UploadedArtifact>;
  /** The run's artifacts by name, each as its files. */
  artifacts(
    runId: number,
  ): Map<string, Map<string, Buffer>> | Promise<Map<string, Map<string, Buffer>>>;
  onDispatch(listener: (dispatch: Dispatched) => void): () => void;
}

/** A failure an emulated action reports, which fails its step. */
export class ActionFailure extends Error {}

/** The fake GitHub, in process; `urls` are its origins as the jobs reach them. */
export function fakeGitHub(
  fake: GitHubFake,
  urls: { server: string; api?: string; graphql?: string; results?: string },
): GitHubPort {
  const world = fake.world;
  const server = urls.server.replace(/\/$/, "");
  const port: GitHubPort = {
    urls: {
      server,
      api: urls.api ?? `${server}/api/v3`,
      graphql: urls.graphql ?? `${server}/api/graphql`,
      results: urls.results ?? `${server}/`,
    },
    repository(fullName) {
      const repository = world.repository(fullName);
      const organization = world.organizations.get(repository.owner.login.toLowerCase());
      return {
        fullName: repository.fullName,
        id: repository.id,
        owner: repository.owner.login,
        ownerId: repository.owner.id,
        defaultBranch: repository.defaultBranch,
        payload: {
          repository: repositoryJson(world, repository),
          ...(organization ? { organization: accountJson(world, organization.account) } : {}),
        },
      };
    },
    async resolve(fullName, ref) {
      const repository = world.repository(fullName);
      if (/^[0-9a-f]{40}$/.test(ref)) return ref;
      const candidates = ref.startsWith("refs/")
        ? [ref]
        : [`refs/heads/${ref}`, `refs/tags/${ref}`, ref];
      for (const candidate of candidates) {
        const sha = await repository.git.resolve(candidate);
        if (sha) return sha;
      }
      return undefined;
    },
    async readFile(fullName, sha, path) {
      const repository = world.repository(fullName);
      const entry = await repository.git.entry(sha, path);
      if (entry?.type !== "blob") return undefined;
      return (await repository.git.readBlob(entry.sha)).toString("utf8");
    },
    async workflowFiles(fullName, sha) {
      const repository = world.repository(fullName);
      const tree = await repository.git.resolveTree(sha);
      if (!tree) return [];
      return (await repository.git.listTree(tree, true))
        .filter(
          (entry) =>
            entry.type === "blob" && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(entry.path),
        )
        .map((entry) => entry.path);
    },
    startRun(options) {
      const run = fake.startRun({ ...options, status: "queued" });
      return { id: run.id, runNumber: run.runNumber, runAttempt: run.runAttempt };
    },
    existingRun(id) {
      const run = world.run(id);
      return { id: run.id, runNumber: run.runNumber, runAttempt: run.runAttempt };
    },
    updateRun(id, changes) {
      fake.updateRun(id, changes);
    },
    startJob(runId, name) {
      const { job, runtimeToken } = fake.startJob(runId, name);
      return { id: job.id, runtimeToken, backendId: job.backendId };
    },
    finishJob(jobId, conclusion, log) {
      fake.finishJob(jobId, { conclusion, log });
    },
    jobToken(repository, permissions, runId) {
      return fake.jobToken(repository, permissions, runId).value;
    },
    revokeToken(token) {
      const found = world.tokens.get(token);
      if (found) found.revoked = true;
    },
    appToken(request) {
      const app = [...world.apps.values()].find(
        (candidate) =>
          candidate.clientId === request.clientId || String(candidate.id) === request.clientId,
      );
      if (!app)
        throw new ActionFailure(`No App with the client ID ${request.clientId || "(empty)"}.`);
      let matches = false;
      try {
        const given = createPublicKey(request.privateKey).export({ type: "spki", format: "pem" });
        matches = given === app.publicKey.export({ type: "spki", format: "pem" });
      } catch {
        matches = false;
      }
      if (!matches) {
        throw new ActionFailure("The private key does not sign for the App: GitHub answers 401.");
      }
      const installation = world.installationFor(app, request.owner, request.repositories[0]);
      if (
        !installation ||
        !request.repositories.every((name) => world.installationFor(app, request.owner, name))
      ) {
        throw new ActionFailure(
          `The App ${app.slug} is not installed on ${request.owner}${request.repositories.length ? ` for ${request.repositories.join(", ")}` : ""}.`,
        );
      }
      try {
        const token = world.installationToken(installation, {
          repositories: request.repositories,
          permissions: request.permissions as Record<string, "read" | "write">,
        });
        return { token: token.value, installationId: installation.id, appSlug: app.slug };
      } catch (error) {
        throw new ActionFailure((error as Error).message);
      }
    },
    async checkout(request) {
      const repository = world.repository(request.repository);
      try {
        const caller = world.identify(
          request.token ? `Bearer ${request.token}` : undefined,
          "GET",
          `/repos/${repository.fullName}`,
        );
        world.authorize(caller, repository, { permission: "contents", level: "read" });
      } catch (error) {
        throw new ActionFailure(
          `actions/checkout cannot read ${repository.fullName} with its token: ${(error as Error).message}`,
        );
      }
      const ref = request.ref || repository.defaultBranch;
      const sha = await port.resolve(repository.fullName, ref);
      if (!sha)
        throw new ActionFailure(`A branch or tag with the name '${ref}' could not be found`);
      mkdirSync(request.path, { recursive: true });
      await git(["clone", "--quiet", "--no-checkout", repository.git.path, request.path]);
      await git([
        "-C",
        request.path,
        "remote",
        "set-url",
        "origin",
        `${server}/${repository.fullName}`,
      ]);
      await git(["-C", request.path, "checkout", "--quiet", "--detach", sha]);
      return { sha };
    },
    uploadArtifact(runId, jobBackendId, name, files, options) {
      const run = world.run(runId);
      const existing = world.runArtifacts(run).find((artifact) => artifact.name === name);
      if (existing) {
        if (!options.overwrite) {
          throw new ActionFailure(
            `Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run`,
          );
        }
        world.artifacts.delete(existing.id);
      }
      const artifact = world.newArtifact(run, name, jobBackendId, options.retentionDays ?? 90);
      world.finalize(
        artifact,
        writeZip(Object.entries(files).map(([path, data]) => ({ path, data }))),
      );
      return {
        id: artifact.id,
        digest: artifact.digest.replace(/^sha256:/, ""),
        url: `${server}/${run.repository.fullName}/actions/runs/${run.id}/artifacts/${artifact.id}`,
      };
    },
    artifacts(runId) {
      const run = world.run(runId);
      return new Map(
        world
          .runArtifacts(run)
          .map((artifact) => [
            artifact.name,
            new Map(readZip(artifact.data).map((entry) => [entry.path, entry.data])),
          ]),
      );
    },
    onDispatch(listener) {
      return fake.onDispatch((dispatch, run) =>
        listener({
          repository: dispatch.repository,
          workflow: dispatch.workflow,
          ref: dispatch.ref,
          inputs: dispatch.inputs,
          sender: dispatch.sender,
          runId: run.id,
          headSha: run.headSha,
        }),
      );
    },
  };
  return port;
}
