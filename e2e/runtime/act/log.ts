import type { JobResultName } from "../simulator/simulator.ts";

/**
 * act's `--json` output, one logrus entry per line: each job's lines, by the `job` field act's
 * job logger adds (`WithJobLogger` in `pkg/runner/logger.go`), and its result, from the entry
 * whose `jobResult` field ends it (`setJobResult` in `pkg/runner/job_executor.go`). A job with
 * lines but no result did not end: the run was stopped. Lines that are not JSON, and entries of
 * no job, are act's own.
 */

export interface ActJob {
  /** The job's key, such as `select` (`jobID`). */
  id: string;
  /** As act names it, such as `Select tasks` or `#1/Open key`. */
  name: string;
  result: JobResultName;
  log: string;
}

export interface ActLog {
  /** The jobs that logged, in the order each first did. */
  jobs: ActJob[];
  /** Every line, readable. */
  text: string;
  /** act's own lines, of no job. */
  unattributed: string;
  /** act's own errors, of no job, such as a matrix it could not evaluate. */
  errors: string[];
}

interface Entry {
  level?: string;
  msg?: string;
  job?: string;
  jobID?: string;
  step?: string;
  stage?: string;
  jobResult?: string;
  raw_output?: boolean;
}

const RESULTS: readonly JobResultName[] = ["success", "failure", "cancelled", "skipped"];

export function parseActLog(output: string): ActLog {
  const jobs = new Map<
    string,
    { id: string; name: string; result?: JobResultName; lines: string[] }
  >();
  const all: string[] = [];
  const own: string[] = [];
  const errors: string[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    let entry: Entry | undefined;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null) entry = parsed as Entry;
    } catch {
      entry = undefined;
    }
    if (!entry) {
      all.push(line);
      own.push(line);
      continue;
    }
    const message = String(entry.msg ?? "").replace(/\n$/, "");
    const level = entry.level && entry.level !== "info" ? `${entry.level}: ` : "";
    const step = entry.step && !entry.raw_output ? `[${entry.step}] ` : "";
    const text = `${level}${step}${message}`;
    if (!entry.job) {
      all.push(text);
      own.push(text);
      if (entry.level === "error" || entry.level === "fatal")
        errors.push(message.split("\n")[0] ?? "");
      continue;
    }
    all.push(`[${entry.job.trim()}] ${text}`);
    // act pads each job's name to the longest's width.
    const name = entry.job.trim();
    const job = jobs.get(name) ?? { id: entry.jobID ?? name, name, lines: [] };
    jobs.set(name, job);
    job.lines.push(text);
    const result = entry.jobResult as JobResultName | undefined;
    if (result && RESULTS.includes(result)) job.result = result;
  }
  return {
    jobs: [...jobs.values()].map((job) => ({
      id: job.id,
      name: job.name,
      result: job.result ?? "cancelled",
      log: job.lines.join("\n"),
    })),
    text: all.join("\n"),
    unattributed: own.join("\n"),
    errors,
  };
}
