/** One request the gateway forwarded, with times in milliseconds since the epoch. */
export interface RequestRecord {
  start: number;
  /** Whether the response was streamed, token by token. */
  streamed?: boolean | undefined;
  /** When the engine's response body began: its first token, when streamed. */
  firstByte?: number | undefined;
  end?: number | undefined;
  /** Prompt tokens, cached ones included, and completion tokens, as the engine reported them. */
  input?: number | undefined;
  output?: number | undefined;
}

/**
 * How a run's cost accrues. `time`: a pod, billed every second from the run's start whether or
 * not it generates. `busy`: a Serverless worker, billed while it serves requests and for its
 * idle timeout after each, as far as samples of its state tell.
 */
export type Meter =
  | { kind: "time"; pricePerSecond: number }
  | { kind: "busy"; pricePerSecond: number; idleMs: number };

/** What a run used, in OpenRouter's terms, as the gateway measured it. */
export interface GatewayUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** The input tokens of the largest request; undefined when no request reported them. */
  maxInputTokens?: number | undefined;
  /**
   * Mean completion tokens per second over the streamed requests that generated any, from their
   * first token to their end. A plain response arrives whole, so it says nothing of speed.
   */
  tokensPerSecond?: number | undefined;
  /** The run's cost so far, in USD, as the meter estimates it. */
  cost: number;
  /** When the run started and when this was read, in milliseconds since the epoch. */
  start: number;
  end: number;
  /**
   * For a busy meter, the times a worker was billed for the run (`busySpans`): its cost is their
   * length at the meter's price.
   */
  busy?: Span[] | undefined;
}

/**
 * What a provider said of an endpoint's workers: one `running`, which is billed; one only
 * `starting`, which is not yet; or `none`.
 */
export type Workers = "running" | "starting" | "none";

/** The endpoint's workers at `at`, in milliseconds since the epoch; undefined when unknown. */
export interface WorkerSample {
  at: number;
  workers: Workers | undefined;
}

/**
 * The times a worker was billed for the run, in order: the union of each request's span, extended
 * by the idle timeout after it, less the time between two samples that both saw no worker
 * running. Requests still running count until `now`. Time no pair of samples covers, such as
 * after the last one, is unknown and counts: without samples, every span does.
 */
export function busySpans(
  records: readonly RequestRecord[],
  idleMs: number,
  now: number,
  samples: readonly WorkerSample[] = [],
): Span[] {
  const spans = merge(records.map((record): Span => [record.start, (record.end ?? now) + idleMs]));
  const unbilledSpans: Span[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as WorkerSample;
    const b = samples[i] as WorkerSample;
    if (unbilled(a) && unbilled(b)) unbilledSpans.push([a.at, b.at]);
  }
  return subtract(spans, merge(unbilledSpans));
}

/** Milliseconds a worker was billed for the run: the length of its `busySpans`. */
export function busyMs(
  records: readonly RequestRecord[],
  idleMs: number,
  now: number,
  samples: readonly WorkerSample[] = [],
): number {
  return busySpans(records, idleMs, now, samples).reduce((sum, [from, to]) => sum + to - from, 0);
}

/** A time span, from and to, in milliseconds since the epoch. */
export type Span = readonly [number, number];

/** Overlapping spans joined, in order. */
function merge(spans: Span[]): Span[] {
  const merged: [number, number][] = [];
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** What remains of `spans` outside `holes`; both in order, and neither overlapping itself. */
function subtract(spans: readonly Span[], holes: readonly Span[]): Span[] {
  const left: Span[] = [];
  let first = 0;
  for (const [from, to] of spans) {
    let start = from;
    while (first < holes.length && (holes[first] as Span)[1] <= start) first++;
    for (let i = first; i < holes.length && (holes[i] as Span)[0] < to; i++) {
      const [holeFrom, holeTo] = holes[i] as Span;
      if (holeFrom > start) left.push([start, holeFrom]);
      start = Math.max(start, holeTo);
    }
    if (start < to) left.push([start, to]);
  }
  return left;
}

/** Whether the sample saw that no worker was billed. */
function unbilled(sample: WorkerSample): boolean {
  return sample.workers === "starting" || sample.workers === "none";
}

/** The run's cost at `now`, in USD; `samples` tell a busy meter when a worker was billed. */
export function meterCost(
  meter: Meter,
  start: number,
  records: readonly RequestRecord[],
  now: number,
  samples: readonly WorkerSample[] = [],
): number {
  const ms =
    meter.kind === "time" ? Math.max(0, now - start) : busyMs(records, meter.idleMs, now, samples);
  return (ms / 1000) * meter.pricePerSecond;
}

/** A run's time on a pod, in milliseconds since the epoch; no end while it goes on. */
export interface PodRunSpan {
  id: number;
  start: number;
  end?: number | undefined;
  pricePerSecond: number;
}

/** A task that keeps the pod between its runs, from `from` until `to` (or now). */
export interface KeptSpan {
  task: string;
  from: number;
  to?: number | undefined;
}

/**
 * What each run and each keeping task owes for a pod up to `now`, in USD (decision 3 of the
 * parallel tasks plan): each second is split evenly among the runs on the pod in that second,
 * and a second without a run among the tasks that keep the pod then, at `pricePerSecond`. A
 * second that nobody uses or keeps goes to no one.
 */
export function podShares(
  runs: readonly PodRunSpan[],
  kept: readonly KeptSpan[],
  now: number,
  pricePerSecond: number,
): { runs: Map<number, number>; kept: Map<string, number> } {
  const until = (end: number | undefined) => Math.min(end ?? now, now);
  const points = new Set<number>();
  for (const run of runs) points.add(Math.min(run.start, now)).add(until(run.end));
  for (const span of kept) points.add(Math.min(span.from, now)).add(until(span.to));
  const times = [...points].sort((a, b) => a - b);
  const shares = { runs: new Map<number, number>(), kept: new Map<string, number>() };
  for (let i = 1; i < times.length; i++) {
    const from = times[i - 1] as number;
    const to = times[i] as number;
    const seconds = (to - from) / 1000;
    const on = runs.filter((run) => run.start <= from && until(run.end) >= to);
    for (const run of on) {
      const share = (seconds * run.pricePerSecond) / on.length;
      shares.runs.set(run.id, (shares.runs.get(run.id) ?? 0) + share);
    }
    if (on.length > 0) continue;
    const keepers = new Set(
      kept.filter((span) => span.from <= from && until(span.to) >= to).map((span) => span.task),
    );
    for (const task of keepers) {
      const share = (seconds * pricePerSecond) / keepers.size;
      shares.kept.set(task, (shares.kept.get(task) ?? 0) + share);
    }
  }
  return shares;
}

/** A run's billed times on a Serverless worker, and its price, for `busyShares`. */
export interface BusyRun {
  id: string;
  /** In order, and not overlapping each other. */
  busy: readonly Span[];
  pricePerSecond: number;
}

/**
 * What each run owes for a worker that several runs used at once, in USD, by run ID (decision 1
 * of the Serverless split plan): each millisecond in the billed times of several runs is split
 * evenly among them, each at its own price, as a pod's seconds are among its runs. A run alone
 * owes its billed times whole.
 */
export function busyShares(runs: readonly BusyRun[]): Map<string, number> {
  const changes: { at: number; run: BusyRun; delta: number }[] = [];
  for (const run of runs) {
    for (const [from, to] of run.busy) {
      if (to <= from) continue;
      changes.push({ at: from, run, delta: 1 }, { at: to, run, delta: -1 });
    }
  }
  changes.sort((a, b) => a.at - b.at);
  const shares = new Map(runs.map((run) => [run.id, 0]));
  const on = new Map<BusyRun, number>();
  let last = 0;
  for (const change of changes) {
    if (on.size > 0 && change.at > last) {
      const seconds = (change.at - last) / 1000;
      for (const run of on.keys()) {
        shares.set(run.id, (shares.get(run.id) ?? 0) + (seconds * run.pricePerSecond) / on.size);
      }
    }
    last = change.at;
    const count = (on.get(change.run) ?? 0) + change.delta;
    if (count > 0) on.set(change.run, count);
    else on.delete(change.run);
  }
  return shares;
}

/** Sums a run's requests as OpenRouter reports a key's. */
export function summarize(
  records: readonly RequestRecord[],
  meter: Meter,
  start: number,
  now: number,
  samples: readonly WorkerSample[] = [],
): GatewayUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let maxInputTokens: number | undefined;
  let rates = 0;
  let measured = 0;
  for (const record of records) {
    inputTokens += record.input ?? 0;
    outputTokens += record.output ?? 0;
    if (record.input !== undefined) maxInputTokens = Math.max(maxInputTokens ?? 0, record.input);
    const from = record.firstByte ?? record.start;
    if (record.streamed && record.output && record.end !== undefined && record.end > from) {
      rates += record.output / ((record.end - from) / 1000);
      measured++;
    }
  }
  return {
    requests: records.length,
    inputTokens,
    outputTokens,
    maxInputTokens,
    tokensPerSecond: measured > 0 ? rates / measured : undefined,
    cost: meterCost(meter, start, records, now, samples),
    start,
    end: now,
    ...(meter.kind === "busy" ? { busy: busySpans(records, meter.idleMs, now, samples) } : {}),
  };
}

/**
 * Reads server-sent events as they pass, a chunk at a time, and hands each `data:` payload
 * that is JSON to `onData`. Tells whether the bytes so far end between two events, where a
 * comment may be added.
 */
export class EventReader {
  #buffer = "";
  #onData: (data: unknown) => void;

  constructor(onData: (data: unknown) => void) {
    this.#onData = onData;
  }

  /** Whether the text read so far ends at an event's end. */
  get atBoundary(): boolean {
    return this.#buffer === "" && this.#ended;
  }

  #ended = true;

  feed(text: string): void {
    this.#buffer += text;
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) {
      this.#ended = line === "";
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        this.#onData(JSON.parse(payload));
      } catch {
        // Not JSON: forwarded as it is, and nothing to read from it.
      }
    }
    if (this.#buffer !== "") this.#ended = false;
  }
}
