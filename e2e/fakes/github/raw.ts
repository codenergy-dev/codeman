import type { FakeServer } from "../http.ts";
import type { World } from "./world.ts";

/**
 * raw.githubusercontent.com, for a pod's bootstrap, which downloads the gateway as
 * `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/dist/gateway.js` (decision 3 of the
 * plan to start pods from official engine images): a public repository's file at a commit, its
 * bytes as `text/plain`, without a redirect. The jobs network gives the fake GitHub that name as an
 * alias, and its certificate names it. Only a request for that host is answered; private
 * repositories, which need a token there, answer 404 as unknown ones do.
 */

/** The host the fake answers raw files on. */
export const RAW_HOST = "raw.githubusercontent.com";

const NOT_FOUND = { status: 404, body: "404: Not Found" };

export function registerRaw(server: FakeServer, world: World): void {
  server.route("GET", "/{owner}/{repo}/{ref}/{path*}", async (request) => {
    if ((request.headers.host ?? "").replace(/:443$/, "") !== RAW_HOST) {
      return { status: 404, body: { message: "Not Found" } };
    }
    const { owner = "", repo = "", ref = "", path = "" } = request.params;
    const repository = world.repositories.get(`${owner}/${repo}`.toLowerCase());
    if (!repository || repository.private) return NOT_FOUND;
    const sha = await repository.git.resolve(ref);
    const entry = sha ? await repository.git.entry(sha, path) : undefined;
    if (entry?.type !== "blob") return NOT_FOUND;
    return {
      status: 200,
      body: await repository.git.readBlob(entry.sha),
      headers: { "content-type": "text/plain; charset=utf-8" },
    };
  });
}
