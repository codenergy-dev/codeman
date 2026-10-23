import type { FakeServer } from "../http.ts";
import { json } from "../http.ts";
import { GitHubError, grants } from "./auth.ts";
import { answer } from "./rest.ts";
import { type Caller, callerJson, type Issue, type Repository, type World } from "./world.ts";

/**
 * GitHub's GraphQL endpoint at `/api/graphql`, for the two operations Codeman's side sends:
 * Codeman's `markPullRequestReadyForReview` (src/platform/github/platform.ts), and the
 * `repository(owner:, name:)` query `gh workflow run` sends for the default branch when it has no
 * `--ref` (docs/web/github-cli/cli-api-queries-repo-go-at-fc4b137.md). Any other query answers a
 * GraphQL error and is recorded as an `unsupported` violation, so a new call is noticed.
 */

export const GRAPHQL = "/api/graphql";

interface GraphQlError {
  type?: string;
  path?: string[];
  message: string;
}

export function registerGraphql(server: FakeServer, world: World): void {
  server.route("POST", GRAPHQL, (request) =>
    answer(async () => {
      const caller = world.identify(request.headers.authorization, "POST", request.path);
      request.note({ token: callerJson(world, caller) });
      if (caller.kind !== "token") {
        throw new GitHubError(401, "This endpoint requires you to be authenticated.");
      }
      const body = request.json() as { query?: unknown; variables?: unknown };
      const query = typeof body.query === "string" ? body.query : "";
      const variables = (body.variables ?? {}) as Record<string, unknown>;
      if (/\bmarkPullRequestReadyForReview\s*\(/.test(query)) {
        return json(await markReady(world, caller, argument(query, "pullRequestId", variables)));
      }
      if (/\brepository\s*\(/.test(query) && !/\bmutation\b/.test(query)) {
        return json(
          repositoryQuery(
            world,
            caller,
            argument(query, "owner", variables),
            argument(query, "name", variables),
          ),
        );
      }
      world.violate({
        kind: "unsupported",
        method: "POST",
        path: request.path,
        detail: `GraphQL: ${query.replace(/\s+/g, " ").slice(0, 200)}`,
      });
      return json({ errors: [{ message: "The fake GitHub does not answer this query." }] });
    }),
  );
}

/** An argument's value: a string literal, or a variable's. */
function argument(query: string, name: string, variables: Record<string, unknown>): string {
  const match = new RegExp(`\\b${name}\\s*:\\s*(\\$\\w+|"(?:[^"\\\\]|\\\\.)*")`).exec(query);
  const raw = match?.[1];
  if (!raw) return "";
  if (raw.startsWith("$")) return String(variables[raw.slice(1)] ?? "");
  return JSON.parse(raw) as string;
}

async function markReady(world: World, caller: Caller & { kind: "token" }, id: string) {
  let found: { repository: Repository; issue: Issue } | undefined;
  for (const repository of world.repositories.values()) {
    for (const issue of repository.issues.values()) {
      if (issue.pull?.nodeId === id) found = { repository, issue };
    }
  }
  const notResolved = {
    data: { markPullRequestReadyForReview: null },
    errors: [
      {
        type: "NOT_FOUND",
        path: ["markPullRequestReadyForReview"],
        message: `Could not resolve to a node with the global id of '${id}'`,
      },
    ],
  };
  if (!found || (found.repository.private && !world.covers(caller.token, found.repository))) {
    return notResolved;
  }
  const { repository, issue } = found;
  if (
    !world.covers(caller.token, repository) ||
    !grants(caller.token.permissions, "pull_requests", "write")
  ) {
    return {
      data: { markPullRequestReadyForReview: null },
      errors: [
        {
          type: "FORBIDDEN",
          path: ["markPullRequestReadyForReview"],
          message: "Resource not accessible by integration",
        },
      ],
    };
  }
  await world.editPullRequest(
    repository,
    issue,
    caller.token.actor,
    { draft: false },
    caller.token.kind !== "job",
  );
  return {
    data: {
      markPullRequestReadyForReview: {
        clientMutationId: null,
        pullRequest: { id, number: issue.number, isDraft: false },
      },
    },
  };
}

/**
 * The repository as gh's `RepositoryInfo` query reads it. Its `defaultBranchRef` needs
 * `metadata: read`: without it GitHub answers the field null with a FORBIDDEN error, which gh
 * reports as "Resource not accessible by integration (repository.defaultBranchRef)".
 */
function repositoryQuery(
  world: World,
  caller: Caller & { kind: "token" },
  owner: string,
  name: string,
): { data: Record<string, unknown>; errors?: GraphQlError[] } {
  const repository = world.repositories.get(`${owner}/${name}`.toLowerCase());
  const visible = repository && (!repository.private || world.covers(caller.token, repository));
  if (!repository || !visible) {
    return {
      data: { repository: null },
      errors: [
        {
          type: "NOT_FOUND",
          path: ["repository"],
          message: `Could not resolve to a Repository with the name '${owner}/${name}'.`,
        },
      ],
    };
  }
  const covered = world.covers(caller.token, repository);
  const metadata = !covered || grants(caller.token.permissions, "metadata", "read");
  const contents = covered && grants(caller.token.permissions, "contents", "write");
  const node = {
    id: repository.nodeId,
    databaseId: repository.id,
    name: repository.name,
    owner: { login: repository.owner.login },
    sshUrl: `git@${new URL(world.serverUrl).hostname}:${repository.fullName}.git`,
    hasIssuesEnabled: true,
    description: null,
    hasWikiEnabled: false,
    viewerPermission: contents ? "WRITE" : "READ",
    defaultBranchRef: metadata ? { name: repository.defaultBranch } : null,
    parent: null,
    mergeCommitAllowed: true,
    rebaseMergeAllowed: true,
    squashMergeAllowed: true,
  };
  if (metadata) return { data: { repository: node } };
  return {
    data: { repository: node },
    errors: [
      {
        type: "FORBIDDEN",
        path: ["repository", "defaultBranchRef"],
        message: "Resource not accessible by integration",
      },
    ],
  };
}
