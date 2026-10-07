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
 * Milliseconds a worker was billed for the run: the union of each request's span, extended by
 * the idle timeout after it, less the time between two samples that both saw no worker running.
 * Requests still running count until `now`. Time no pair of samples covers, such as after the
 * last one, is unknown and counts: without samples, every span does.
 */
export function busyMs(
  records: readonly RequestRecord[],
  idleMs: number,
  now: number,
  samples: readonly WorkerSample[] = [],
): number {
  const spans = merge(records.map((record): Span => [record.start, (record.end ?? now) + idleMs]));
  let total = spans.reduce((sum, [from, to]) => sum + to - from, 0);
  let first = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as WorkerSample;
    const b = samples[i] as WorkerSample;
    if (!unbilled(a) || !unbilled(b)) continue;
    while (first < spans.length && (spans[first] as Span)[1] <= a.at) first++;
    for (let j = first; j < spans.length && (spans[j] as Span)[0] < b.at; j++) {
      const [from, to] = spans[j] as Span;
      total -= Math.max(0, Math.min(to, b.at) - Math.max(from, a.at));
    }
  }
  return total;
}

type Span = readonly [number, number];

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
