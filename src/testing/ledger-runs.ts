import type { Span } from "../gateway/usage.ts";
import { Ledger } from "../ledger.ts";
import { LAYOUT, ledgerMonth } from "../store/layout.ts";
import type { Fields, Store } from "../store/store.ts";
import { FakeRuntime } from "./fake-runtime.ts";

/**
 * Writes runs to the ledger of `owner`, by run ID, as the jobs would have: picked this month by
 * `select` for an OpenRouter run of the repository `o/r`, unless `fields` say otherwise.
 */
export async function seedRuns(
  store: Store,
  runs: Record<string, Fields>,
  owner = "o",
  now = new Date(),
): Promise<void> {
  await store.write(
    Object.entries(runs).map(([id, fields]) => {
      const [workflowRun = "", attempt = "1", task = "0"] = id.split("-");
      return {
        op: "set" as const,
        path: LAYOUT.run(owner, id),
        fields: {
          repository: "o/r",
          task: Number(task),
          workflowRun,
          attempt: Number(attempt),
          month: ledgerMonth(now),
          status: "picked",
          pickedAt: now,
          provider: "openrouter",
          ...fields,
        },
      };
    }),
  );
}

/** When the Serverless runs of the tests start: 2026-10-07 at noon (UTC). */
export const NOON = Date.parse("2026-10-07T12:00:00Z");

/** A span from `from` to `to` minutes after noon. */
export function minutes(from: number, to: number): Span {
  return [NOON + from * 60_000, NOON + to * 60_000];
}

/** A Serverless run of the repository `owner/<name>` on endpoint `ep1`, open since `reservedAt`. */
export function serverlessRun(name: string, reservedAt: number): Fields {
  return {
    repository: `codenergy/${name}`,
    provider: "runpod-serverless",
    status: "open",
    limit: 1,
    reservedAt: new Date(reservedAt),
  };
}

/**
 * Closes a Serverless run of the organization `codenergy`'s repository `name`, as `close-key`
 * does at `at`: its worker on endpoint `ep1` was billed for it during `spans`, at US$ 0.001 a
 * second. Returns the job's runtime, for its logs.
 */
export async function closeOnEndpoint(
  store: Store,
  run: string,
  name: string,
  spans: Span[],
  at: number,
): Promise<FakeRuntime> {
  const runtime = new FakeRuntime({
    repository: { owner: "Codenergy", name },
    runId: run.split("-")[0],
  });
  const ledger = new Ledger(
    store,
    { runtime, job: "close-key" },
    { now: () => new Date(at), wait: async () => undefined },
  );
  const seconds = spans.reduce((sum, [from, to]) => sum + to - from, 0) / 1000;
  ledger.close(
    run,
    { cost: seconds * 0.001, busy: { endpoint: "ep1", pricePerSecond: 0.001, spans } },
    "success",
  );
  await ledger.flush(runtime);
  return runtime;
}
