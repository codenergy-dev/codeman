import { LAYOUT, ledgerMonth } from "../store/layout.ts";
import type { Fields, Store } from "../store/store.ts";

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
          mode: "openrouter",
          ...fields,
        },
      };
    }),
  );
}
