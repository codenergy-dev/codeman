import { problem } from "./catalog.ts";

/**
 * Billing as the fake keeps it: each resource has spans of time it was billed, at a price per
 * hour, and the billing routes add them up by bucket (docs/web/runpod/get-pod-billing-history.md
 * and get-aggregated-billing-history.md). Runpod bills by the second.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A span billed at `perHour` USD; open while `end` is undefined. */
export interface Span {
  start: number;
  end?: number | undefined;
  perHour: number;
}

/** What the spans cost between `from` and `to`, an open span running until `now`. */
export function cost(spans: readonly Span[], from: number, to: number, now: number): number {
  let total = 0;
  for (const span of spans) {
    const start = Math.max(span.start, from);
    const end = Math.min(span.end ?? now, to, now);
    if (end > start) total += ((end - start) / HOUR_MS) * span.perHour;
  }
  return total;
}

export type BucketSize = "hour" | "day" | "week" | "month" | "year";
const SIZES: readonly BucketSize[] = ["hour", "day", "week", "month", "year"];

/** The start of the bucket `at` falls in, in UTC; weeks start on Monday. */
export function bucketStart(at: number, size: BucketSize): number {
  const date = new Date(at);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  switch (size) {
    case "hour":
      return at - (at % HOUR_MS);
    case "day":
      return Date.UTC(y, m, d);
    case "week":
      return Date.UTC(y, m, d) - ((date.getUTCDay() + 6) % 7) * DAY_MS;
    case "month":
      return Date.UTC(y, m, 1);
    case "year":
      return Date.UTC(y, 0, 1);
  }
}

export function nextBucket(start: number, size: BucketSize): number {
  const date = new Date(start);
  switch (size) {
    case "hour":
      return start + HOUR_MS;
    case "day":
      return start + DAY_MS;
    case "week":
      return start + 7 * DAY_MS;
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    case "year":
      return Date.UTC(date.getUTCFullYear() + 1, 0, 1);
  }
}

export interface BillingWindow {
  start: number;
  end: number;
  bucketSize: BucketSize;
  buckets: { start: number; end: number }[];
}

/**
 * A billing query's window, snapped to whole buckets: `startTime` and `endTime` together or
 * neither (30 days ago until now), and `bucketSize`, `day` by default.
 */
export function billingWindow(query: URLSearchParams, now: number): BillingWindow {
  const bucketSize = (query.get("bucketSize") ?? "day") as BucketSize;
  if (!SIZES.includes(bucketSize)) {
    throw problem(422, "bucketSize must be hour, day, week, month or year.");
  }
  if (query.has("startTime") !== query.has("endTime")) {
    throw problem(400, "startTime and endTime must be provided together");
  }
  const from = query.has("startTime")
    ? Date.parse(query.get("startTime") ?? "")
    : now - 30 * DAY_MS;
  const to = query.has("endTime") ? Date.parse(query.get("endTime") ?? "") : now;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw problem(422, "startTime and endTime must be RFC 3339 times.");
  }
  if (to < from) throw problem(400, "endTime must not be before startTime.");
  const start = bucketStart(from, bucketSize);
  const buckets: { start: number; end: number }[] = [];
  let at = start;
  while (at < to && buckets.length < 100_000) {
    const end = nextBucket(at, bucketSize);
    buckets.push({ start: at, end });
    at = end;
  }
  return { start, end: at, bucketSize, buckets };
}

/** RFC 3339 in UTC, to the second, as Runpod writes it. */
export function timestamp(at: number): string {
  return `${new Date(at).toISOString().slice(0, 19)}Z`;
}
