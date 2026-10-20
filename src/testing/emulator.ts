import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** The newest Firestore emulator in Firebase's cache, when Java can run it. */
export function emulatorJar(): string | undefined {
  const dir = join(homedir(), ".cache", "firebase", "emulators");
  if (!existsSync(dir)) return undefined;
  const jars = readdirSync(dir)
    .filter((name) => /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const newest = jars.at(-1);
  if (!newest || spawnSync("java", ["-version"], { stdio: "ignore" }).status !== 0) {
    return undefined;
  }
  return join(dir, newest);
}

/**
 * Starts an emulator from `jar` on a free port of the loopback, and waits until it answers.
 * Its `host` is `host:port`, as `FIRESTORE_EMULATOR_HOST` names one; `process` is for killing it.
 */
export async function startEmulator(
  jar: string,
  args: readonly string[] = [],
): Promise<{ host: string; process: ChildProcess }> {
  const port = await freePort();
  const emulator = spawn("java", ["-jar", jar, "--host=127.0.0.1", `--port=${port}`, ...args], {
    stdio: "ignore",
  });
  const host = `127.0.0.1:${port}`;
  for (let waited = 0; waited < 60_000; waited += 250) {
    if (emulator.exitCode !== null) throw new Error("Firestore's emulator exited at start.");
    const up = await fetch(`http://${host}/`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return { host, process: emulator };
    await sleep(250);
  }
  emulator.kill();
  throw new Error("Firestore's emulator did not start within a minute.");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No port.")),
      );
    });
  });
}
