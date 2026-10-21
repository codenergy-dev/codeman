import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

/**
 * The Docker CLI, as the runtime calls it: arguments only, never a shell. Values that may be
 * secrets go through the CLI's own environment, named by `-e NAME` without a value, so no
 * command line holds them.
 */

const execFileAsync = promisify(execFile);

export interface DockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `docker <args>`; never throws for an exit code. */
export async function docker(
  args: string[],
  options: { env?: Record<string, string>; timeoutMs?: number; input?: string } = {},
): Promise<DockerResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, {
      env: { ...process.env, ...options.env },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    if (options.input !== undefined) child.stdin?.end(options.input);
    const done = (exitCode: number, extra = "") => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8") + extra,
      });
    };
    child.on("error", (error) => done(127, error.message));
    child.on("close", (code) => done(code ?? 1));
  });
}

/** Runs `docker <args>`; throws, with its stderr, when it fails. */
export async function dockerOk(
  args: string[],
  options: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  const result = await docker(args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `docker ${args.slice(0, 3).join(" ")} failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout;
}

/** `-e NAME` for each variable, and the CLI's environment that holds their values. */
export function envArgs(env: Record<string, string>): {
  args: string[];
  env: Record<string, string>;
} {
  const args: string[] = [];
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (name === "" || name.includes("=") || name.includes("\0") || value.includes("\0")) {
      throw new Error(`The variable ${JSON.stringify(name)} cannot be passed to a container.`);
    }
    args.push("-e", name);
    values[name] = value;
  }
  return { args, env: values };
}

/** Removes every container with this label, running or not. */
export async function removeLabeled(label: string): Promise<string[]> {
  const ids = (await dockerOk(["ps", "-aq", "--filter", `label=${label}`]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (ids.length > 0) await docker(["rm", "-f", "-v", ...ids]);
  return ids;
}

/** The image's own `PATH`, from its configuration. */
export async function imagePath(image: string): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "image",
    "inspect",
    "--format",
    "{{json .Config.Env}}",
    image,
  ]);
  const env = JSON.parse(stdout) as string[];
  return env.find((entry) => entry.startsWith("PATH="))?.slice(5) ?? "/usr/bin:/bin";
}

export async function imageExists(image: string): Promise<boolean> {
  return (await docker(["image", "inspect", "--format", "{{.Id}}", image])).exitCode === 0;
}

/** What Docker's VM has, in bytes. */
export async function dockerMemory(): Promise<number> {
  return Number((await dockerOk(["info", "--format", "{{.MemTotal}}"])).trim());
}
