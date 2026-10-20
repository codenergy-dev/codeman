import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type FakeRequest, type FakeServer, json, type Reply } from "../http.ts";
import { GitHubError, masked } from "./auth.ts";
import { type Api, pagedObject } from "./rest.ts";
import { type Artifact, artifactJson, type Job, type Run, type World } from "./world.ts";

/**
 * Artifacts as the pinned `upload-artifact` v7.0.1 and `download-artifact` v8.0.1 store and read
 * them, through `@actions/artifact` 6.2: the results service's Twirp API at
 * `ACTIONS_RESULTS_URL`'s origin, authorized by the job's `ACTIONS_RUNTIME_TOKEN`, and a signed
 * blob URL that the client writes as an Azure block blob (Put Block, then Put Block List) and
 * reads with a plain GET (docs/web/github/toolkit-packages-artifact-src-*-at-21229dc.md). Plus
 * the REST endpoints `next-run`'s `gh api` and Codeman's CI results read.
 */

const TWIRP = "/twirp/github.actions.results.api.v1.ArtifactService";
const BLOBS = "/_artifacts/blobs";
/** How long a signed URL lasts. */
const SIGNED_MS = 60 * 60 * 1000;

class TwirpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const TWIRP_STATUS: Record<string, number> = {
  invalid_argument: 400,
  unauthenticated: 401,
  permission_denied: 403,
  not_found: 404,
  already_exists: 409,
  failed_precondition: 412,
};

export function registerArtifacts(server: FakeServer, apiRoutes: Api, world: World): void {
  const methods: Record<
    string,
    (body: Record<string, unknown>, job: { run: Run; job: Job }, request: FakeRequest) => unknown
  > = {
    CreateArtifact: (body, owner, request) => {
      const ids = backendIds(body, owner);
      const name = text(body, "name");
      if (!name) throw new TwirpError("invalid_argument", "name is required");
      const exists = world.runArtifacts(owner.run).some((artifact) => artifact.name === name);
      if (exists) {
        throw new TwirpError(
          "already_exists",
          `an artifact with this name already exists on the workflow run`,
        );
      }
      const expires = text(body, "expires_at", "expiresAt");
      const days = expires
        ? Math.max(1, Math.ceil((Date.parse(expires) - world.now()) / 86_400_000))
        : 90;
      for (const pending of world.artifacts.values()) {
        if (pending.run === owner.run && pending.name === name && !pending.finalized) {
          world.artifacts.delete(pending.id);
        }
      }
      const artifact = world.newArtifact(owner.run, name, ids.job, days);
      return { ok: true, signed_upload_url: signedUrl(world, request.origin, artifact, "w") };
    },
    FinalizeArtifact: (body, owner) => {
      backendIds(body, owner);
      const name = text(body, "name");
      const artifact = [...world.artifacts.values()].find(
        (candidate) =>
          candidate.run === owner.run && candidate.name === name && !candidate.finalized,
      );
      if (!artifact) throw new TwirpError("not_found", `no pending artifact named ${name}`);
      if (artifact.data.length === 0 && artifact.blocks.size === 0) {
        throw new TwirpError("failed_precondition", `the artifact ${name} has no uploaded content`);
      }
      const size = Number(body.size ?? 0);
      if (size !== artifact.data.length) {
        throw new TwirpError(
          "invalid_argument",
          `size ${size} is not the ${artifact.data.length} bytes uploaded`,
        );
      }
      const hash = text(body, "hash");
      const digest = `sha256:${createHash("sha256").update(artifact.data).digest("hex")}`;
      if (hash && hash !== digest) {
        throw new TwirpError(
          "invalid_argument",
          `hash ${hash} is not the uploaded content's ${digest}`,
        );
      }
      world.finalize(artifact, artifact.data);
      return { ok: true, artifact_id: String(artifact.id) };
    },
    ListArtifacts: (body, owner) => {
      const ids = backendIds(body, owner);
      const name = text(body, "name_filter", "nameFilter");
      const id = text(body, "id_filter", "idFilter");
      const artifacts = world
        .runArtifacts(owner.run)
        .filter((artifact) => !name || artifact.name === name)
        .filter((artifact) => !id || String(artifact.id) === id);
      return {
        artifacts: artifacts.map((artifact) => ({
          workflow_run_backend_id: ids.run,
          workflow_job_run_backend_id: artifact.jobBackendId,
          database_id: String(artifact.id),
          name: artifact.name,
          size: String(artifact.size),
          created_at: artifact.createdAt,
          digest: artifact.digest,
        })),
      };
    },
    GetSignedArtifactURL: (body, owner, request) => {
      backendIds(body, owner, true);
      const name = text(body, "name");
      const artifact = world.runArtifacts(owner.run).find((candidate) => candidate.name === name);
      if (!artifact) throw new TwirpError("not_found", `no artifact named ${name}`);
      return { signed_url: signedUrl(world, request.origin, artifact, "r") };
    },
    DeleteArtifact: (body, owner) => {
      backendIds(body, owner);
      const name = text(body, "name");
      const artifact = world.runArtifacts(owner.run).find((candidate) => candidate.name === name);
      if (!artifact) throw new TwirpError("not_found", `no artifact named ${name}`);
      world.artifacts.delete(artifact.id);
      return { ok: true, artifact_id: String(artifact.id) };
    },
  };

  server.route("POST", `${TWIRP}/{method}`, (request) => {
    const method = methods[request.params.method ?? ""];
    try {
      const token = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
      const owner = token ? world.runtimeTokens.get(token) : undefined;
      if (!owner) {
        world.violate({
          kind: token ? "unknown-token" : "missing-token",
          method: "POST",
          path: request.path,
          detail: token ? masked(token) : "no runtime token",
        });
        throw new TwirpError("unauthenticated", "the runtime token is not valid");
      }
      if (!method) throw new TwirpError("bad_route", `no method ${request.params.method}`);
      return json(method(request.json() as Record<string, unknown>, owner, request));
    } catch (error) {
      if (!(error instanceof TwirpError)) throw error;
      return json({ code: error.code, msg: error.message }, TWIRP_STATUS[error.code] ?? 404);
    }
  });

  server.route("PUT", `${BLOBS}/{id}`, (request) => {
    const artifact = signedArtifact(world, request, "w");
    if (!artifact || artifact.finalized) return azureError(403, "AuthenticationFailed");
    const comp = request.query.get("comp");
    const headers = { "x-ms-request-id": crypto.randomUUID(), "x-ms-version": "2025-01-05" };
    if (comp === "block") {
      const block = request.query.get("blockid");
      if (!block) return azureError(400, "InvalidQueryParameterValue");
      artifact.blocks.set(block, request.body);
      return { status: 201, headers: { ...headers, "x-ms-request-server-encrypted": "true" } };
    }
    if (comp === "blocklist") {
      const ids = [
        ...request.body.toString("utf8").matchAll(/<(Latest|Uncommitted|Committed)>([^<]*)<\/\1>/g),
      ].map((match) => match[2] ?? "");
      const parts: Buffer[] = [];
      for (const id of ids) {
        const block = artifact.blocks.get(id);
        if (!block) return azureError(400, "InvalidBlockList");
        parts.push(block);
      }
      artifact.data = Buffer.concat(parts);
      artifact.blocks.clear();
      return {
        status: 201,
        headers: {
          ...headers,
          etag: `"0x${artifact.id.toString(16)}"`,
          "last-modified": new Date(world.now()).toUTCString(),
        },
      };
    }
    if (comp) return azureError(400, "InvalidQueryParameterValue");
    artifact.data = request.body;
    return { status: 201, headers: { ...headers, etag: `"0x${artifact.id.toString(16)}"` } };
  });

  server.route("GET", `${BLOBS}/{id}`, (request) => {
    const artifact = signedArtifact(world, request, "r");
    if (!artifact?.finalized) return azureError(403, "AuthenticationFailed");
    return {
      status: 200,
      body: artifact.data,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename=${encodeURIComponent(artifact.name)}.zip; filename*=UTF-8''${encodeURIComponent(artifact.name)}.zip`,
      },
    };
  });

  // REST

  const listed = (request: FakeRequest, artifacts: Artifact[]): Reply => {
    const name = request.query.get("name");
    const found = artifacts
      .filter((artifact) => !name || artifact.name === name)
      .sort((a, b) => b.id - a.id)
      .map((artifact) => artifactJson(world, artifact));
    return pagedObject(request, "artifacts", found);
  };
  const read = { permission: "actions", level: "read" as const };
  apiRoutes.repo("GET", "/actions/runs/{run}/artifacts", read, ({ request, repository }) => {
    const run = world.runs.get(Number(request.params.run));
    if (!run || run.repository !== repository) throw new GitHubError(404, "Not Found");
    return listed(request, world.runArtifacts(run));
  });
  apiRoutes.repo("GET", "/actions/artifacts", read, ({ request, repository }) =>
    listed(
      request,
      [...world.artifacts.values()].filter(
        (artifact) => artifact.finalized && artifact.run.repository === repository,
      ),
    ),
  );
  const artifactOf = (request: FakeRequest, repository: Run["repository"]): Artifact => {
    const artifact = world.artifacts.get(Number(request.params.id));
    if (!artifact?.finalized || artifact.run.repository !== repository)
      throw new GitHubError(404, "Not Found");
    return artifact;
  };
  apiRoutes.repo("GET", "/actions/artifacts/{id}", read, ({ request, repository }) =>
    json(artifactJson(world, artifactOf(request, repository))),
  );
  apiRoutes.repo("GET", "/actions/artifacts/{id}/{format}", read, ({ request, repository }) => {
    const artifact = artifactOf(request, repository);
    if (request.params.format !== "zip")
      throw new GitHubError(400, "The archive format must be zip.");
    if (Date.parse(artifact.expiresAt) <= world.now())
      throw new GitHubError(410, "Artifact has expired");
    return { status: 302, headers: { location: signedUrl(world, request.origin, artifact, "r") } };
  });
  apiRoutes.repo(
    "DELETE",
    "/actions/artifacts/{id}",
    { permission: "actions", level: "write" },
    ({ request, repository }) => {
      world.artifacts.delete(artifactOf(request, repository).id);
      return { status: 204 };
    },
  );
}

/** The backend IDs of a request, which must be the runtime token's run (and job, when writing). */
function backendIds(body: Record<string, unknown>, owner: { run: Run; job: Job }, anyJob = false) {
  const run = text(body, "workflow_run_backend_id", "workflowRunBackendId");
  const job = text(body, "workflow_job_run_backend_id", "workflowJobRunBackendId");
  const otherJob = job !== "" && job !== owner.job.backendId;
  if (run !== owner.run.backendId || (otherJob && !anyJob)) {
    throw new TwirpError("permission_denied", "the backend IDs are not the runtime token's");
  }
  return { run, job: job || owner.job.backendId };
}

/** A field by its protobuf name or its JSON name; a wrapper's value as itself. */
function text(body: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = body[name];
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && "value" in value)
      return String((value as { value: unknown }).value);
    return String(value);
  }
  return "";
}

function signature(world: World, id: number, expiry: number, permission: string): string {
  return createHmac("sha256", world.secret).update(`${id}:${expiry}:${permission}`).digest("hex");
}

/** A URL that reads (`r`) or writes (`w`) one artifact's blob for an hour, with no other credential. */
function signedUrl(
  world: World,
  origin: string,
  artifact: Artifact,
  permission: "r" | "w",
): string {
  const expiry = world.now() + SIGNED_MS;
  const sig = signature(world, artifact.id, expiry, permission);
  return `${origin}${BLOBS}/${artifact.id}?sp=${permission}&se=${expiry}&sig=${sig}`;
}

function signedArtifact(
  world: World,
  request: FakeRequest,
  permission: "r" | "w",
): Artifact | undefined {
  const id = Number(request.params.id);
  const expiry = Number(request.query.get("se"));
  const given = Buffer.from(request.query.get("sig") ?? "", "hex");
  const wanted = Buffer.from(signature(world, id, expiry, permission), "hex");
  if (request.query.get("sp") !== permission || !(expiry > world.now())) return undefined;
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return undefined;
  return world.artifacts.get(id);
}

function azureError(status: number, code: string): Reply {
  return {
    status,
    body: `<?xml version="1.0" encoding="utf-8"?><Error><Code>${code}</Code><Message>The fake blob store refused the request.</Message></Error>`,
    headers: { "content-type": "application/xml", "x-ms-error-code": code },
  };
}
