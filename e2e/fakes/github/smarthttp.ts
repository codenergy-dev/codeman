import type { ServerResponse } from "node:http";
import { relative, sep } from "node:path";
import type { FakeRequest, FakeServer } from "../http.ts";
import { GitHubError, grants } from "./auth.ts";
import { httpBackend, ZERO_SHA } from "./git.ts";
import { answer, triggers } from "./rest.ts";
import { type Caller, callerJson, type Repository, type World } from "./world.ts";

/**
 * Clones, fetches and pushes over HTTP(S) at `/{owner}/{repo}` and `/{owner}/{repo}.git`, as
 * `actions/checkout` and git reach GitHub: a token as Basic auth's password (checkout sends
 * `x-access-token:<token>`), `contents: read` to fetch a private repository, `contents: write`
 * to push, and `workflows: write` to push a change to a workflow file. Each ref a push moves
 * gives a `push` event.
 */

export function registerSmartHttp(server: FakeServer, world: World): void {
  const serve =
    (service: "upload" | "receive" | "refs") => (request: FakeRequest, response: ServerResponse) =>
      answer(async () => {
        const { owner = "", repo = "" } = request.params;
        const name = repo.replace(/\.git$/, "");
        const repository = world.repositories.get(`${owner}/${name}`.toLowerCase());
        const wanted =
          service === "receive" || request.query.get("service") === "git-receive-pack"
            ? "write"
            : "read";
        let caller: Caller;
        try {
          caller = world.identify(request.headers.authorization, request.method, request.path);
          request.note({ token: callerJson(world, caller) });
        } catch (error) {
          if (error instanceof GitHubError && error.status === 401)
            return challenge("Invalid username or token.");
          throw error;
        }
        if (!repository) return { status: 404, body: "Repository not found.\n" };
        const refused = gitAccess(world, caller, repository, wanted);
        if (refused) return refused;
        const token = caller.kind === "token" ? caller.token : undefined;
        const before = service === "receive" ? await repository.git.refs() : undefined;
        const pushed = async () => {
          if (!before || !token) return;
          const after = await repository.git.refs();
          for (const ref of new Set([...before.keys(), ...after.keys()])) {
            const old = before.get(ref) ?? ZERO_SHA;
            const now = after.get(ref) ?? ZERO_SHA;
            if (old !== now) {
              await world.emitPush(repository, token.actor, ref, old, now, triggers(caller));
            }
          }
        };
        await httpBackend(
          world.root,
          {
            method: request.method,
            pathInfo: `/${relative(world.root, repository.git.path).split(sep).join("/")}/${SUFFIX[service]}`,
            query: request.query.toString(),
            headers: request.headers,
            body: request.body,
            ...(token ? { remoteUser: token.actor.login } : {}),
            env: {
              FAKE_GITHUB_WORKFLOWS:
                token && grants(token.permissions, "workflows", "write") ? "write" : "none",
            },
            done: pushed,
          },
          response,
        );
        return undefined;
      });
  server.route("GET", "/{owner}/{repo}/info/refs", serve("refs"));
  server.route("POST", "/{owner}/{repo}/git-upload-pack", serve("upload"));
  server.route("POST", "/{owner}/{repo}/git-receive-pack", serve("receive"));
}

const SUFFIX = { refs: "info/refs", upload: "git-upload-pack", receive: "git-receive-pack" };

/** Why git may not read or write `repository`, as an answer; undefined when it may. */
function gitAccess(world: World, caller: Caller, repository: Repository, level: "read" | "write") {
  if (caller.kind === "anonymous") {
    if (!repository.private && level === "read") return undefined;
    return challenge("Authentication required.");
  }
  if (caller.kind !== "token") return { status: 403, body: "Permission denied.\n" };
  const { token } = caller;
  const denied = {
    status: 403,
    body: `remote: Permission to ${repository.fullName}.git denied to ${token.actor.login}.\n`,
  };
  if (!world.covers(token, repository)) {
    return !repository.private && level === "read"
      ? undefined
      : repository.private
        ? { status: 404, body: "Repository not found.\n" }
        : denied;
  }
  return grants(token.permissions, "contents", level) ? undefined : denied;
}

function challenge(message: string) {
  return {
    status: 401,
    body: `${message}\n`,
    headers: { "www-authenticate": 'Basic realm="GitHub"' },
  };
}
