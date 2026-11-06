import { execFileSync } from "node:child_process";
import { ACTION_ROOT } from "../../src/action.ts";
import { podCheck } from "./check.ts";

/**
 * `node e2e/live/pod.ts [--gpu=auto|<id>] [--community=true|false]
 * [--checks=ollama,vllm,blocked,unfit] [--ollama-model=<name>] [--vllm-model=<id>]
 * [--max-minutes=<n>] [--cleanup]`, with the Runpod key in
 * `CODEMAN_RUNPOD_API_KEY`: starts real pods on Runpod, which costs money. Each option may come
 * from its environment variable instead (`CODEMAN_POD_CHECK_GPU`, ...). See
 * docs/development/e2e/suite.md#the-pod-check.
 *
 * SIGINT and SIGTERM stop the check, which terminates its pods before it exits; so do its max
 * minutes. Exits 0 when every check and the cleanup pass, 1 otherwise, 2 on a wrong input.
 */

const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  // Kept for every signal: a second one must not kill the process before its pods are gone.
  process.on(signal, () => stop.abort());
}
// An error no part of the check awaited: its message and stack may name a pod or a URL, so they
// are not printed. The check stops, and terminates its pods, as on a signal.
let stray = false;
const strayError = () => {
  stray = true;
  stop.abort();
};
process.on("uncaughtException", strayError);
process.on("unhandledRejection", strayError);

const code = await podCheck({
  argv: process.argv.slice(2),
  env: process.env,
  write: (line) => console.log(line),
  git: () =>
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ACTION_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  signal: stop.signal,
}).catch(() => {
  console.log("[pod-check] done result=fail");
  return 1;
});
if (stray) console.log("[pod-check] stray-error result=fail");
// Work that lost the race to a stop may still wait on a pod: it is not waited for.
process.exit(stray && code === 0 ? 1 : code);
