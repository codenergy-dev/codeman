/** One request the gateway forwarded, with times in milliseconds since the epoch. */
export interface RequestRecord {
  start: number;
  /** When the engine's response body began. */
  firstByte?: number | undefined;
  end?: number | undefined;
  /** Prompt tokens, cached ones included, and completion tokens, as the engine reported them. */
  input?: number | undefined;
  output?: number | undefined;
}

/**
 * How a run's cost accrues. `time`: a pod, billed every second from the run's start whether or
 * not it generates. `busy`: a Serverless worker, billed while it serves requests and for its
 * idle timeout after each.
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
  /** Mean completion tokens per second over the requests that generated any. */
  tokensPerSecond?: number | undefined;
  /** The run's cost so far, in USD, as the meter estimates it. */
  cost: number;
  /** When the run started and when this was read, in milliseconds since the epoch. */
  start: number;
  end: number;
}

/**
 * Milliseconds a worker was up: the union of each request's span, extended by the idle timeout
 * after it. Requests still running count until `now`.
 */
export function busyMs(records: readonly RequestRecord[], idleMs: number, now: number): number {
  const spans = records
    .map((record) => [record.start, (record.end ?? now) + idleMs] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let from: number | undefined;
  let to = 0;
  for (const [start, end] of spans) {
    if (from === undefined || start > to) {
      if (from !== undefined) total += to - from;
      from = start;
      to = end;
    } else {
      to = Math.max(to, end);
    }
  }
  return from === undefined ? 0 : total + to - from;
}

/** The run's cost at `now`, in USD. */
export function meterCost(
  meter: Meter,
  start: number,
  records: readonly RequestRecord[],
  now: number,
): number {
  const ms = meter.kind === "time" ? Math.max(0, now - start) : busyMs(records, meter.idleMs, now);
  return (ms / 1000) * meter.pricePerSecond;
}

/** Sums a run's requests as OpenRouter reports a key's. */
export function summarize(
  records: readonly RequestRecord[],
  meter: Meter,
  start: number,
  now: number,
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
    if (record.output && record.end !== undefined && record.end > from) {
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
    cost: meterCost(meter, start, records, now),
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
