import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./i18n/en.ts";
import { addRow, type SpendRow, spendTable } from "./spend.ts";

const row = (cost: number | undefined, run = 1): SpendRow => ({
  runUrl: `https://github.com/o/r/actions/runs/${run}`,
  at: "2026-09-28T19:40:12.345Z",
  stage: "code",
  model: "deepseek/deepseek-v4.1-flash",
  cost,
  keyLimit: 1.5,
  taskBudget: 2,
  monthlyBudget: 20,
  monthSpent: 3.1,
});

test("a row shows the run, its stage, model, cost and limits", () => {
  const lines = spendTable(en, { rows: [row(0.0123)] });
  assert.equal(
    lines[0],
    "| Run | Stage | Model | Cost | Key limit | Task budget | Monthly budget |",
  );
  assert.equal(
    lines[2],
    "| [2026-09-28 19:40 UTC](https://github.com/o/r/actions/runs/1) | code | `deepseek/deepseek-v4.1-flash` | US$ 0.012 | US$ 1.50 | US$ 2.00 | US$ 3.10 of US$ 20.00 |",
  );
});

test("unknown values show a dash, and the model cannot break the table", () => {
  const [, , line] = spendTable(en, {
    rows: [
      {
        ...row(undefined),
        keyLimit: undefined,
        monthSpent: undefined,
        model: "a|b`c\nd",
      },
    ],
  });
  assert.equal(
    line,
    "| [2026-09-28 19:40 UTC](https://github.com/o/r/actions/runs/1) | code | `abcd` | — | — | US$ 2.00 | US$ 20.00 |",
  );
});

test("the oldest rows fold into one past the limit", () => {
  let spending = addRow(undefined, row(0.1, 1), 2);
  spending = addRow(spending, row(0.2, 2), 2);
  spending = addRow(spending, row(0.3, 3), 2);
  spending = addRow(spending, row(undefined, 4), 2);
  assert.deepEqual(
    spending.rows.map((entry) => entry.runUrl.slice(-1)),
    ["3", "4"],
  );
  assert.equal(spending.earlier?.runs, 2);
  assert.ok(Math.abs((spending.earlier?.cost ?? 0) - 0.3) < 1e-9);
  assert.match(spendTable(en, spending)[2] ?? "", /^\| Earlier runs \(2\) \| \| \| US\$ 0\.300 \|/);
});

test("a last row shows what runs without a row spent", () => {
  const spending = { rows: [row(0.1)] };
  assert.equal(spendTable(en, spending, 0.1).length, 3, "nothing missing");
  assert.equal(
    spendTable(en, spending, 0.35).at(-1),
    "| Runs without a row | | | US$ 0.250 | | | |",
  );
});
