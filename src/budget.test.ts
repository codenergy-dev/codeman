import assert from "node:assert/strict";
import { test } from "node:test";
import {
  costsByWorkflowRun,
  type LedgerRun,
  RESERVATION_MS,
  reconciledMonth,
  runLimit,
  spentBy,
  taskTotal,
  usd,
} from "./budget.ts";

test("a run gets what remains of the task budget, in cents rounded down", () => {
  assert.equal(runLimit(2, 0), 2);
  assert.equal(runLimit(2, 0.2), 1.8);
  assert.equal(runLimit(2, 0.2345), 1.76);
  assert.equal(runLimit(2, 1.9), 0.1);
  assert.equal(runLimit(2, 1.95), undefined, "below the floor");
  assert.equal(runLimit(2, 2.3), undefined, "overspent");
  assert.equal(usd(1.8), "US$ 1.80");
});

const HOUR = 3_600_000;
const NOW = new Date("2026-10-07T15:30:00Z");

/** A run of task 7 that started at `start` and closed after `minutes`, unless open. */
function run(id: string, start: string, fields: Partial<LedgerRun> = {}, minutes = 30): LedgerRun {
  const at = new Date(start);
  return {
    id,
    repository: "o/r",
    task: 7,
    workflowRun: id.split("-")[0] ?? "",
    status: "closed",
    provider: "runpod",
    start: at,
    expiresAt: new Date(at.getTime() + RESERVATION_MS),
    closedAt: fields.status === "open" ? undefined : new Date(at.getTime() + minutes * 60_000),
    ...fields,
  };
}

test("runs count their costs, open runs their limits, and a task's pod at least its cost", () => {
  const runs = [
    run("100-1-7", "2026-10-07T10:00:00Z", { provider: "openrouter", cost: 0.2 }),
    // A pod kept between two runs: its cost, 0.6, is above the runs' 0.5.
    run("101-1-7", "2026-10-07T11:00:00Z", { cost: 0.3, pod: "a", podCost: 0.3 }),
    run("102-1-7", "2026-10-07T11:40:00Z", { cost: 0.2, pod: "a", podCost: 0.6 }),
    // A pod billed below what its run counted.
    run("103-1-7", "2026-10-07T12:00:00Z", { cost: 0.4, pod: "b", podCost: 0.35 }),
    run("104-1-7", "2026-10-07T15:00:00Z", { status: "open", limit: 1 }),
    run("105-1-7", "2026-10-07T15:10:00Z", { status: "refused" }),
    run("106-1-7", "2026-10-07T15:20:00Z", { status: "failed", cost: 0 }),
    run("90-1-7", "2026-10-06T10:00:00Z", { status: "closed", cost: 0.1, carried: 0.5 }),
  ];
  assert.ok(Math.abs(spentBy(runs) - 2.3) < 1e-9);
  assert.ok(Math.abs(taskTotal(runs) - 2.8) < 1e-9, "with what the record carried");
  assert.deepEqual(costsByWorkflowRun(runs), {
    "100": 0.2,
    "101": 0.3,
    "102": 0.2,
    "103": 0.4,
    "104": 1,
    "105": 0,
    "106": 0,
    "90": 0.1,
  });
  // A run alone on its pod shows the pod's cost.
  assert.deepEqual(
    costsByWorkflowRun([
      run("101-1-7", "2026-10-07T11:00:00Z", { cost: 0.3, pod: "a", podCost: 0.36 }),
    ]),
    {
      "101": 0.36,
    },
  );
  // Another task's run on the same pod is its own.
  assert.ok(
    Math.abs(
      spentBy([
        run("101-1-7", "2026-10-07T11:00:00Z", { cost: 0.3, pod: "a", podCost: 0.6 }),
        run("101-1-8", "2026-10-07T11:00:00Z", { task: 8, cost: 0.3, pod: "a", podCost: 0.3 }),
      ]) - 0.9,
    ) < 1e-9,
  );
});

test("a run opened again after it closed counts what it spent before", () => {
  const again = run("100-1-7", "2026-10-07T10:00:00Z", {
    status: "open",
    limit: 1,
    spentBefore: 0.25,
  });
  assert.equal(spentBy([again]), 1.25);
  assert.equal(spentBy([{ ...again, status: "closed", cost: 0.1 }]), 0.35);
});

test("the organization's month: a Serverless run that just ended counts before Runpod bills it", () => {
  const ended = run("100-1-7", "2026-10-07T14:40:00Z", { cost: 0.5 }, 40);
  // Runpod has billed nothing of today yet.
  const billed = new Map([["runpod", new Map<number, number>()]]);
  assert.equal(reconciledMonth([ended], billed, NOW), 0.5);
});

test("the organization's month: an hour billed above the ledger counts its bill", () => {
  // A pod's run from 13:00 to 13:30, US$ 0.3; Runpod billed the pod's whole hour, kept after it.
  const ran = run("100-1-7", "2026-10-07T13:00:00Z", { cost: 0.3, pod: "a" }, 30);
  const hour = Date.parse("2026-10-07T13:00:00Z");
  const billed = new Map([["runpod", new Map([[hour, 0.6]])]]);
  assert.ok(Math.abs(reconciledMonth([ran], billed, NOW) - 0.6) < 1e-9);
  // An hour billed when no run of the ledger ran, such as a pod left by everyone.
  const idle = new Map([
    [
      "runpod",
      new Map([
        [hour, 0.6],
        [hour - 5 * HOUR, 0.2],
      ]),
    ],
  ]);
  assert.ok(Math.abs(reconciledMonth([ran], idle, NOW) - 0.8) < 1e-9);
});

test("the organization's month: an hour billed below the ledger counts the ledger's", () => {
  // From 12:30 to 13:30, US$ 1: half in each hour. Runpod billed 12:00 late and low.
  const ran = run("100-1-7", "2026-10-07T12:30:00Z", { cost: 1 }, 60);
  const twelve = Date.parse("2026-10-07T12:00:00Z");
  const billed = new Map([
    [
      "runpod",
      new Map([
        [twelve, 0.2],
        [twelve + HOUR, 0.9],
      ]),
    ],
  ]);
  assert.ok(Math.abs(reconciledMonth([ran], billed, NOW) - (0.5 + 0.9)) < 1e-9);
});

test("the organization's month: open runs count whole, other providers' runs as they are", () => {
  const open = run("100-1-7", "2026-10-07T15:00:00Z", { status: "open", limit: 1.5 });
  const openRouter = run("101-1-8", "2026-10-07T13:00:00Z", { provider: "openrouter", cost: 0.4 });
  // A run whose reservation expired counts its limit over its two hours.
  const expired = run("90-1-9", "2026-10-07T10:00:00Z", { status: "open", limit: 2 });
  const ten = Date.parse("2026-10-07T10:00:00Z");
  const billed = new Map([["runpod", new Map([[ten, 1.5]])]]);
  assert.ok(
    Math.abs(reconciledMonth([open, openRouter, expired], billed, NOW) - (1.5 + 0.4 + 1.5 + 1)) <
      1e-9,
  );
  // Without the account's billing, the ledger's figures alone.
  assert.ok(Math.abs(reconciledMonth([open, openRouter, expired], new Map(), NOW) - 3.9) < 1e-9);
});
