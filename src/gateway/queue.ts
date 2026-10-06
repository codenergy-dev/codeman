import type { Upstream, UpstreamResponse } from "./gateway.ts";

/** How often the gateway asks for a job's new output: Runpod's SDK asks every second. */
const POLL_MS = 500;
/** Polls that may fail in a row, as on a network blip, before the request fails. */
const MAX_POLL_FAILURES = 5;
/** A job may run as long as a generation can take; a forgotten one leaves the queue within the hour. */
const POLICY = { executionTimeout: 30 * 60_000, ttl: 60 * 60_000 };
const FINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);

type Fetch = typeof fetch;

export interface QueueOptions {
  fetch?: Fetch;
  pollMs?: number;
  log?: (message: string) => void;
}

interface StreamPage {
  status?: string;
  stream?: { output?: unknown }[];
  error?: unknown;
}

/**
 * A Runpod Serverless endpoint's job queue, as the gateway's way to the vLLM worker: each request
 * becomes a job (`/run`), whose output the gateway reads (`/stream`) until the job ends. A job
 * waits in the queue as long as no worker serves it, unlike the OpenAI-compatible route, which
 * gave up after 5 minutes; and a job nobody waits for anymore is cancelled (`/cancel`), so it
 * neither runs later nor piles up. See docs/web/runpod/operation-reference.md.
 */
export class RunpodQueue {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: Fetch;
  readonly #pollMs: number;
  readonly #log: (message: string) => void;
  /** Jobs submitted and not over yet. */
  readonly #active = new Set<string>();
  readonly #cancels = new Set<Promise<void>>();

  /** `base` is the endpoint's API, `https://api.runpod.ai/v2/<endpoint-id>`. */
  constructor(base: string, key: string, options: QueueOptions = {}) {
    this.#base = base;
    this.#key = key;
    this.#fetch = options.fetch ?? fetch;
    this.#pollMs = options.pollMs ?? POLL_MS;
    this.#log = options.log ?? (() => {});
  }

  /** Cancels the jobs not over yet, as when the run ends, and waits for every cancellation. */
  async settle(): Promise<void> {
    for (const id of this.#active) this.#cancel(id);
    await Promise.all([...this.#cancels]);
  }

  readonly send: Upstream = async (request) => {
    // The vLLM worker takes an OpenAI-compatible request as `openai_route` and `openai_input`.
    const input =
      request.body === undefined
        ? { openai_route: request.path }
        : { openai_route: request.path, openai_input: JSON.parse(request.body) as unknown };
    const submitted = await this.#call("POST", "/run", request.signal, { input, policy: POLICY });
    if (!submitted.ok) return failed(submitted.status, await submitted.text());
    const id = ((await submitted.json()) as { id?: unknown }).id;
    if (typeof id !== "string") return failed(502, "Runpod did not return the job's ID.");
    this.#active.add(id);

    try {
      // The answer starts with the job's first output, or its end.
      let page = await this.#poll(id, request.signal);
      let outputs = (page.stream ?? []).map((chunk) => chunk.output);
      while (outputs.length === 0 && !this.#ended(id, page)) {
        await sleep(this.#pollMs, request.signal);
        page = await this.#poll(id, request.signal);
        outputs = (page.stream ?? []).map((chunk) => chunk.output);
      }
      const first = outputs[0];
      if (first === undefined) return failed(502, jobFailure(id, page));
      if (isError(first)) {
        if (!this.#ended(id, page)) this.#cancel(id);
        return failed(502, JSON.stringify(first));
      }
      return {
        status: 200,
        contentType: typeof first === "string" ? "text/event-stream" : "application/json",
        body: this.#body(id, request.signal, outputs, page),
      };
    } catch (error) {
      this.#cancel(id);
      throw error;
    }
  };

  /** Whether the job is over, as `page` says; it then leaves the active jobs. */
  #ended(id: string, page: StreamPage): boolean {
    const ended = FINAL.has(page.status ?? "");
    if (ended) this.#active.delete(id);
    return ended;
  }

  /** The job's outputs, read until it ends; a job left unfinished is cancelled. */
  async *#body(
    id: string,
    signal: AbortSignal,
    first: unknown[],
    firstPage: StreamPage,
  ): AsyncGenerator<string> {
    try {
      let outputs = first;
      let page = firstPage;
      for (;;) {
        for (const output of outputs) {
          if (isError(output)) throw new Error(`The worker failed: ${JSON.stringify(output)}`);
          yield typeof output === "string" ? output : JSON.stringify(output);
        }
        if (this.#ended(id, page)) {
          if (page.status !== "COMPLETED") throw new Error(jobFailure(id, page));
          return;
        }
        await sleep(this.#pollMs, signal);
        page = await this.#poll(id, signal);
        outputs = (page.stream ?? []).map((chunk) => chunk.output);
      }
    } finally {
      this.#cancel(id);
    }
  }

  /** The job's new output; a few failures in a row are tolerated. */
  async #poll(id: string, signal: AbortSignal): Promise<StreamPage> {
    for (let failures = 1; ; failures++) {
      let problem: string;
      try {
        const response = await this.#call("GET", `/stream/${encodeURIComponent(id)}`, signal);
        if (response.ok) return (await response.json()) as StreamPage;
        problem = `${response.status}: ${(await response.text()).slice(0, 500)}`;
        // An unknown job does not come back.
        if (response.status === 404) failures = MAX_POLL_FAILURES;
      } catch (error) {
        if (signal.aborted) throw error;
        problem = error instanceof Error ? error.message : String(error);
      }
      if (failures >= MAX_POLL_FAILURES) throw new Error(`Runpod GET /stream failed: ${problem}`);
      await sleep(this.#pollMs, signal);
    }
  }

  /**
   * Cancels a job nobody waits for, unless it is over: Runpod drops it from the queue, or stops
   * it. Once only.
   */
  #cancel(id: string): void {
    if (!this.#active.delete(id)) return;
    const cancel = this.#call(
      "POST",
      `/cancel/${encodeURIComponent(id)}`,
      AbortSignal.timeout(10_000),
    )
      .then(async (response) => {
        if (!response.ok) {
          this.#log(`Runpod did not cancel job ${id}: ${response.status}.`);
        }
        await response.body?.cancel();
      })
      .catch((error: unknown) => {
        this.#log(
          `Runpod did not cancel job ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        this.#cancels.delete(cancel);
      });
    this.#cancels.add(cancel);
  }

  #call(method: string, path: string, signal: AbortSignal, body?: unknown): Promise<Response> {
    return this.#fetch(`${this.#base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }
}

/** The worker's error: `{"error": {...}}`, its only output. */
function isError(output: unknown): boolean {
  return typeof output === "object" && output !== null && "error" in output;
}

function jobFailure(id: string, page: StreamPage): string {
  const why = page.error === undefined ? "" : `: ${String(page.error).slice(0, 500)}`;
  return page.status === "COMPLETED"
    ? `Runpod job ${id} completed without output.`
    : `Runpod job ${id} ended ${page.status ?? "without a status"}${why}.`;
}

function failed(status: number, text: string): UpstreamResponse {
  return {
    status,
    contentType: "application/json",
    body: (async function* () {
      yield JSON.stringify({ error: { message: text.slice(0, 4000), type: "upstream_error" } });
    })(),
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
