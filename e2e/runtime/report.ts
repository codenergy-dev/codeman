import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A scenario's timeline, and the report a failing scenario leaves in `e2e/.out/<scenario>/`:
 * the timeline, each job's log, what each fake recorded, the store's documents, the pods and
 * their engines, and the violations. The failure's message ends with the timeline's last events
 * and the report's path, so the reader starts from there.
 */

export interface TimelineEvent {
  /** Milliseconds since the scenario started. */
  at: number;
  kind: string;
  text: string;
}

export class Timeline {
  readonly events: TimelineEvent[] = [];
  readonly #start: number;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#start = now();
  }

  add(kind: string, text: string): void {
    this.events.push({ at: this.#now() - this.#start, kind, text });
  }

  /** The last events, one line each. */
  tail(count: number): string[] {
    return this.events.slice(-count).map(line);
  }
}

export function line(event: TimelineEvent): string {
  return `${(event.at / 1000).toFixed(1).padStart(7)}s  ${event.kind.padEnd(10)} ${event.text}`;
}

/** What a report holds, beyond the timeline; each part that could not be read says why. */
export interface ReportData {
  scenario: string;
  error: string;
  timeline: Timeline;
  /** Each job's log, by a file name such as `12-select.log`. */
  jobs: Record<string, string>;
  /** Each fake's lists, by fake and list: requests, events, keys... */
  fakes: Record<string, Record<string, unknown>>;
  /** The store's documents, by path. */
  store: Record<string, unknown>;
  /** The pods, with their engines' status and their containers' logs. */
  engine: Record<string, unknown>;
  violations: Record<string, unknown>;
}

/** How many events the failure's message shows. */
export const TAIL = 20;

/** Writes the report under `dir`, replacing an older one; returns the failure's message. */
export function writeReport(dir: string, data: ReportData, cwd = process.cwd()): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "jobs"), { recursive: true });
  mkdirSync(join(dir, "fakes"), { recursive: true });
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(dir, "timeline.txt"), `${data.timeline.events.map(line).join("\n")}\n`);
  writeFileSync(join(dir, "timeline.json"), json(data.timeline.events));
  for (const [name, log] of Object.entries(data.jobs)) {
    writeFileSync(join(dir, "jobs", safe(name)), log);
  }
  for (const [fake, lists] of Object.entries(data.fakes)) {
    for (const [list, value] of Object.entries(lists)) {
      writeFileSync(join(dir, "fakes", `${safe(fake)}-${safe(list)}.json`), json(value));
    }
  }
  writeFileSync(join(dir, "store.json"), json(data.store));
  writeFileSync(join(dir, "engine.json"), json(data.engine));
  writeFileSync(join(dir, "violations.json"), json(data.violations));
  const shown = relative(cwd, dir) || dir;
  const summary = [
    `# ${data.scenario}`,
    "",
    "## Failure",
    "",
    "```text",
    data.error,
    "```",
    "",
    "## Files",
    "",
    "- `timeline.txt`: every event, oldest first",
    "- `jobs/`: each job's log",
    "- `fakes/`: what each fake recorded",
    "- `store.json`: the store's documents",
    "- `engine.json`: the pods and their engines",
    "- `violations.json`: what the fakes refused",
    "",
  ].join("\n");
  writeFileSync(join(dir, "README.md"), summary);
  return [
    data.error,
    "",
    `The timeline's last ${Math.min(TAIL, data.timeline.events.length)} events:`,
    ...data.timeline.tail(TAIL).map((text) => `  ${text}`),
    "",
    `The report: ${shown}/`,
  ].join("\n");
}

/** A name as a file name: no separator, nothing hidden. */
function safe(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "") || "file";
}

/** What a passing scenario leaves: its timeline and its jobs' logs, for a look afterwards. */
export function writePass(dir: string, timeline: Timeline, jobs: Record<string, string>): void {
  rmSync(join(dir, "jobs"), { recursive: true, force: true });
  mkdirSync(join(dir, "jobs"), { recursive: true });
  writeFileSync(join(dir, "timeline.txt"), `${timeline.events.map(line).join("\n")}\n`);
  for (const [name, log] of Object.entries(jobs)) writeFileSync(join(dir, "jobs", safe(name)), log);
}
