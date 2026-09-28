import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repository } from "./github.ts";
import type { WorkflowRun } from "./tasks.ts";

export const RESULTS_DIR = ".codeman/results";
export const MAX_LOG_BYTES = 64 * 1024;
export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
/** Extracted size allowed per artifact, against archives that expand without bound. */
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;

/** A file or directory name made only of safe characters. */
export function safeName(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^\.+/, "_")
      .slice(0, 100) || "_"
  );
}

/** The end of a log, where failures usually are, within `max` bytes. */
export function logTail(log: string, max = MAX_LOG_BYTES): string {
  const bytes = Buffer.from(log, "utf8");
  if (bytes.length <= max) return log;
  return `[... ${bytes.length - max} earlier bytes omitted ...]\n${bytes.subarray(bytes.length - max).toString("utf8")}`;
}

/**
 * Writes what the agent gets back from the workflows it asked for: each run's jobs and their
 * conclusions, the end of the log of each job that did not succeed, and the run's artifacts, up
 * to MAX_ARTIFACT_BYTES in total. Everything written here came from code the agent wrote, so it
 * is untrusted.
 */
export async function downloadResults(
  repo: Repository,
  runs: readonly WorkflowRun[],
  dir: string,
): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let budget = MAX_ARTIFACT_BYTES;
  const index: string[] = ["# Workflow results", ""];

  for (const run of runs) {
    const runDir = join(dir, String(run.id));
    mkdirSync(join(runDir, "logs"), { recursive: true });
    const lines = [
      `## ${run.name} (${run.path})`,
      "",
      `Conclusion: ${run.conclusion ?? "unknown"}. Run: ${run.url}`,
      "",
    ];

    for (const job of await repo.runJobs(run.id)) {
      lines.push(`- Job "${job.name}": ${job.conclusion ?? "unknown"}`);
      if (job.conclusion === "success" || job.conclusion === "skipped") continue;
      try {
        const log = logTail(await repo.jobLog(job.id));
        writeFileSync(join(runDir, "logs", `${job.id}-${safeName(job.name)}.txt`), log);
      } catch {
        lines.push("  (its log could not be downloaded)");
      }
    }

    lines.push("");
    for (const artifact of await repo.runArtifacts(run.id)) {
      const name = safeName(artifact.name);
      if (artifact.expired) {
        lines.push(`- Artifact "${name}": expired`);
      } else if (artifact.size_in_bytes > budget) {
        lines.push(`- Artifact "${name}": skipped, over the ${MAX_ARTIFACT_BYTES} byte limit`);
      } else {
        budget -= artifact.size_in_bytes;
        const target = join(runDir, "artifacts", name);
        const extracted = extract(await repo.downloadArtifact(artifact.id), target);
        lines.push(
          `- Artifact "${name}": ${extracted ? `artifacts/${name}/` : "could not be extracted"}`,
        );
      }
    }
    writeFileSync(join(runDir, "README.md"), `${lines.join("\n")}\n`);
    index.push(`- ${run.name}: ${run.conclusion ?? "unknown"}, in \`${run.id}/\``);
  }
  writeFileSync(join(dir, "README.md"), `${index.join("\n")}\n`);
}

/** Extracts a zip archive with `unzip`, refusing one that expands past the limit. */
function extract(zip: Buffer, target: string): boolean {
  mkdirSync(target, { recursive: true });
  const file = `${target}.zip`;
  writeFileSync(file, zip);
  try {
    const listing = spawnSync("unzip", ["-Z", "-t", file], { encoding: "utf8" });
    const size = Number(/([0-9]+) bytes uncompressed/.exec(listing.stdout)?.[1] ?? Number.NaN);
    if (listing.status !== 0 || !(size <= MAX_EXTRACTED_BYTES)) return false;
    // -o: overwrite; unzip keeps entries inside `target`, and never runs anything.
    return spawnSync("unzip", ["-q", "-o", file, "-d", target]).status === 0;
  } finally {
    rmSync(file, { force: true });
  }
}
