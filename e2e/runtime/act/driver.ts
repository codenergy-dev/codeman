import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How the e2e runtime starts act 0.2.89 (docs/development/e2e/suite.md#under-act): the command
 * line and the process environment of one invocation, built and checked here before anything
 * runs. act's defaults are unsafe for the suite (docs/development/dependencies.md#act):
 *
 * - With no `GITHUB_TOKEN` secret, act runs `gh auth token` on the host and gives the jobs the
 *   developer's real token; it also clones an uncached action with that secret as the password.
 *   The command always passes the fake GitHub's token, act's process gets a `PATH` with no `gh`
 *   and a home with no configuration, and the action cache is checked before act starts.
 * - act reads `.env`, `.secrets`, `.vars`, `.input` and `.actrc` from its working directory, and
 *   `.actrc` and its caches from the home directory. The command names its own env, secret and
 *   variable files, outside the working directory, which must hold `.github/workflows/` only: act
 *   copies it into every job.
 * - act binds its artifact and cache servers to the LAN address, and mounts the Docker socket
 *   into the jobs. The command starts neither server, binds their addresses to 127.0.0.1 anyway,
 *   and mounts no socket.
 * - The jobs reach GitHub only through the `--env` URLs, which must name the fake's `*.localhost`
 *   host: never `--github-instance`, never github.com.
 */

/** The act release the suite audited. */
export const ACT_VERSION = "0.2.89";

/** The runtime's directory for act, ignored by git: act writes nothing in the developer's home. */
export const ACT_ROOT = fileURLToPath(new URL("../../.out/act/", import.meta.url));

/** act's directories in it, and its action cache. */
export const ACT_STATE = {
  home: join(ACT_ROOT, "home"),
  configHome: join(ACT_ROOT, "config"),
  cacheHome: join(ACT_ROOT, "cache"),
  tmp: join(ACT_ROOT, "tmp"),
  actions: join(ACT_ROOT, "actions"),
};

/** The image act runs `ubuntu-latest` jobs in. */
const PLATFORM = "ubuntu-latest";

/** Names the working directory may hold: act copies it into each job. */
const WORKDIR_ENTRIES = [".github"];

/** The variables that must point at the fake GitHub. */
const GITHUB_URLS = ["GITHUB_SERVER_URL", "GITHUB_API_URL", "GITHUB_GRAPHQL_URL"] as const;

/** Variables a command line would show to every local user: they go in the env file. */
const PRIVATE_NAMES = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
];

/** act's own directories, inside the runtime's: its home, configuration, caches and temp files. */
export interface ActState {
  home: string;
  configHome: string;
  cacheHome: string;
  tmp: string;
}

export interface ActCommandSpec {
  /** act's binary, an absolute path. */
  act: string;
  /** The empty temporary directory act runs in, holding `.github/workflows/` only. */
  workdir: string;
  /** The workflow to run, under the working directory, such as `.github/workflows/codeman.yml`. */
  workflow: string;
  /** The event's name, such as `issues` or `workflow_dispatch`. */
  event: string;
  /** Files the runtime wrote, outside the working directory. */
  files: { event: string; env: string; secrets: string; vars: string };
  /** The fake GitHub's `GITHUB_TOKEN` for this invocation: act's `secrets.GITHUB_TOKEN`. */
  token: string;
  /** The jobs' environment from the command line: URLs and IDs, never a token. */
  env: Record<string, string>;
  actor: string;
  defaultBranch: string;
  /** The job image, such as `codeman-e2e-runner:local`. */
  image: string;
  /** The Docker network of the jobs: the suite's internal one. */
  network: string;
  /** More `docker run` options for each job container, such as volumes and labels. */
  containerOptions: string[];
  /** The checked action cache (cache.ts). */
  actionCache: string;
  state: ActState;
  /** The Docker daemon act drives, such as `unix:///…/docker.sock`. */
  dockerHost: string;
}

export interface ActCommand {
  /** act's binary. */
  binary: string;
  argv: string[];
  /** act's whole process environment: nothing of the runtime's own is inherited. */
  env: Record<string, string>;
  cwd: string;
}

/** A command that would run act unsafely: it never starts. */
export class ActRefused extends Error {}

/** The job containers' hardening, as the simulator's executor and the local runner have it. */
export const JOB_CONTAINER_OPTIONS = [
  "--init",
  "--cap-add",
  "SYS_ADMIN",
  "--security-opt",
  "seccomp=unconfined",
  "--security-opt",
  "apparmor=unconfined",
];

/**
 * The checked command for one act invocation. Throws `ActRefused`, saying why, when the token, one
 * of the four files or a fake URL is missing, when the working directory holds anything but
 * `.github/workflows/`, or when a token would show on the command line.
 */
export function actCommand(spec: ActCommandSpec): ActCommand {
  const refuse = (why: string): never => {
    throw new ActRefused(`act does not start: ${why}`);
  };
  if (!isAbsolute(spec.act)) refuse(`its binary must be an absolute path, not ${spec.act}.`);
  if (!/^\S+$/.test(spec.token)) {
    refuse(
      "no GITHUB_TOKEN of the fake GitHub was given, and act would take the host's from `gh auth token`.",
    );
  }
  checkWorkdir(spec.workdir, refuse);
  for (const [name, path] of Object.entries(spec.files) as [string, string | undefined][]) {
    if (!path || !isAbsolute(path) || !existsSync(path) || !statSync(path).isFile()) {
      refuse(
        `its ${name} file is missing (${path ?? "none given"}), and act would read the working directory's.`,
      );
    }
    if (inside(spec.workdir, path as string)) {
      refuse(`its ${name} file is inside the working directory, which act copies into every job.`);
    }
  }
  for (const name of GITHUB_URLS) {
    const value = spec.env[name];
    let host = "";
    try {
      host = value ? new URL(value).hostname : "";
    } catch {
      // Refused below.
    }
    if (!host.endsWith(".localhost")) {
      refuse(
        `${name} must name the fake GitHub's *.localhost host, not ${value ?? "nothing"}: act defaults to github.com.`,
      );
    }
  }
  for (const name of Object.keys(spec.env)) {
    if (PRIVATE_NAMES.includes(name) || name.startsWith("ACT_")) {
      refuse(`${name} would show on act's command line; it goes in the env file.`);
    }
  }
  if (spec.containerOptions.some((option) => /docker\.sock/.test(option))) {
    refuse("no job may get the Docker socket.");
  }
  for (const path of Object.values(spec.state)) {
    if (!isAbsolute(path)) refuse(`its own directories must be absolute paths, not ${path}.`);
  }

  const argv = [
    spec.event,
    "--workflows",
    spec.workflow,
    "--no-recurse",
    "--eventpath",
    spec.files.event,
    "--env-file",
    spec.files.env,
    "--secret-file",
    spec.files.secrets,
    "--var-file",
    spec.files.vars,
    "--secret",
    `GITHUB_TOKEN=${spec.token}`,
    "--platform",
    `${PLATFORM}=${spec.image}`,
    "--pull=false",
    "--rm",
    "--no-cache-server",
    "--cache-server-addr",
    "127.0.0.1",
    "--artifact-server-addr",
    "127.0.0.1",
    "--container-daemon-socket",
    "-",
    "--network",
    spec.network,
    "--container-options",
    [...JOB_CONTAINER_OPTIONS, ...spec.containerOptions].map(shellQuote).join(" "),
    "--action-cache-path",
    spec.actionCache,
    "--action-offline-mode",
    "--no-skip-checkout",
    "--actor",
    spec.actor,
    "--defaultbranch",
    spec.defaultBranch,
    "--json",
    ...Object.entries(spec.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([name, value]) => ["--env", `${name}=${value}`]),
  ];
  return {
    binary: spec.act,
    argv,
    cwd: spec.workdir,
    env: {
      // No `gh` on this PATH, and a home with no configuration: act cannot find a real token.
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: spec.state.home,
      XDG_CONFIG_HOME: spec.state.configHome,
      XDG_CACHE_HOME: spec.state.cacheHome,
      TMPDIR: spec.state.tmp,
      DOCKER_HOST: spec.dockerHost,
      // act asks api.nektosact.com for notices at each start otherwise.
      ACT_DISABLE_VERSION_CHECK: "1",
    },
  };
}

/** The working directory must exist and hold `.github/workflows/` only, with no hidden files of act. */
function checkWorkdir(workdir: string, refuse: (why: string) => never): void {
  if (!isAbsolute(workdir) || !existsSync(workdir) || !statSync(workdir).isDirectory()) {
    refuse(`its working directory ${workdir} does not exist.`);
  }
  const entries = readdirSync(workdir);
  const extra = entries.filter((entry) => !WORKDIR_ENTRIES.includes(entry));
  if (extra.length > 0) {
    refuse(
      `its working directory must hold .github/workflows/ only, but it holds ${extra.join(", ")}; act reads .env, .secrets, .vars, .input and .actrc there.`,
    );
  }
  const github = join(workdir, ".github");
  const inGithub = existsSync(github) ? readdirSync(github) : [];
  if (inGithub.length !== 1 || inGithub[0] !== "workflows") {
    refuse("its working directory's .github/ must hold workflows/ only.");
  }
}

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** A word for `--container-options`, which act splits as a POSIX shell does. */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_./:=@,+-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The env, secret and variable files' text: JSON, which act reads as YAML for a `.yaml` file
 * (`readEnvsEx` in `cmd/root.go`), so a value keeps its newlines and `$` with no dotenv quoting.
 */
export function valuesFile(values: Record<string, string>): string {
  return `${JSON.stringify(values, null, 2)}\n`;
}

/** act's version, from `act --version`; refuses another than the audited one. */
export async function actVersion(act: string): Promise<string> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(act, ["--version"], {
      env: { PATH: "/usr/bin:/bin", ACT_DISABLE_VERSION_CHECK: "1", HOME: "/nonexistent" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  const version = /act version (\S+)/.exec(output)?.[1];
  if (version !== ACT_VERSION) {
    throw new ActRefused(
      `act does not start: ${act} is act ${version ?? "of no known version"}, and the suite audited ${ACT_VERSION} (docs/development/dependencies.md#act).`,
    );
  }
  return version;
}
