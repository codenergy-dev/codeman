import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

/**
 * act's action cache, for `--action-cache-path <dir> --action-offline-mode`: each pinned action
 * as a git clone in `<dir>/<owner>-<repo>@<sha>`, act's own name for it (`safeFilename` of the
 * `uses:` value, in `pkg/runner/step_action_remote.go` at act 0.2.89). act opens the clone with
 * no fetch in offline mode, but deletes and clones it again when its `origin` is not
 * `<GITHUB_SERVER_URL>/<owner>/<repo>`, and clones an action that is missing, with the
 * `GITHUB_TOKEN` secret as the password (spike 0.2, 5c). So the driver checks every pin before act
 * starts, and `fill` clones them once, anonymously, from github.com or from local clones.
 */

const execFileAsync = promisify(execFile);

/** A `uses:` of a remote action, pinned to a full commit SHA. */
export interface PinnedAction {
  /** As the workflow writes it, such as `actions/checkout@3d3c…`. */
  uses: string;
  owner: string;
  repo: string;
  sha: string;
}

const USES = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)["']?/;
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The remote actions the workflows use, each once. A local action (`./…`), a reusable workflow
 * and a Docker action (`docker://…`) are not cached. A remote action pinned to anything but a full
 * SHA is an error: act would resolve a tag or branch against the network.
 */
export function pinnedActions(workflows: Record<string, string>): PinnedAction[] {
  const found = new Map<string, PinnedAction>();
  for (const [file, text] of Object.entries(workflows)) {
    for (const line of text.split("\n")) {
      const uses = USES.exec(line)?.[1];
      if (!uses || uses.startsWith("./") || uses.startsWith("docker://")) continue;
      const at = uses.lastIndexOf("@");
      const [owner = "", repo = ""] = uses.slice(0, Math.max(at, 0)).split("/");
      const sha = uses.slice(at + 1);
      if (at < 0 || !owner || !repo || !FULL_SHA.test(sha)) {
        throw new Error(`${file}: ${uses} is not pinned to a full commit SHA.`);
      }
      found.set(uses, { uses, owner, repo, sha });
    }
  }
  return [...found.values()].sort((a, b) => a.uses.localeCompare(b.uses));
}

/** act's directory name for an action: `safeFilename` of its `uses:`. */
export function cacheName(uses: string): string {
  return uses.replace(/[<>:"/\\|?*]/g, "-");
}

/** The origin act requires of a cached clone: the server it would clone the action from. */
export function cacheOrigin(server: string, action: PinnedAction): string {
  return `${server.replace(/\/$/, "")}/${action.owner}/${action.repo}`;
}

/**
 * git with none of the user's or the system's configuration, so no credential helper, `insteadOf`
 * rewrite or proxy applies, and no prompt: an anonymous request, or none at all.
 */
export async function cleanGit(args: string[], cwd?: string): Promise<string> {
  const home = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "codeman-e2e-git-home-"));
  try {
    const { stdout } = await execFileAsync("git", ["-c", "credential.helper=", ...args], {
      ...(cwd ? { cwd } : {}),
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/bin/false",
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** Why each pin is not ready in the cache: missing, another origin, or no such commit. */
export async function cacheProblems(
  dir: string,
  actions: readonly PinnedAction[],
  server: string,
): Promise<string[]> {
  const problems: string[] = [];
  for (const action of actions) {
    const path = join(dir, cacheName(action.uses));
    if (!existsSync(join(path, ".git")) || !statSync(path).isDirectory()) {
      problems.push(`${action.uses} is not in the cache (${path})`);
      continue;
    }
    const origin = (
      await cleanGit(["-C", path, "config", "--get", "remote.origin.url"]).catch(() => "")
    ).trim();
    if (origin !== cacheOrigin(server, action)) {
      problems.push(
        `${action.uses}'s clone has the origin ${origin || "none"}, not ${cacheOrigin(server, action)}: act would delete it and clone it again`,
      );
      continue;
    }
    const commit = (
      await cleanGit([
        "-C",
        path,
        "rev-parse",
        "--verify",
        "--quiet",
        `${action.sha}^{commit}`,
      ]).catch(() => "")
    ).trim();
    if (commit !== action.sha) problems.push(`${action.uses}'s clone has no commit ${action.sha}`);
  }
  return problems;
}

/**
 * Clones each pin missing from the cache, from `sources[owner/repo]` (a local clone) or else from
 * github.com, anonymously; checks out its commit, whose ID git checks against the content; and
 * names the clone's origin as act requires it. A pin already in the cache is left alone.
 */
export async function fillCache(
  dir: string,
  actions: readonly PinnedAction[],
  options: { server: string; sources?: Record<string, string>; log?: (line: string) => void },
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  for (const action of actions) {
    if ((await cacheProblems(dir, [action], options.server)).length === 0) {
      options.log?.(`${action.uses}: already in the cache.`);
      continue;
    }
    const final = join(dir, cacheName(action.uses));
    const name = `${action.owner}/${action.repo}`;
    const source = options.sources?.[name] ?? `https://github.com/${name}`;
    const staging = mkdtempSync(join(dirname(final), ".filling-"));
    try {
      options.log?.(`${action.uses}: cloning ${source}.`);
      await cleanGit(["clone", "--quiet", "--no-checkout", source, join(staging, "clone")]);
      const clone = join(staging, "clone");
      const commit = (
        await cleanGit([
          "-C",
          clone,
          "rev-parse",
          "--verify",
          "--quiet",
          `${action.sha}^{commit}`,
        ]).catch(() => "")
      ).trim();
      if (commit !== action.sha) throw new Error(`${source} has no commit ${action.sha}.`);
      await cleanGit(["-C", clone, "checkout", "--quiet", "--detach", action.sha]);
      await cleanGit([
        "-C",
        clone,
        "remote",
        "set-url",
        "origin",
        cacheOrigin(options.server, action),
      ]);
      rmSync(final, { recursive: true, force: true });
      renameSync(clone, final);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}
