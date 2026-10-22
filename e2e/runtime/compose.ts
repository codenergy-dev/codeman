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

/** What Docker's VM needs, in bytes, for a scenario with these profiles. */
export function memoryNeeded(profiles: readonly Profile[]): number {
  return MEMORY.base + profiles.reduce((sum, profile) => sum + MEMORY[profile], 0);
}

/**
 * Why Docker's memory cannot hold the scenarios, naming each one it cannot hold and what it needs;
 * undefined when it holds them all. Scenarios run one at a time, so each needs its own profiles'
 * memory, not every selected scenario's together.
 */
export function memoryProblem(
  scenarios: readonly { id: string; profiles: readonly Profile[] }[],
  total: number,
): string | undefined {
  const short = scenarios.filter((scenario) => memoryNeeded(scenario.profiles) > total);
  if (short.length === 0) return undefined;
  const gib = (bytes: number) => `${(bytes / GIB).toFixed(1)} GiB`;
  const each = short.map(
    (scenario) =>
      `${scenario.id} needs about ${gib(memoryNeeded(scenario.profiles))}, with the ${scenario.profiles.join(" and ")} profile${scenario.profiles.length > 1 ? "s" : ""}`,
  );
  return `Docker has ${gib(total)} of memory, too little for ${short.length === 1 ? "a scenario" : `${short.length} scenarios`}: ${each.join("; ")}. Raise Docker Desktop's memory (Settings, Resources) to 10 GB or more, or select scenarios without ${short.length === 1 ? "it" : "them"}.`;
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
    // Each profile alone: a session runs one scenario, and so one profile's pods, at a time.
    const problem = memoryProblem(
      profiles.map((profile) => ({ id: `The ${profile} profile`, profiles: [profile] })),
      await dockerMemory(),
    );
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
