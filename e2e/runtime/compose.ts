import { spawn } from "node:child_process";
import { docker, dockerMemory, dockerOk } from "./docker.ts";
import type { Profile } from "./scenario/schema.ts";

/**
 * The suite's Compose project (e2e/infra/compose.yaml): started with the profiles the selected
 * scenarios need, and reused when it already runs (Compose recreates only the services whose
 * configuration changed); torn down only on request. The session's tokens go in through the
 * variables the Compose file reads.
 */

const GIB = 2 ** 30;

/**
 * What Docker's VM needs, in bytes, for each profile beyond the default one (decision 7 and
 * spike 0.1 of the e2e plan): the fakes and the emulator take about 1.5 GiB at most, an agent job
 * with OpenCode about 1 GiB, an Ollama pod 1.5 GiB, a vLLM pod about 5.5 GiB.
 */
export const MEMORY: Readonly<Record<"base" | Profile, number>> = {
  base: 2.5 * GIB,
  ollama: 1.5 * GIB,
  vllm: 5.5 * GIB,
};

/** Why Docker's memory cannot hold the profiles; undefined when it can. */
export function memoryProblem(profiles: readonly Profile[], total: number): string | undefined {
  const needed = MEMORY.base + profiles.reduce((sum, profile) => sum + MEMORY[profile], 0);
  if (total >= needed) return undefined;
  const gib = (bytes: number) => `${(bytes / GIB).toFixed(1)} GiB`;
  return `Docker has ${gib(total)} of memory, and the ${profiles.join(" and ") || "default"} profile${profiles.length > 1 ? "s need" : " needs"} about ${gib(needed)}: raise Docker Desktop's memory (Settings, Resources) to 10 GB or more, or run scenarios without ${profiles.join(", ")}.`;
}

export class Compose {
  readonly file: string;
  readonly env: Record<string, string>;

  constructor(file: string, env: Record<string, string>) {
    this.file = file;
    this.env = env;
  }

  /** `docker compose up --wait`, built from the sources, with the profiles. */
  async up(profiles: readonly Profile[], options: { build?: boolean } = {}): Promise<void> {
    const problem = memoryProblem(profiles, await dockerMemory());
    if (problem) throw new Error(problem);
    await this.#run([
      ...profiles.flatMap((profile) => ["--profile", profile]),
      "up",
      "--wait",
      "--detach",
      ...(options.build === false ? [] : ["--build"]),
    ]);
  }

  /** Builds the images of the `images` profile's services that are missing, or all with `force`. */
  async buildImages(services: string[]): Promise<void> {
    await this.#run(["--profile", "images", "build", ...services]);
  }

  async down(): Promise<void> {
    await this.#run(["--profile", "ollama", "--profile", "vllm", "down", "--remove-orphans"]);
  }

  /** Where the host reaches a service's port, such as `127.0.0.1:41234`. */
  async port(service: string, port: number): Promise<string> {
    const out = (
      await dockerOk(["compose", "-f", this.file, "port", service, String(port)], { env: this.env })
    ).trim();
    if (!out) throw new Error(`Compose publishes no port ${port} of ${service}: is it running?`);
    return out.replace(/^0\.0\.0\.0:/, "127.0.0.1:");
  }

  /** A service's container, as `docker` names it. */
  async container(service: string): Promise<string> {
    const id = (
      await dockerOk(["compose", "-f", this.file, "ps", "-q", service], { env: this.env })
    ).trim();
    if (!id) throw new Error(`No container runs ${service}.`);
    return id;
  }

  /** `docker compose <args>`, with its output on the terminal. */
  #run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["compose", "-f", this.file, ...args], {
        env: { ...process.env, ...this.env },
        stdio: ["ignore", "inherit", "inherit"],
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`docker compose ${args.join(" ")} failed (${code}).`)),
      );
    });
  }
}

/** Takes a container off a network, or puts it back with its aliases. */
export async function network(
  container: string,
  name: string,
  connected: boolean,
  aliases: string[] = [],
) {
  const result = connected
    ? await docker([
        "network",
        "connect",
        ...aliases.flatMap((alias) => ["--alias", alias]),
        name,
        container,
      ])
    : await docker(["network", "disconnect", name, container]);
  if (result.exitCode !== 0)
    throw new Error(
      `docker network ${connected ? "connect" : "disconnect"}: ${result.stderr.trim()}`,
    );
}
