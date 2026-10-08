import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./i18n/en.ts";
import { ptBR } from "./i18n/pt-BR.ts";
import { GitHubActionsRuntime } from "./runtime/github-actions.ts";
import {
  addRow,
  duration,
  parseCosts,
  refreshCosts,
  type SpendRow,
  spendNotes,
  spendTable,
  spendTotals,
} from "./spend.ts";

/** Rows link GitHub Actions runs. */
const runIdOf = (url: string) => new GitHubActionsRuntime().runIdOf(url);

const row = (cost: number | undefined, run = 1): SpendRow => ({
  runUrl: `https://github.com/o/r/actions/runs/${run}`,
  at: "2026-09-28T19:40:12.345Z",
  stage: "code",
  model: "deepseek/deepseek-v4.1-flash",
  provider: "openrouter",
  cost,
  keyLimit: 1.5,
  taskBudget: 2,
  monthlyBudget: 20,
  monthSpent: 3.1,
  durationMs: 70_000,
  inputTokens: 45_712,
  outputTokens: 950,
  requests: 10,
  maxInputTokens: 9_800,
  tokensPerSecond: 52.34,
});

test("a row shows the run, its stage, model, provider, time, tokens, context, throughput, cost and limits", () => {
  const lines = spendTable(en, { rows: [row(0.0123)] });
  assert.equal(
    lines[0],
    "| Run | Stage | Model | Provider | Time | Input tokens | Output tokens | Context | Tok/s | Cost | Key limit | Task budget | Month (estimated) |",
  );
  assert.equal(
    lines[2],
    "| [2026-09-28 19:40 UTC](https://github.com/o/r/actions/runs/1) | code | `deepseek/deepseek-v4.1-flash` | OpenRouter | 1 min 10 s | 45.7K | 950 | 9.8K | 52.3 | US$ 0.012 | US$ 1.50 | US$ 2.00 | US$ 3.10 of US$ 20.00 |",
  );
  assert.equal(
    spendTable(ptBR, { rows: [row(0.0123)] })[2],
    "| [28/09/2026 19:40 UTC](https://github.com/o/r/actions/runs/1) | código | `deepseek/deepseek-v4.1-flash` | OpenRouter | 1 min 10 s | 45,7\u00a0mil | 950 | 9,8\u00a0mil | 52,3 | US$ 0,012 | US$ 1,50 | US$ 2,00 | US$ 3,10 de US$ 20,00 |",
  );
});

test("unknown values show a dash, and the model cannot break the table", () => {
  const [, , line] = spendTable(en, {
    rows: [
      {
        ...row(undefined),
        keyLimit: undefined,
        monthSpent: undefined,
        durationMs: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        requests: undefined,
        maxInputTokens: undefined,
        tokensPerSecond: undefined,
        model: "a|b`c\nd",
      },
    ],
  });
  assert.equal(
    line,
    "| [2026-09-28 19:40 UTC](https://github.com/o/r/actions/runs/1) | code | `abcd` | OpenRouter | — | — | — | — | — | — | — | US$ 2.00 | US$ 20.00 |",
  );
});

test("each row names its provider, and a row recorded before it was kept shows a dash", () => {
  const cell = (entry: SpendRow, t = en) => spendTable(t, { rows: [entry] })[2]?.split(" | ")[3];
  assert.equal(cell(row(0.1)), "OpenRouter");
  assert.equal(cell({ ...row(0.1), provider: "runpod-pod" }), "Runpod (pod)");
  assert.equal(cell({ ...row(0.1), provider: "runpod-serverless" }), "Runpod (Serverless)");
  assert.equal(cell({ ...row(0.1), provider: "runpod-serverless" }, ptBR), "Runpod (Serverless)");
  assert.equal(cell({ ...row(0.1), provider: undefined }), "—");
  // Rows recorded before providers keep their older `inference`.
  const older = (inference: string) => ({ ...row(0.1), provider: undefined, inference });
  assert.equal(cell(older("openrouter")), "OpenRouter");
  assert.equal(cell(older("pod")), "Runpod (pod)");
  assert.equal(cell(older("serverless")), "Runpod (Serverless)");
  assert.equal(cell(older("elsewhere")), "—");
  assert.equal(
    spendTable(ptBR, { rows: [row(0.1)] })[0],
    "| Rodada | Etapa | Modelo | Provedor | Tempo | Tokens de entrada | Tokens de saída | Contexto | Tok/s | Custo | Limite da chave | Orçamento da tarefa | Mês (estimado) |",
  );
});

test("the notes say how each provider of the rows is measured, once each and in a fixed order", () => {
  const old = { ...row(0.1), provider: undefined };
  const serverless = { ...row(0.1), provider: "runpod-serverless" as const };
  const pod = { ...row(0.1), provider: undefined, inference: "pod" };
  const notes = spendNotes(en, { rows: [serverless, old, row(0.1), serverless, pod] });
  assert.equal(notes.length, 4);
  assert.match(notes[0] ?? "", /^\*\*OpenRouter\*\*: a run's cost is what its key used, exact/);
  assert.match(notes[1] ?? "", /^\*\*Runpod \(pod\)\*\*: .* the task also counts its pod's time/);
  assert.match(notes[2] ?? "", /^\*\*Runpod \(Serverless\)\*\*: a run's cost is an estimate/);
  assert.match(notes[2] ?? "", /counts in the month as soon as the run ends; time a worker/);
  assert.match(notes[2] ?? "", /is split among them, and later runs refresh it\.$/);
  assert.match(
    notes[3] ?? "",
    /^\*\*Month\*\*: what the repository's runs count this month in Codeman's ledger/,
  );
  assert.deepEqual(spendNotes(en, { rows: [old], earlier: { runs: 2, cost: 0.1 } }), []);
  assert.deepEqual(spendNotes(en, undefined), []);
  const portuguese = spendNotes(ptBR, { rows: [pod] });
  assert.match(portuguese[0] ?? "", /^\*\*Runpod \(pod\)\*\*: .* o tempo do pod entre rodadas/);
  assert.match(portuguese[1] ?? "", /^\*\*Mês\*\*: o que as rodadas do repositório contam/);
  const [serverlessNote] = spendNotes(ptBR, { rows: [serverless] });
  assert.match(
    serverlessNote ?? "",
    /é dividido entre elas, e as rodadas seguintes o atualizam\.$/,
  );
});

test("the oldest rows fold into one past the limit, with their sums", () => {
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
  assert.equal(
    spendTable(en, spending)[2],
    "| Earlier runs (2) | | | | 2 min 20 s | 91.4K | 1.9K | 9.8K | 52.3 | US$ 0.300 | | | |",
  );
  const totals = spendTotals(spending);
  assert.equal(totals.runs, 4);
  assert.equal(totals.inputTokens, 4 * 45_712);
  assert.equal(totals.durationMs, 4 * 70_000);
});

test("older folded rows show a dash where they have no time or tokens", () => {
  assert.equal(
    spendTable(en, { rows: [], earlier: { runs: 3, cost: 0.2 } })[2],
    "| Earlier runs (3) | | | | — | — | — | — | — | US$ 0.200 | | | |",
  );
});

test("a last row shows what runs without a row spent", () => {
  const spending = { rows: [row(0.1)] };
  assert.equal(spendTable(en, spending, 0.1).length, 3, "nothing missing");
  assert.equal(
    spendTable(en, spending, 0.35).at(-1),
    "| Runs without a row | | | | | | | | | US$ 0.250 | | | |",
  );
});

test("a totals row sums each column, keeps the largest context and weighs throughput by requests", () => {
  const spending = addRow(
    { rows: [row(0.1, 1)] },
    { ...row(0.2, 2), requests: 30, maxInputTokens: 20_000, tokensPerSecond: 20 },
  );
  const lines = spendTable(en, spending, 0.5, { totals: true });
  assert.equal(lines.at(-2), "| Runs without a row | | | | | | | | | US$ 0.200 | | | |");
  // (52.34 × 10 + 20 × 30) ÷ 40 = 28.085
  assert.equal(
    lines.at(-1),
    "| **Total (2 runs)** | | | | 2 min 20 s | 91.4K | 1.9K | 20K | 28.1 | **US$ 0.500** | | | |",
  );
  assert.equal(spendTable(en, spending, 0.5).length, lines.length - 1, "only when asked");
  assert.equal(
    spendTable(ptBR, { rows: [row(0.1)] }, undefined, { totals: true }).at(-1),
    "| **Total (1 rodada)** | | | | 1 min 10 s | 45,7\u00a0mil | 950 | 9,8\u00a0mil | 52,3 | **US$ 0,100** | | | |",
  );
});

test("the totals row counts folded rows, and shows a dash for what no run recorded", () => {
  const spending = {
    rows: [{ ...row(0.1), tokensPerSecond: undefined }],
    earlier: { runs: 3, cost: 0.2 },
  };
  assert.equal(
    spendTable(en, spending, undefined, { totals: true }).at(-1),
    "| **Total (4 runs)** | | | | 1 min 10 s | 45.7K | 950 | 9.8K | — | **US$ 0.300** | | | |",
  );
  assert.equal(spendTable(en, undefined, undefined, { totals: true }).length, 2, "no runs, no row");
});

test("throughput without requests does not weigh in the task's mean", () => {
  const totals = spendTotals({ rows: [{ ...row(0.1), requests: undefined }, row(0.1, 2)] });
  assert.equal(totals.throughputRequests, 10);
  assert.ok(Math.abs(totals.throughputSum - 523.4) < 1e-9);
});

test("durations read as a person would say them", () => {
  assert.equal(duration(400), "0 s");
  assert.equal(duration(1_000), "1 s");
  assert.equal(duration(59_400), "59 s");
  assert.equal(duration(60_000), "1 min");
  assert.equal(duration(70_000), "1 min 10 s");
  assert.equal(duration(3_599_000), "59 min 59 s");
  assert.equal(duration(3_600_000), "1 h");
  assert.equal(duration(3_900_000), "1 h 5 min");
  assert.equal(duration(7_170_000), "2 h");
});

test("rows take the costs OpenRouter counts now, by run", () => {
  const spending = {
    rows: [row(0, 1), row(undefined, 2), row(0.02, 3), row(0.01, 4)],
    earlier: { runs: 1, cost: 0 },
  };
  const refreshed = refreshCosts(spending, { "1": 0.05, "2": 0.017, "3": 0.036 }, runIdOf);
  assert.deepEqual(
    refreshed.rows.map((entry) => entry.cost),
    [0.05, 0.017, 0.036, 0.01],
  );
  assert.deepEqual(refreshed.earlier, spending.earlier);
  assert.equal(spending.rows[0]?.cost, 0, "the record passed in is not changed");
});

test("a run with several rows keeps them as they are", () => {
  const spending = { rows: [row(0, 1), row(0.01, 1), row(0, 2)] };
  assert.deepEqual(
    refreshCosts(spending, { "1": 0.05, "2": 0.03 }, runIdOf).rows.map((entry) => entry.cost),
    [0, 0.01, 0.03],
  );
});

test("reads close-key's costs by run, and nothing from a missing or malformed output", () => {
  assert.deepEqual(parseCosts('{"100":0.05,"101":0}'), { "100": 0.05, "101": 0 });
  assert.equal(parseCosts(""), undefined, "an older workflow file");
  assert.equal(parseCosts("{}"), undefined, "the run's own key is always there");
  assert.equal(parseCosts("[0.05]"), undefined);
  assert.equal(parseCosts('{"100":"0.05"}'), undefined);
  assert.equal(parseCosts('{"100":-1}'), undefined);
  assert.equal(parseCosts('{"run":0.05}'), undefined);
});
