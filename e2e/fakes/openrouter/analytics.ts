import { HttpError } from "../http.ts";

/**
 * The fake OpenRouter's `POST /api/v1/analytics/query`, over the generations analytics has
 * counted: the subset of docs/web/openrouter/query-analytics-data.md and
 * openrouter-analytics-schema-discovery.md that Codeman relies on. Anything else answers 400,
 * so a query Codeman starts sending is noticed.
 */

/** One request, as billing and analytics see it. */
export interface Generation {
  id: string;
  /** The key's hash: `api_key_id` in analytics. */
  keyHash: string;
  model: string;
  /** When it finished, in milliseconds since the epoch. */
  at: number;
  /** When analytics counts it, and when the key's usage does: Infinity until settled. */
  countedAt: number;
  billedAt: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /** In USD. */
  cost: number;
  /** Completion tokens per second; null without completion tokens or a measured time. */
  throughput: number | null;
}

type Row = Record<string, string | number | null>;

const DIMENSIONS: Record<string, (generation: Generation) => string> = {
  api_key_id: (generation) => generation.keyHash,
  generation_id: (generation) => generation.id,
  model: (generation) => generation.model,
};

const METRICS: Record<string, (generations: Generation[]) => number | null> = {
  request_count: (generations) => generations.length,
  tokens_prompt: (generations) => sum(generations, (g) => g.promptTokens),
  tokens_completion: (generations) => sum(generations, (g) => g.completionTokens),
  tokens_total: (generations) => sum(generations, (g) => g.promptTokens + g.completionTokens),
  cached_tokens: (generations) => sum(generations, (g) => g.cachedTokens),
  avg_throughput: (generations) => {
    const measured = generations.flatMap((g) => (g.throughput === null ? [] : [g.throughput]));
    return measured.length > 0 ? measured.reduce((a, b) => a + b, 0) / measured.length : null;
  },
};

/** What `GET /api/v1/analytics/meta` lists: the metrics and dimensions the fake computes. */
export function meta() {
  const formats: Record<string, string> = { avg_throughput: "throughput" };
  return {
    data: {
      metrics: Object.keys(METRICS).map((name) => ({
        name,
        display_label: name,
        display_format: formats[name] ?? "number",
        is_rate: name.startsWith("avg_"),
      })),
      dimensions: Object.keys(DIMENSIONS).map((name) => ({ name, display_label: name })),
      operators: ["eq", "neq", "in", "not_in"],
      granularities: [],
    },
  };
}

/** Metrics and dimensions that cover 31 days at most ("Time Range Limits"); the rest cover 367. */
const SHORT_RANGE = new Set(["avg_throughput", "generation_id"]);
const DAY_MS = 86_400_000;
/** `YYYY-MM-DDTHH:MM:SSZ`, fractional seconds allowed: minute precision is rejected. */
export const SECONDS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The answer to a query over `generations`, as analytics has them at `now`. */
export function query(body: unknown, generations: readonly Generation[], now: number) {
  const q = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const metrics = names(q.metrics, "metrics", METRICS);
  if (metrics.length === 0) throw invalid("metrics needs at least one metric.");
  const dimensions =
    q.dimensions === undefined ? [] : names(q.dimensions, "dimensions", DIMENSIONS);
  if (dimensions.length > 2) throw invalid("dimensions takes at most 2.");
  if (q.granularity !== undefined) throw invalid("The fake supports no granularity.");

  let selected = generations.filter((generation) => generation.countedAt <= now);
  const filters = list(q.filters, "filters");
  if (filters.length > 20) throw invalid("filters takes at most 20.");
  for (const filter of filters) {
    const { field, operator, value } = (filter ?? {}) as Record<string, unknown>;
    const read = typeof field === "string" ? DIMENSIONS[field] : undefined;
    if (!read) throw invalid(`Unknown filter field ${String(field)}.`);
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    const keep: Record<string, (actual: string) => boolean> = {
      eq: (actual) => actual === String(value),
      neq: (actual) => actual !== String(value),
      in: (actual) => values.includes(actual),
      not_in: (actual) => !values.includes(actual),
    };
    const test = typeof operator === "string" ? keep[operator] : undefined;
    if (!test) throw invalid(`Unknown filter operator ${String(operator)}.`);
    selected = selected.filter((generation) => test(read(generation)));
  }

  if (q.time_range !== undefined) {
    const { start, end } = (q.time_range ?? {}) as Record<string, unknown>;
    if (
      typeof start !== "string" ||
      typeof end !== "string" ||
      !SECONDS_UTC.test(start) ||
      !SECONDS_UTC.test(end)
    ) {
      throw invalid("time_range's start and end must be ISO 8601 UTC with seconds.");
    }
    const from = Date.parse(start);
    const to = Date.parse(end);
    const days = [...metrics, ...dimensions].some((name) => SHORT_RANGE.has(name)) ? 31 : 367;
    if (to - from > days * DAY_MS) throw invalid(`The time range is at most ${days} days.`);
    // Analytics counts at seconds precision, as its range is given.
    selected = selected.filter((g) => {
      const second = Math.floor(g.at / 1000) * 1000;
      return second >= from && second <= to;
    });
  }

  const groups = new Map<string, Generation[]>();
  for (const generation of selected) {
    const key = JSON.stringify(dimensions.map((name) => DIMENSIONS[name]?.(generation)));
    groups.set(key, [...(groups.get(key) ?? []), generation]);
  }
  let rows: Row[] = [...groups.entries()].map(([key, members]) => {
    const row: Row = {};
    const values = JSON.parse(key) as string[];
    dimensions.forEach((name, index) => {
      row[name] = values[index] ?? null;
    });
    for (const name of metrics) row[name] = METRICS[name]?.(members) ?? null;
    return row;
  });

  if (q.order_by !== undefined) {
    const { field, direction = "asc" } = (q.order_by ?? {}) as Record<string, unknown>;
    if (typeof field !== "string" || ![...metrics, ...dimensions].includes(field)) {
      throw invalid("order_by's field must be a metric or a dimension of the query.");
    }
    if (direction !== "asc" && direction !== "desc") {
      throw invalid("order_by's direction is asc or desc.");
    }
    const sign = direction === "asc" ? 1 : -1;
    rows.sort((a, b) => sign * compare(a[field] ?? null, b[field] ?? null));
  }
  const limit = q.limit ?? 1000;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    throw invalid("limit must be a positive integer.");
  }
  const truncated = rows.length > limit;
  rows = rows.slice(0, limit);
  return { data: { data: rows, metadata: { row_count: rows.length, truncated } } };
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

function names(value: unknown, field: string, known: Record<string, unknown>): string[] {
  const items = list(value, field);
  for (const item of items) {
    if (typeof item !== "string" || !Object.hasOwn(known, item)) {
      throw invalid(`Unknown ${field.replace(/s$/, "")} ${String(item)}.`);
    }
  }
  return items as string[];
}

function list(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(`${field} must be a list.`);
  return value;
}

function sum(generations: Generation[], value: (generation: Generation) => number): number {
  return generations.reduce((total, generation) => total + value(generation), 0);
}

/** OpenRouter's error body (errors-and-debugging.md). */
export function orError(code: number, message: string, metadata?: Record<string, unknown>) {
  return new HttpError(code, { error: { code, message, ...(metadata ? { metadata } : {}) } });
}

function invalid(message: string): HttpError {
  return orError(400, message);
}
