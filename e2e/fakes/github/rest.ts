import type { ServerResponse } from "node:http";
import { type FakeRequest, type FakeServer, json, type Reply } from "../http.ts";
import {
  GitHubError,
  grants,
  type Need,
  notFound,
  type Permissions,
  unprocessable,
} from "./auth.ts";
import { type CommitObject, type TreeChange, ZERO_SHA } from "./git.ts";
import { workflowInfo } from "./workflows.ts";
import {
  accountJson,
  api,
  type Caller,
  callerJson,
  commentJson,
  type Issue,
  issueJson,
  jobJson,
  labelJson,
  pullJson,
  type Repository,
  type Run,
  repositoryJson,
  reviewJson,
  runJson,
  type World,
} from "./world.ts";

/**
 * GitHub's REST API under `/api/v3`, as on GitHub Enterprise Server: `gh` with `GH_HOST` and
 * `actions/checkout` with a `GITHUB_SERVER_URL` other than github.com call it there
 * (docs/web/github-cli/cli-internal-ghinstance-host-go-at-fc4b137.md,
 * docs/web/github/checkout-src-url-helper-ts-at-3d3c42e.md). The subset is what Codeman's
 * platform (src/platform/github), the templates' `gh` commands and the pinned actions call.
 */

export const API = "/api/v3";

export interface Call {
  request: FakeRequest;
  response: ServerResponse;
  caller: Caller;
  repository: Repository;
}

type Answer = Reply | undefined | Promise<Reply | undefined>;

/** Routes that identify the caller and answer GitHub's errors with their headers. */
export class Api {
  readonly server: FakeServer;
  readonly world: World;

  constructor(server: FakeServer, world: World) {
    this.server = server;
    this.world = world;
  }

  /** A route under `/api/v3` with the caller identified. */
  route(
    method: string,
    pattern: string,
    handler: (request: FakeRequest, caller: Caller, response: ServerResponse) => Answer,
  ): void {
    this.server.route(method, `${API}${pattern}`, (request, response) =>
      answer(async () => {
        this.world.adopt(request.origin);
        const caller = this.world.identify(request.headers.authorization, method, request.path);
        request.note({ token: callerJson(this.world, caller) });
        return handler(request, caller, response);
      }),
    );
  }

  /** A route of `/repos/{owner}/{repo}/…` that needs `need` on the repository. */
  repo(
    method: string,
    pattern: string,
    need: Need | ((call: Call) => Need),
    handler: (call: Call) => Answer,
  ): void {
    this.route(method, `/repos/{owner}/{repo}${pattern}`, (request, caller, response) => {
      const repository = this.world.repositories.get(
        `${request.params.owner}/${request.params.repo}`.toLowerCase(),
      );
      if (!repository) throw notFound();
      const call = { request, response, caller, repository };
      this.world.authorize(caller, repository, typeof need === "function" ? need(call) : need);
      return handler(call);
    });
  }
}

/** Runs a handler, turning a `GitHubError` into its answer with headers. */
export async function answer(handler: () => Answer): Promise<Reply | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof GitHubError) {
      return { status: error.status, body: error.body, headers: error.headers };
    }
    throw error;
  }
}

/** Whether a caller acts with `GITHUB_TOKEN`, whose events start no workflow. */
export function triggers(caller: Caller): boolean {
  return !(caller.kind === "token" && caller.token.kind === "job");
}

const read = (permission: string | string[]): Need => ({ permission, level: "read" });
const write = (permission: string | string[]): Need => ({ permission, level: "write" });

/**
 * An issue's labels, comments and update take `issues`; a pull request's also take
 * `pull_requests`. GitHub lists both permissions for these endpoints, as alternatives.
 */
function issueNeed(level: "read" | "write") {
  return (call: Call): Need => {
    const number = Number(call.request.params.number);
    const pull = call.repository.issues.get(number)?.pull;
    return { permission: pull ? ["issues", "pull_requests"] : "issues", level };
  };
}

function commentNeed(level: "read" | "write") {
  return (call: Call): Need => {
    const id = Number(call.request.params.id);
    const issue = [...call.repository.issues.values()].find((candidate) =>
      candidate.comments.some((comment) => comment.id === id),
    );
    return { permission: issue?.pull ? ["issues", "pull_requests"] : "issues", level };
  };
}

export function registerRest(apiRoutes: Api): void {
  const world = apiRoutes.world;
  const route = apiRoutes.route.bind(apiRoutes);
  const repo = apiRoutes.repo.bind(apiRoutes);

  // Meta and accounts

  // gh asks for the version of an Enterprise host to know whether a dispatch can answer the
  // run's details (docs/web/github-cli/cli-internal-featuredetection-feature-detection-go-at-fc4b137.md).
  route("GET", "/meta", () =>
    json({ installed_version: "3.21.0", verifiable_password_authentication: false }),
  );
  route("GET", "/users/{username}", (request) =>
    json(accountJson(world, world.user(request.params.username ?? ""))),
  );

  // Apps: the JWT's calls, then the installation token's own

  const appOf = (caller: Caller) => {
    if (caller.kind !== "app") {
      throw new GitHubError(401, "A JSON web token could not be decoded");
    }
    return caller.app;
  };
  const installationJson = (installation: ReturnType<typeof world.installationFor>) => {
    if (!installation) throw notFound();
    return json({
      id: installation.id,
      app_id: installation.app.id,
      app_slug: installation.app.slug,
      client_id: installation.app.clientId,
      account: accountJson(world, installation.account),
      repository_selection: installation.repositories === "all" ? "all" : "selected",
      permissions: installation.permissions,
      target_type: installation.account.type,
    });
  };
  route("GET", "/app", (_request, caller) => {
    const app = appOf(caller);
    return json({ id: app.id, slug: app.slug, name: app.name, client_id: app.clientId });
  });
  route("GET", "/repos/{owner}/{repo}/installation", (request, caller) => {
    const app = appOf(caller);
    const repository = world.repository(`${request.params.owner}/${request.params.repo}`);
    return installationJson(world.installationFor(app, repository.owner.login, repository.name));
  });
  route("GET", "/orgs/{owner}/installation", (request, caller) =>
    installationJson(world.installationFor(appOf(caller), request.params.owner ?? "")),
  );
  route("GET", "/users/{owner}/installation", (request, caller) =>
    installationJson(world.installationFor(appOf(caller), request.params.owner ?? "")),
  );
  route("POST", "/app/installations/{id}/access_tokens", (request, caller) => {
    const app = appOf(caller);
    const installation = world.installations.get(Number(request.params.id));
    if (!installation || installation.app.id !== app.id) throw notFound();
    const body = (request.body.length > 0 ? request.json() : {}) as {
      repositories?: unknown;
      repository_ids?: unknown;
      permissions?: unknown;
    };
    const ids = Array.isArray(body.repository_ids) ? body.repository_ids.map(Number) : [];
    const names = [
      ...(Array.isArray(body.repositories) ? body.repositories.map(String) : []),
      ...[...world.repositories.values()]
        .filter((repository) => ids.includes(repository.id))
        .map((repository) => repository.name),
    ];
    const token = world.installationToken(installation, {
      repositories: names,
      permissions: (body.permissions ?? undefined) as Permissions | undefined,
    });
    const repositories =
      token.repositories === "all"
        ? undefined
        : [...token.repositories].map((name) => repositoryJson(world, world.repository(name)));
    return json(
      {
        token: token.value,
        expires_at: world.iso(token.expiresAt),
        permissions: token.permissions,
        repository_selection: token.repositories === "all" ? "all" : "selected",
        ...(repositories ? { repositories } : {}),
      },
      201,
    );
  });
  route("DELETE", "/installation/token", (_request, caller) => {
    if (caller.kind !== "token" || caller.token.kind !== "installation") {
      throw new GitHubError(401, "Bad credentials");
    }
    caller.token.revoked = true;
    return { status: 204 };
  });

  // Repositories

  repo("GET", "", read("metadata"), ({ repository }) => json(repositoryJson(world, repository)));
  repo("GET", "/hash-algorithm", read("metadata"), () => json({ hash_algorithm: "sha1" }));
  repo(
    "GET",
    "/collaborators/{username}/permission",
    read("metadata"),
    ({ request, repository }) => {
      const user = world.user(request.params.username ?? "");
      const { permission, role } = world.permission(repository, user.login);
      return json({ permission, role_name: role, user: accountJson(world, user) });
    },
  );
  repo("GET", "/branches/{branch*}", read("contents"), async ({ request, repository }) => {
    const name = request.params.branch ?? "";
    const sha = await repository.git.resolve(`refs/heads/${name}`);
    if (!sha) throw new GitHubError(404, "Branch not found");
    return json({
      name,
      commit: { sha, url: commitUrl(world, repository, sha) },
      protected: false,
    });
  });
  repo("GET", "/commits", read("contents"), async ({ request, repository }) => {
    const { perPage, page } = paging(request);
    const revision = request.query.get("sha") || `refs/heads/${repository.defaultBranch}`;
    const start = await revisionSha(repository, revision);
    if (!start) throw new GitHubError(404, `No commit found for SHA: ${revision}`);
    const commits = await repository.git.log(start, {
      until: request.query.get("until") ?? undefined,
      since: request.query.get("since") ?? undefined,
      path: request.query.get("path") ?? undefined,
      max: perPage + 1,
      skip: (page - 1) * perPage,
    });
    const more = commits.length > perPage;
    const body = commits.slice(0, perPage).map((commit) => listedCommit(world, repository, commit));
    return { status: 200, body, headers: linkHeader(request, page, perPage, more) };
  });
  repo("GET", "/commits/{ref*}", read("contents"), async ({ request, repository }) => {
    const sha = await revisionSha(repository, request.params.ref ?? "");
    const commit = sha ? await repository.git.readCommit(sha) : undefined;
    if (!commit) throw new GitHubError(422, `No commit found for SHA: ${request.params.ref}`);
    const parent = commit.parents[0];
    const files = parent ? await repository.git.diff(parent, commit.sha) : [];
    return json({ ...listedCommit(world, repository, commit), files: files.map(fileJson) });
  });
  repo("GET", "/compare/{basehead*}", read("contents"), async ({ request, repository }) => {
    const basehead = request.params.basehead ?? "";
    const [base = "", head = ""] = basehead.includes("...")
      ? basehead.split("...")
      : basehead.split("..");
    const baseSha = await revisionSha(repository, base.replace(/^[^:]+:/, ""));
    const headSha = await revisionSha(repository, head.replace(/^[^:]+:/, ""));
    if (!baseSha || !headSha) throw notFound();
    const mergeBase = await repository.git.mergeBase(baseSha, headSha);
    const ahead = await repository.git.count(`${baseSha}..${headSha}`);
    const behind = await repository.git.count(`${headSha}..${baseSha}`);
    const status =
      ahead === 0 && behind === 0
        ? "identical"
        : behind === 0
          ? "ahead"
          : ahead === 0
            ? "behind"
            : "diverged";
    const commits =
      ahead > 0 ? await repository.git.log(`${baseSha}..${headSha}`, { max: 250 }) : [];
    const files = await repository.git.diff(mergeBase ?? baseSha, headSha);
    const baseCommit = await repository.git.readCommit(baseSha);
    const mergeCommit = mergeBase ? await repository.git.readCommit(mergeBase) : undefined;
    return json({
      url: `${api(world)}/repos/${repository.fullName}/compare/${basehead}`,
      html_url: `${world.serverUrl}/${repository.fullName}/compare/${basehead}`,
      status,
      ahead_by: ahead,
      behind_by: behind,
      total_commits: ahead,
      base_commit: baseCommit ? listedCommit(world, repository, baseCommit) : null,
      merge_base_commit: mergeCommit ? listedCommit(world, repository, mergeCommit) : null,
      commits: commits.reverse().map((commit) => listedCommit(world, repository, commit)),
      files: files.map(fileJson),
    });
  });
  repo("GET", "/contents/{path*}", read("contents"), async ({ request, repository }) => {
    const path = (request.params.path ?? "").replace(/\/+$/, "");
    const ref = request.query.get("ref") || `refs/heads/${repository.defaultBranch}`;
    const sha = await revisionSha(repository, ref);
    if (!sha) throw new GitHubError(404, `No commit found for the ref ${ref}`);
    const entry = await repository.git.entry(sha, path);
    if (!entry) throw notFound();
    const base = `${api(world)}/repos/${repository.fullName}/contents`;
    const item = (file: { path: string; sha: string; type: string; size?: number }) => ({
      type: file.type === "tree" ? "dir" : file.type === "commit" ? "submodule" : "file",
      name: file.path.split("/").at(-1),
      path: file.path,
      sha: file.sha,
      size: file.size ?? 0,
      url: `${base}/${file.path}?ref=${encodeURIComponent(ref)}`,
      html_url: `${world.serverUrl}/${repository.fullName}/blob/${ref}/${file.path}`,
    });
    if (entry.type === "tree") {
      const children = await repository.git.listTree(entry.sha, false);
      return json(children.map((child) => item({ ...child, path: `${path}/${child.path}` })));
    }
    if (entry.type !== "blob") return json(item(entry));
    const content = await repository.git.readBlob(entry.sha);
    return json({
      ...item(entry),
      type: entry.mode === "120000" ? "symlink" : "file",
      encoding: "base64",
      content: (content.toString("base64").match(/.{1,60}/g) ?? []).join("\n"),
    });
  });

  // Git Data API

  const refJson = (repository: Repository, ref: string, sha: string) => ({
    ref,
    node_id: Buffer.from(`ref:${ref}`).toString("base64"),
    url: `${api(world)}/repos/${repository.fullName}/git/${ref}`,
    object: {
      type: "commit",
      sha,
      url: `${api(world)}/repos/${repository.fullName}/git/commits/${sha}`,
    },
  });
  const getRef = async ({ request, repository }: Call) => {
    const ref = `refs/${request.params.ref ?? ""}`;
    const sha = (await repository.git.refs()).get(ref);
    if (!sha) throw notFound();
    return json(refJson(repository, ref, sha));
  };
  repo("GET", "/git/ref/{ref*}", read("contents"), getRef);
  repo("GET", "/git/refs/{ref*}", read("contents"), getRef);
  repo("GET", "/git/matching-refs/{ref*}", read("contents"), async ({ request, repository }) => {
    const prefix = `refs/${request.params.ref ?? ""}`;
    const refs = [...(await repository.git.refs())].filter(([name]) => name.startsWith(prefix));
    return json(refs.map(([name, sha]) => refJson(repository, name, sha)));
  });
  repo("POST", "/git/refs", write("contents"), async (call) => {
    const { request, repository, caller } = call;
    const body = request.json() as { ref?: unknown; sha?: unknown };
    const ref = String(body.ref ?? "");
    const sha = String(body.sha ?? "");
    if (!/^refs\/[^/]+\/.+/.test(ref)) {
      throw unprocessable("Reference name must start with 'refs/' and have at least two slashes.");
    }
    if ((await repository.git.objectType(sha)) !== "commit") {
      throw unprocessable("Object does not exist");
    }
    await workflowsCheck(caller, repository, undefined, sha);
    if (!(await repository.git.updateRef(ref, sha, ZERO_SHA))) {
      throw unprocessable("Reference already exists");
    }
    await world.emitPush(repository, world.actor(caller), ref, ZERO_SHA, sha, triggers(caller));
    return json(refJson(repository, ref, sha), 201);
  });
  repo("PATCH", "/git/refs/{ref*}", write("contents"), async ({ request, repository, caller }) => {
    const ref = `refs/${request.params.ref ?? ""}`;
    const body = request.json() as { sha?: unknown; force?: unknown };
    const sha = String(body.sha ?? "");
    const before = (await repository.git.refs()).get(ref);
    if (!before) throw unprocessable("Reference does not exist");
    if ((await repository.git.objectType(sha)) !== "commit") {
      throw unprocessable("Object does not exist");
    }
    if (body.force !== true && !(await repository.git.isAncestor(before, sha))) {
      throw unprocessable("Update is not a fast forward");
    }
    await workflowsCheck(caller, repository, before, sha);
    if (!(await repository.git.updateRef(ref, sha, before))) {
      throw unprocessable("Update is not a fast forward");
    }
    await world.emitPush(repository, world.actor(caller), ref, before, sha, triggers(caller));
    return json(refJson(repository, ref, sha));
  });
  repo("DELETE", "/git/refs/{ref*}", write("contents"), async ({ request, repository, caller }) => {
    const ref = `refs/${request.params.ref ?? ""}`;
    const before = (await repository.git.refs()).get(ref);
    if (!before || !(await repository.git.deleteRef(ref, before))) {
      throw unprocessable("Reference does not exist");
    }
    await world.emitPush(repository, world.actor(caller), ref, before, ZERO_SHA, triggers(caller));
    return { status: 204 };
  });
  repo("POST", "/git/blobs", write("contents"), async ({ request, repository }) => {
    const body = request.json() as { content?: unknown; encoding?: unknown };
    if (typeof body.content !== "string") {
      throw unprocessable('Invalid request.\n\n"content" wasn\'t supplied.');
    }
    const encoding = body.encoding ?? "utf-8";
    if (encoding !== "utf-8" && encoding !== "base64") {
      throw unprocessable(`encoding must be utf-8 or base64, not ${String(encoding)}`);
    }
    const sha = await repository.git.writeBlob(
      Buffer.from(body.content, encoding === "base64" ? "base64" : "utf8"),
    );
    return json({ sha, url: `${api(world)}/repos/${repository.fullName}/git/blobs/${sha}` }, 201);
  });
  repo("GET", "/git/blobs/{sha}", read("contents"), async ({ request, repository }) => {
    const sha = request.params.sha ?? "";
    if ((await repository.git.objectType(sha)) !== "blob") throw notFound();
    const content = await repository.git.readBlob(sha);
    return json({
      sha,
      node_id: Buffer.from(`blob:${sha}`).toString("base64"),
      size: content.length,
      encoding: "base64",
      content: content.toString("base64"),
      url: `${api(world)}/repos/${repository.fullName}/git/blobs/${sha}`,
    });
  });
  repo("POST", "/git/trees", write("contents"), async ({ request, repository }) => {
    const body = request.json() as { base_tree?: unknown; tree?: unknown };
    if (!Array.isArray(body.tree))
      throw unprocessable('Invalid request.\n\n"tree" wasn\'t supplied.');
    let base: string | undefined;
    if (body.base_tree !== undefined && body.base_tree !== null) {
      base = await repository.git.resolveTree(String(body.base_tree));
      if (!base) throw unprocessable("Invalid tree info", { errors: ["base_tree is not a tree"] });
    }
    const changes: TreeChange[] = [];
    for (const raw of body.tree as Record<string, unknown>[]) {
      const path = String(raw.path ?? "");
      const mode = String(raw.mode ?? "");
      const type = String(raw.type ?? "blob");
      if (
        !path ||
        path.startsWith("/") ||
        path.split("/").some((part) => part === "" || part === "." || part === "..")
      ) {
        throw unprocessable("Invalid tree info", { errors: [`tree.path ${path} is invalid`] });
      }
      if (!["100644", "100755", "040000", "160000", "120000"].includes(mode)) {
        throw unprocessable("Invalid tree info", { errors: [`tree.mode ${mode} is invalid`] });
      }
      if (type !== "blob" && type !== "tree" && type !== "commit") {
        throw unprocessable("Invalid tree info", { errors: [`tree.type ${type} is invalid`] });
      }
      if (raw.sha !== undefined && raw.content !== undefined) {
        throw unprocessable("Invalid tree info", {
          errors: ["tree.sha and tree.content are exclusive"],
        });
      }
      if (raw.sha === null) {
        changes.push({ path, mode, type, sha: null });
      } else if (typeof raw.content === "string") {
        changes.push({ path, mode, type: "blob", content: Buffer.from(raw.content, "utf8") });
      } else if (typeof raw.sha === "string") {
        const actual = await repository.git.objectType(raw.sha);
        if (type !== "commit" && actual !== type) {
          throw unprocessable("GitRPC::BadObjectState", {
            errors: [`${raw.sha} is not a ${type}`],
          });
        }
        changes.push({ path, mode, type, sha: raw.sha });
      } else {
        throw unprocessable("Invalid tree info", {
          errors: ["tree.sha or tree.content is required"],
        });
      }
    }
    const sha = await repository.git.buildTree(base, changes);
    return json(await treeJson(world, repository, sha, false), 201);
  });
  repo("GET", "/git/trees/{sha*}", read("contents"), async ({ request, repository }) => {
    const sha = await repository.git.resolveTree(request.params.sha ?? "");
    if (!sha) throw notFound();
    const recursive = ["1", "true"].includes(request.query.get("recursive") ?? "");
    return json(await treeJson(world, repository, sha, recursive));
  });
  repo("POST", "/git/commits", write("contents"), async ({ request, repository, caller }) => {
    const body = request.json() as {
      message?: unknown;
      tree?: unknown;
      parents?: unknown;
      author?: { name?: string; email?: string; date?: string };
      committer?: { name?: string; email?: string; date?: string };
    };
    if (typeof body.message !== "string")
      throw unprocessable('Invalid request.\n\n"message" wasn\'t supplied.');
    const tree = String(body.tree ?? "");
    if ((await repository.git.objectType(tree)) !== "tree")
      throw unprocessable("Tree SHA does not exist");
    const parents = Array.isArray(body.parents) ? body.parents.map(String) : [];
    for (const parent of parents) {
      if ((await repository.git.objectType(parent)) !== "commit")
        throw unprocessable("Parent SHA does not exist or is not a commit object");
    }
    const actor = world.actor(caller);
    const now = world.iso();
    const author = {
      name: body.author?.name ?? actor.login,
      email: body.author?.email ?? `${actor.id}+${actor.login}@users.noreply.github.com`,
      date: body.author?.date ?? now,
    };
    const committer = body.committer?.name
      ? {
          name: body.committer.name,
          email: body.committer.email ?? author.email,
          date: body.committer.date ?? now,
        }
      : { name: "GitHub", email: "noreply@github.com", date: now };
    const sha = await repository.git.commitTree({
      tree,
      parents,
      message: body.message,
      author,
      committer,
    });
    if (!body.committer?.name) world.signed.add(sha);
    const commit = await repository.git.readCommit(sha);
    if (!commit) throw new Error(`The commit ${sha} was not written.`);
    return json(gitCommitJson(world, repository, commit), 201);
  });
  repo("GET", "/git/commits/{sha}", read("contents"), async ({ request, repository }) => {
    const commit = await repository.git.readCommit(request.params.sha ?? "");
    if (!commit) throw notFound();
    return json(gitCommitJson(world, repository, commit));
  });

  // Issues, labels and comments

  repo("GET", "/issues", read("issues"), ({ request, repository }) => {
    const state = request.query.get("state") ?? "open";
    const labels = (request.query.get("labels") ?? "")
      .split(",")
      .map((label) => label.trim().toLowerCase())
      .filter((label) => label !== "");
    const since = request.query.get("since");
    const creator = request.query.get("creator")?.toLowerCase();
    const issues = [...repository.issues.values()]
      .filter(
        (issue) =>
          (state === "all" || issue.state === state) &&
          labels.every((label) => issue.labels.some((name) => name.toLowerCase() === label)) &&
          (!since || issue.updatedAt >= since) &&
          (!creator || issue.user.login.toLowerCase() === creator),
      )
      .sort((a, b) => b.number - a.number);
    if (request.query.get("direction") === "asc") issues.reverse();
    return paged(
      request,
      issues.map((issue) => issueJson(world, repository, issue)),
    );
  });
  repo("POST", "/issues", write("issues"), ({ request, repository, caller }) => {
    const body = request.json() as { title?: unknown; body?: unknown; labels?: unknown };
    const issue = world.openIssue(
      repository,
      world.actor(caller),
      {
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : "",
        labels: labelNames(body.labels),
      },
      triggers(caller),
    );
    return json(issueJson(world, repository, issue), 201);
  });
  // Issues alone, a pull request's too: GitHub lists no other permission for this read.
  repo("GET", "/issues/{number}", read("issues"), ({ request, repository }) =>
    json(issueJson(world, repository, world.issue(repository, Number(request.params.number)))),
  );
  repo("PATCH", "/issues/{number}", issueNeed("write"), ({ request, repository, caller }) => {
    const issue = world.issue(repository, Number(request.params.number));
    const body = request.json() as Record<string, unknown>;
    const actor = world.actor(caller);
    world.editIssue(
      repository,
      issue,
      actor,
      {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.body === "string" ? { body: body.body } : {}),
        ...(body.state === "open" || body.state === "closed" ? { state: body.state } : {}),
        ...(typeof body.state_reason === "string" ? { stateReason: body.state_reason } : {}),
      },
      triggers(caller),
    );
    if (Array.isArray(body.labels))
      setLabels(world, repository, issue, labelNames(body.labels), caller);
    return json(issueJson(world, repository, issue));
  });
  const labelsOf = (repository: Repository, issue: Issue) =>
    issue.labels.map((name) => labelJson(world, repository, world.label(repository, name)));
  repo("GET", "/issues/{number}/labels", issueNeed("read"), ({ request, repository }) =>
    paged(request, labelsOf(repository, world.issue(repository, Number(request.params.number)))),
  );
  repo("POST", "/issues/{number}/labels", issueNeed("write"), ({ request, repository, caller }) => {
    const issue = world.issue(repository, Number(request.params.number));
    const names = labelNames(request.json());
    if (names.length === 0) throw unprocessable("Invalid request.\n\nNo labels were supplied.");
    world.addLabels(repository, issue, names, world.actor(caller), triggers(caller));
    return json(labelsOf(repository, issue));
  });
  repo("PUT", "/issues/{number}/labels", issueNeed("write"), ({ request, repository, caller }) => {
    const issue = world.issue(repository, Number(request.params.number));
    setLabels(world, repository, issue, labelNames(request.json()), caller);
    return json(labelsOf(repository, issue));
  });
  repo(
    "DELETE",
    "/issues/{number}/labels",
    issueNeed("write"),
    ({ request, repository, caller }) => {
      const issue = world.issue(repository, Number(request.params.number));
      setLabels(world, repository, issue, [], caller);
      return { status: 204 };
    },
  );
  repo(
    "DELETE",
    "/issues/{number}/labels/{name}",
    issueNeed("write"),
    ({ request, repository, caller }) => {
      const issue = world.issue(repository, Number(request.params.number));
      if (
        !world.removeLabel(
          repository,
          issue,
          request.params.name ?? "",
          world.actor(caller),
          triggers(caller),
        )
      ) {
        throw new GitHubError(404, "Label does not exist");
      }
      return json(labelsOf(repository, issue));
    },
  );
  repo("GET", "/issues/{number}/comments", issueNeed("read"), ({ request, repository }) => {
    const issue = world.issue(repository, Number(request.params.number));
    const since = request.query.get("since");
    const comments = issue.comments.filter((comment) => !since || comment.updatedAt >= since);
    return paged(
      request,
      comments.map((comment) => commentJson(world, repository, issue, comment)),
    );
  });
  repo(
    "POST",
    "/issues/{number}/comments",
    issueNeed("write"),
    ({ request, repository, caller }) => {
      const issue = world.issue(repository, Number(request.params.number));
      const body = request.json() as { body?: unknown };
      const comment = world.comment(
        repository,
        issue,
        world.actor(caller),
        typeof body.body === "string" ? body.body : "",
        triggers(caller),
      );
      return json(commentJson(world, repository, issue, comment), 201);
    },
  );
  repo("GET", "/issues/comments/{id}", commentNeed("read"), ({ request, repository }) => {
    const { issue, comment } = world.findComment(repository, Number(request.params.id));
    return json(commentJson(world, repository, issue, comment));
  });
  repo(
    "PATCH",
    "/issues/comments/{id}",
    commentNeed("write"),
    ({ request, repository, caller }) => {
      const { issue, comment } = world.findComment(repository, Number(request.params.id));
      const body = request.json() as { body?: unknown };
      if (typeof body.body !== "string" || body.body === "") {
        throw unprocessable("Validation Failed", {
          errors: [{ resource: "IssueComment", field: "body", code: "missing_field" }],
        });
      }
      const actor = world.actor(caller);
      if (
        comment.user.id !== actor.id &&
        caller.kind === "token" &&
        !grants(caller.token.permissions, "issues", "write")
      ) {
        throw new GitHubError(403, "Resource not accessible by integration");
      }
      world.editComment(repository, issue, comment, actor, body.body, triggers(caller));
      return json(commentJson(world, repository, issue, comment));
    },
  );
  repo(
    "DELETE",
    "/issues/comments/{id}",
    commentNeed("write"),
    ({ request, repository, caller }) => {
      const { issue, comment } = world.findComment(repository, Number(request.params.id));
      world.deleteComment(repository, issue, comment, world.actor(caller), triggers(caller));
      return { status: 204 };
    },
  );
  repo("GET", "/labels", read(["issues", "pull_requests"]), ({ request, repository }) =>
    paged(
      request,
      [...repository.labels.values()].map((label) => labelJson(world, repository, label)),
    ),
  );
  repo("POST", "/labels", write(["issues", "pull_requests"]), ({ request, repository }) => {
    const body = request.json() as { name?: unknown; color?: unknown };
    if (typeof body.name !== "string" || body.name === "") throw unprocessable("Validation Failed");
    if (
      [...repository.labels.keys()].some(
        (name) => name.toLowerCase() === String(body.name).toLowerCase(),
      )
    ) {
      throw unprocessable("Validation Failed", {
        errors: [{ resource: "Label", code: "already_exists", field: "name" }],
      });
    }
    const label = world.label(repository, body.name);
    if (typeof body.color === "string") label.color = body.color;
    return json(labelJson(world, repository, label), 201);
  });

  // Pull requests

  repo("GET", "/pulls", read("pull_requests"), async ({ request, repository }) => {
    const state = request.query.get("state") ?? "open";
    const head = request.query.get("head");
    const base = request.query.get("base");
    const pulls = [...repository.issues.values()]
      .filter(
        (issue) =>
          issue.pull &&
          (state === "all" || issue.state === state) &&
          (!head ||
            `${repository.owner.login}:${issue.pull.head}`.toLowerCase() === head.toLowerCase() ||
            (!head.includes(":") && issue.pull.head === head)) &&
          (!base || issue.pull.base === base),
      )
      .sort((a, b) => b.number - a.number);
    if (request.query.get("direction") === "asc") pulls.reverse();
    const bodies = [];
    for (const issue of pulls) bodies.push(await pullJson(world, repository, issue));
    return paged(request, bodies);
  });
  repo("POST", "/pulls", write("pull_requests"), async ({ request, repository, caller }) => {
    const body = request.json() as Record<string, unknown>;
    const issue = await world.openPullRequest(
      repository,
      world.actor(caller),
      {
        head: String(body.head ?? ""),
        base: String(body.base ?? ""),
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : "",
        draft: body.draft === true,
      },
      triggers(caller),
    );
    return json(await pullJson(world, repository, issue), 201);
  });
  const pullOf = (call: Call) => {
    const issue = world.issue(call.repository, Number(call.request.params.number));
    if (!issue.pull) throw notFound();
    return issue;
  };
  // Either permission reads one pull request; listing them takes pull_requests.
  repo("GET", "/pulls/{number}", read(["pull_requests", "contents"]), async (call) =>
    json(await pullJson(world, call.repository, pullOf(call))),
  );
  repo("PATCH", "/pulls/{number}", write("pull_requests"), async (call) => {
    const issue = pullOf(call);
    const body = call.request.json() as Record<string, unknown>;
    await world.editPullRequest(
      call.repository,
      issue,
      world.actor(call.caller),
      {
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.body === "string" ? { body: body.body } : {}),
        ...(body.state === "open" || body.state === "closed" ? { state: body.state } : {}),
        ...(typeof body.base === "string" ? { base: body.base } : {}),
      },
      triggers(call.caller),
    );
    return json(await pullJson(world, call.repository, issue));
  });
  repo("GET", "/pulls/{number}/reviews", read("pull_requests"), (call) => {
    const issue = pullOf(call);
    return paged(
      call.request,
      (issue.pull?.reviews ?? []).map((review) =>
        reviewJson(world, call.repository, issue, review),
      ),
    );
  });
  repo("GET", "/pulls/{number}/comments", read("pull_requests"), (call) => {
    const issue = pullOf(call);
    return paged(
      call.request,
      (issue.pull?.reviewComments ?? []).map((comment) => ({
        id: comment.id,
        node_id: comment.nodeId,
        pull_request_review_id: comment.reviewId,
        path: comment.path,
        line: comment.line,
        original_line: comment.line,
        body: comment.body,
        user: accountJson(world, comment.user),
        commit_id: comment.commitId,
        created_at: comment.createdAt,
        updated_at: comment.createdAt,
        html_url: `${world.serverUrl}/${call.repository.fullName}/pull/${issue.number}#discussion_r${comment.id}`,
      })),
    );
  });

  // Actions: workflows, dispatches, runs, jobs, concurrency groups

  const workflowJson = (
    repository: Repository,
    workflow: { id: number; path: string; name: string },
  ) => ({
    id: workflow.id,
    node_id: Buffer.from(`workflow:${workflow.id}`).toString("base64"),
    name: workflow.name,
    path: workflow.path,
    state: "active",
    created_at: repository.createdAt,
    updated_at: repository.createdAt,
    url: `${api(world)}/repos/${repository.fullName}/actions/workflows/${workflow.id}`,
    html_url: `${world.serverUrl}/${repository.fullName}/blob/${repository.defaultBranch}/${workflow.path}`,
    badge_url: `${world.serverUrl}/${repository.fullName}/workflows/${workflow.name}/badge.svg`,
  });
  const findWorkflow = async (repository: Repository, selector: string) => {
    const workflows = await world.workflows(repository);
    const found = workflows.find(
      (workflow) =>
        String(workflow.id) === selector ||
        workflow.path === selector ||
        workflow.path.split("/").at(-1) === selector,
    );
    if (!found) throw notFound();
    return found;
  };
  repo("GET", "/actions/workflows", read("actions"), async ({ request, repository }) => {
    const workflows = await world.workflows(repository);
    return pagedObject(
      request,
      "workflows",
      workflows.map((workflow) => workflowJson(repository, workflow)),
    );
  });
  repo("GET", "/actions/workflows/{workflow}", read("actions"), async ({ request, repository }) =>
    json(workflowJson(repository, await findWorkflow(repository, request.params.workflow ?? ""))),
  );
  repo(
    "POST",
    "/actions/workflows/{workflow}/dispatches",
    write("actions"),
    async ({ request, repository, caller }) => {
      const workflow = await findWorkflow(repository, request.params.workflow ?? "");
      const body = request.json() as {
        ref?: unknown;
        inputs?: unknown;
        return_run_details?: unknown;
      };
      if (typeof body.ref !== "string" || body.ref === "") {
        throw unprocessable('Invalid request.\n\n"ref" wasn\'t supplied.');
      }
      const ref = body.ref;
      const short = ref.replace(/^refs\/(heads|tags)\//, "");
      const sha =
        (await repository.git.resolve(ref.startsWith("refs/") ? ref : `refs/heads/${ref}`)) ??
        (await repository.git.resolve(`refs/tags/${short}`));
      if (!sha) throw unprocessable(`No ref found for: ${ref}`);
      const entry = await repository.git.entry(sha, workflow.path);
      const source =
        entry?.type === "blob" ? (await repository.git.readBlob(entry.sha)).toString("utf8") : "";
      const info = workflowInfo(source);
      if (!info.dispatch) throw unprocessable("Workflow does not have 'workflow_dispatch' trigger");
      const inputs: Record<string, string> = {};
      if (body.inputs !== undefined && body.inputs !== null) {
        if (typeof body.inputs !== "object" || Array.isArray(body.inputs)) {
          throw unprocessable("Invalid request.\n\nFor 'properties/inputs', is not an object.");
        }
        for (const [name, value] of Object.entries(body.inputs as Record<string, unknown>)) {
          inputs[name] = typeof value === "string" ? value : JSON.stringify(value);
        }
      }
      const unexpected = Object.keys(inputs).filter((name) => !info.inputs.includes(name));
      if (unexpected.length > 0) {
        throw unprocessable(`Unexpected inputs provided: ${JSON.stringify(unexpected)}`);
      }
      if (Object.keys(inputs).length > 25)
        throw unprocessable("You can only provide up to 25 inputs.");
      const run = await world.dispatch(repository, workflow, ref, inputs, world.actor(caller));
      if (body.return_run_details !== true) return { status: 204 };
      return json({
        workflow_run_id: run.id,
        run_url: `${api(world)}/repos/${repository.fullName}/actions/runs/${run.id}`,
        html_url: `${world.serverUrl}/${repository.fullName}/actions/runs/${run.id}`,
      });
    },
  );
  const runOf = (call: Call): Run => {
    const run = world.runs.get(Number(call.request.params.run));
    if (!run || run.repository !== call.repository) throw notFound();
    return run;
  };
  repo("GET", "/actions/runs", read("actions"), ({ request, repository }) => {
    const filters: [string, (run: Run) => string][] = [
      ["head_sha", (run) => run.headSha],
      ["event", (run) => run.event],
      ["branch", (run) => run.headBranch],
      ["actor", (run) => run.actor.login],
    ];
    const status = request.query.get("status");
    const runs = [...world.runs.values()]
      .filter(
        (run) =>
          run.repository === repository &&
          filters.every(
            ([name, value]) => !request.query.get(name) || value(run) === request.query.get(name),
          ) &&
          (!status || run.status === status || run.conclusion === status),
      )
      .sort((a, b) => b.id - a.id);
    return pagedObject(
      request,
      "workflow_runs",
      runs.map((run) => runJson(world, run)),
    );
  });
  repo("GET", "/actions/runs/{run}", read("actions"), (call) => json(runJson(world, runOf(call))));
  repo("GET", "/actions/runs/{run}/jobs", read("actions"), (call) => {
    const run = runOf(call);
    return pagedObject(
      call.request,
      "jobs",
      run.jobs.map((job) => jobJson(world, run, job)),
    );
  });
  const jobOf = (call: Call) => {
    const job = world.jobs.get(Number(call.request.params.job));
    const run = job ? world.runs.get(job.runId) : undefined;
    if (!job || !run || run.repository !== call.repository) throw notFound();
    return { job, run };
  };
  repo("GET", "/actions/jobs/{job}", read("actions"), (call) => {
    const { job, run } = jobOf(call);
    return json(jobJson(world, run, job));
  });
  repo("GET", "/actions/jobs/{job}/logs", read("actions"), (call) => ({
    status: 200,
    body: jobOf(call).job.log,
    headers: { "content-type": "text/plain; charset=utf-8" },
  }));
  const members = (repository: Repository, group: string) =>
    [...world.runs.values()]
      .filter(
        (run) =>
          run.repository === repository && run.concurrency === group && run.status !== "completed",
      )
      .sort((a, b) => a.id - b.id)
      .map((run) => ({
        run_id: run.id,
        run_name: run.name,
        run_url: `${api(world)}/repos/${repository.fullName}/actions/runs/${run.id}`,
        run_html_url: `${world.serverUrl}/${repository.fullName}/actions/runs/${run.id}`,
        status: run.status === "in_progress" ? "in_progress" : "pending",
      }));
  repo("GET", "/actions/concurrency_groups", read("actions"), ({ repository }) => {
    const names = new Set(
      [...world.runs.values()]
        .filter(
          (run) => run.repository === repository && run.concurrency && run.status !== "completed",
        )
        .map((run) => run.concurrency ?? ""),
    );
    return json({
      total_count: names.size,
      concurrency_groups: [...names].map((name) => ({
        group_name: name,
        group_url: `${api(world)}/repos/${repository.fullName}/actions/concurrency_groups/${encodeURIComponent(name)}`,
        last_acquired_at: null,
      })),
    });
  });
  repo("GET", "/actions/concurrency_groups/{group}", read("actions"), ({ request, repository }) => {
    const group = request.params.group ?? "";
    const found = members(repository, group);
    if (found.length === 0) throw notFound();
    return json({
      group_name: group,
      group_url: `${api(world)}/repos/${repository.fullName}/actions/concurrency_groups/${encodeURIComponent(group)}`,
      total_count: found.length,
      group_members: found,
    });
  });
}

/**
 * A ref or commit that adds or changes a workflow file needs `workflows: write`, as GitHub
 * refuses an App's push of a workflow without it.
 */
async function workflowsCheck(
  caller: Caller,
  repository: Repository,
  before: string | undefined,
  after: string,
): Promise<void> {
  if (caller.kind !== "token" || grants(caller.token.permissions, "workflows", "write")) return;
  const changed = before
    ? (await repository.git.diff(before, after)).map((file) => file.path)
    : (
        await repository.git.text(["log", "--format=", "--name-only", after, "--not", "--all"])
      ).split("\n");
  const workflow = changed.find((path) => path.startsWith(".github/workflows/"));
  if (workflow) {
    throw new GitHubError(
      403,
      `refusing to allow a GitHub App to create or update workflow \`${workflow}\` without \`workflows\` permission`,
    );
  }
}

function setLabels(
  world: World,
  repository: Repository,
  issue: Issue,
  names: string[],
  caller: Caller,
): void {
  const actor = world.actor(caller);
  for (const name of [...issue.labels]) {
    if (!names.some((wanted) => wanted.toLowerCase() === name.toLowerCase())) {
      world.removeLabel(repository, issue, name, actor, triggers(caller));
    }
  }
  world.addLabels(repository, issue, names, actor, triggers(caller));
}

/** Labels as the endpoints take them: names, `{ name }` objects, or `{ labels: [...] }`. */
function labelNames(value: unknown): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { labels?: unknown }).labels)
      ? (value as { labels: unknown[] }).labels
      : [];
  return list
    .map((item) =>
      typeof item === "string"
        ? item
        : typeof item === "object" && item !== null
          ? String((item as { name?: unknown }).name ?? "")
          : "",
    )
    .filter((name) => name !== "");
}

/** A branch, tag or SHA's commit. */
export async function revisionSha(
  repository: Repository,
  revision: string,
): Promise<string | undefined> {
  if (revision === "") return undefined;
  if (revision.startsWith("refs/")) return repository.git.resolve(revision);
  return (
    (await repository.git.resolve(`refs/heads/${revision}`)) ??
    (await repository.git.resolve(`refs/tags/${revision}`)) ??
    (/^[0-9a-f]{4,40}$/.test(revision) ? repository.git.resolve(revision) : undefined)
  );
}

function commitUrl(world: World, repository: Repository, sha: string): string {
  return `${api(world)}/repos/${repository.fullName}/commits/${sha}`;
}

function listedCommit(
  world: World,
  repository: Repository,
  commit: CommitObject,
): Record<string, unknown> {
  return {
    sha: commit.sha,
    node_id: Buffer.from(`commit:${commit.sha}`).toString("base64"),
    commit: {
      author: commit.author,
      committer: commit.committer,
      message: commit.message.replace(/\n$/, ""),
      tree: {
        sha: commit.tree,
        url: `${api(world)}/repos/${repository.fullName}/git/trees/${commit.tree}`,
      },
      url: `${api(world)}/repos/${repository.fullName}/git/commits/${commit.sha}`,
    },
    url: commitUrl(world, repository, commit.sha),
    html_url: `${world.serverUrl}/${repository.fullName}/commit/${commit.sha}`,
    author: null,
    committer: null,
    parents: commit.parents.map((sha) => ({ sha, url: commitUrl(world, repository, sha) })),
  };
}

function gitCommitJson(
  world: World,
  repository: Repository,
  commit: CommitObject,
): Record<string, unknown> {
  const signed = world.signed.has(commit.sha);
  return {
    sha: commit.sha,
    node_id: Buffer.from(`commit:${commit.sha}`).toString("base64"),
    url: `${api(world)}/repos/${repository.fullName}/git/commits/${commit.sha}`,
    html_url: `${world.serverUrl}/${repository.fullName}/commit/${commit.sha}`,
    author: commit.author,
    committer: commit.committer,
    message: commit.message.replace(/\n$/, ""),
    tree: {
      sha: commit.tree,
      url: `${api(world)}/repos/${repository.fullName}/git/trees/${commit.tree}`,
    },
    parents: commit.parents.map((sha) => ({
      sha,
      url: `${api(world)}/repos/${repository.fullName}/git/commits/${sha}`,
      html_url: `${world.serverUrl}/${repository.fullName}/commit/${sha}`,
    })),
    verification: {
      verified: signed,
      reason: signed ? "valid" : "unsigned",
      signature: null,
      payload: null,
    },
  };
}

async function treeJson(world: World, repository: Repository, sha: string, recursive: boolean) {
  const entries = await repository.git.listTree(sha, recursive);
  return {
    sha,
    url: `${api(world)}/repos/${repository.fullName}/git/trees/${sha}`,
    tree: entries.map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      sha: entry.sha,
      ...(entry.size !== undefined ? { size: entry.size } : {}),
      url: `${api(world)}/repos/${repository.fullName}/git/${entry.type === "tree" ? "trees" : "blobs"}/${entry.sha}`,
    })),
    truncated: false,
  };
}

function fileJson(file: { status: string; path: string }): Record<string, unknown> {
  const status =
    { A: "added", M: "modified", D: "removed", T: "changed" }[file.status[0] ?? "M"] ?? "modified";
  return { filename: file.path, status };
}

/** `per_page`, 30 by default and 100 at most, and `page`, from 1. */
export function paging(request: FakeRequest): { perPage: number; page: number } {
  const perPage = Math.min(100, Math.max(1, Number(request.query.get("per_page") ?? 30) || 30));
  const page = Math.max(1, Number(request.query.get("page") ?? 1) || 1);
  return { perPage, page };
}

function linkHeader(
  request: FakeRequest,
  page: number,
  perPage: number,
  more: boolean,
): Record<string, string> {
  if (!more) return {};
  const query = new URLSearchParams(request.query);
  query.set("per_page", String(perPage));
  query.set("page", String(page + 1));
  return { link: `<${request.origin}${request.path}?${query}>; rel="next"` };
}

/** One page of a list, with GitHub's `Link` header when more follow. */
export function paged(request: FakeRequest, items: readonly unknown[]): Reply {
  const { perPage, page } = paging(request);
  const slice = items.slice((page - 1) * perPage, page * perPage);
  return {
    status: 200,
    body: slice,
    headers: linkHeader(request, page, perPage, items.length > page * perPage),
  };
}

/** One page of a list GitHub wraps, as `{ total_count, <key>: [...] }`. */
export function pagedObject(request: FakeRequest, key: string, items: readonly unknown[]): Reply {
  const { perPage, page } = paging(request);
  const slice = items.slice((page - 1) * perPage, page * perPage);
  return {
    status: 200,
    body: { total_count: items.length, [key]: slice },
    headers: linkHeader(request, page, perPage, items.length > page * perPage),
  };
}
