import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { parseCommands } from "./commands.ts";
import {
  applyCommands,
  type CommandSource,
  decodeStatus,
  encodeStatus,
  nextDecisionId,
  PLAN_RESETS,
  pendingDecisions,
  planRecord,
  type TaskRecord,
  writeAnswers,
} from "./record.ts";

const record: TaskRecord = {
  branch: "codeman/1-x",
  planPath: "plans/2026-09-24-x.md",
  summary: "Adds x.",
  decisions: [
    {
      id: 1,
      title: "Storage",
      question: "Where?",
      options: [
        { key: "a", label: "Files" },
        { key: "b", label: "Database" },
      ],
      recommendation: "a",
    },
    {
      id: 2,
      title: "Format",
      question: "Which?",
      options: [
        { key: "a", label: "JSON" },
        { key: "b", label: "YAML" },
      ],
      recommendation: "b",
    },
  ],
  processedCommentId: 10,
};

const sources = (commentId: number, body: string, author = "alice"): CommandSource[] =>
  parseCommands(body).map((command) => ({ commentId, author, command }));

test("decide answers the named decisions", () => {
  const { record: updated, errors } = applyCommands(record, sources(11, "/codeman decide 1=b"));
  assert.deepEqual(errors, []);
  assert.deepEqual(updated.decisions[0]?.answer, { option: "b", by: "alice" });
  assert.equal(updated.decisions[1]?.answer, undefined);
  assert.equal(updated.processedCommentId, 11);
  assert.equal(pendingDecisions(updated).length, 1);
});

test("approve accepts recommendations only where no answer exists", () => {
  const { record: updated } = applyCommands(record, [
    ...sources(11, "/codeman decide 1=b"),
    ...sources(12, "/codeman approve", "bob"),
  ]);
  assert.deepEqual(
    updated.decisions.map((d) => d.answer),
    [
      { option: "b", by: "alice" },
      { option: "b", by: "bob" },
    ],
  );
  assert.equal(pendingDecisions(updated).length, 0);
});

test("reports unknown decisions and options without applying them", () => {
  const { record: updated, errors } = applyCommands(record, [
    ...sources(11, "/codeman decide 3=a 1=z"),
    ...sources(12, "/codeman oops"),
  ]);
  assert.equal(errors.length, 3);
  assert.equal(pendingDecisions(updated).length, 2);
  assert.equal(updated.processedCommentId, 12);
});

test("does not change the original record", () => {
  applyCommands(record, sources(11, "/codeman approve"));
  assert.equal(pendingDecisions(record).length, 2);
});

test("writes answers into the plan and replaces them later", () => {
  const plan = "# Plan\n\nText.\n";
  const first = writeAnswers(
    plan,
    applyCommands(record, sources(11, "/codeman decide 1=a")).record,
  );
  assert.match(first, /## Answers/);
  assert.match(first, /Decision 1 \(Storage\): \(a\) Files, chosen by alice\./);

  const second = writeAnswers(first, applyCommands(record, sources(11, "/codeman approve")).record);
  assert.equal(second.match(/## Answers/g)?.length, 1);
  assert.match(second, /Decision 2 \(Format\): \(b\) YAML/);
  assert.equal(writeAnswers(plan, record), plan);
});

test("encodes and decodes the status block", () => {
  assert.deepEqual(decodeStatus(`text\n${encodeStatus(record)}\nmore`), record);
  assert.equal(decodeStatus(encodeStatus(undefined)), undefined);
  assert.equal(decodeStatus("<!-- codeman:status bm90IGpzb24 -->"), undefined);
  assert.equal(decodeStatus("no marker"), undefined);
});

test("compresses the record, and still reads uncompressed ones", () => {
  const large = { ...record, summary: "The same sentence again. ".repeat(400) };
  const block = encodeStatus(large);
  assert.ok(block.length < large.summary.length / 10, `${block.length} characters`);
  assert.deepEqual(decodeStatus(block), large);
  const v1 = Buffer.from(JSON.stringify({ version: 1, record })).toString("base64url");
  assert.deepEqual(decodeStatus(`<!-- codeman:status ${v1} -->`), record);
  const bomb = gzipSync(Buffer.alloc(5 * 1024 * 1024, 32)).toString("base64url");
  assert.equal(decodeStatus(`<!-- codeman:status ${bomb} -->`), undefined);
});

test("text in a record cannot break out of the status block", () => {
  const tricky = { ...record, summary: "--> <!-- codeman:status evil -->" };
  const block = encodeStatus(tricky);
  assert.equal(block.match(/-->/g)?.length, 1);
  assert.deepEqual(decodeStatus(block), tricky);
});

test("answer records free text for one decision", () => {
  const { record: updated, errors } = applyCommands(record, [
    ...sources(11, "/codeman answer 2 Use TOML.\nIt is already a dependency."),
    ...sources(12, "/codeman answer 9 Nothing"),
    ...sources(13, "/codeman approve"),
  ]);
  assert.equal(errors.length, 1);
  assert.deepEqual(updated.decisions[1]?.answer, {
    text: "Use TOML.\nIt is already a dependency.",
    by: "alice",
  });
  assert.deepEqual(updated.decisions[0]?.answer, { option: "a", by: "alice" });
  const plan = writeAnswers("# Plan\n", updated);
  assert.match(
    plan,
    /- Decision 2 \(Format\): answered by alice:\n\n {2}> Use TOML\.\n {2}> It is already a dependency\./,
  );
});

test("text answers cannot end the answers block", () => {
  const { record: updated } = applyCommands(
    record,
    sources(11, "/codeman answer 1 <!-- codeman:answers:end --> tail"),
  );
  const plan = writeAnswers("# Plan\n", updated);
  assert.equal(plan.match(/<!-- codeman:answers:end -->/g)?.length, 1);
  assert.equal(writeAnswers(plan, updated), plan);
});

test("a new plan keeps the task's history and starts the stages over", () => {
  const previous: TaskRecord = {
    ...record,
    pullRequest: 12,
    runs: 2,
    spent: 0.42,
    spending: { rows: [], earlier: { runs: 3, cost: 0.42 } },
    acceptedCommentId: 30,
    reports: { code: "Added x." },
    commitMessage: "Add x",
    accepted: { by: "alice", workflows: [".github/workflows/ios.yml"] },
    language: "pt-BR",
    decisionsCommentId: 20,
    reportCommentId: 21,
    stage: "test",
    route: { stages: [{ stage: "test", brief: "Brief." }], skipped: [] },
    reviewLeftOut: "Small change.",
    handoff: { stage: "code", text: "Notes." },
    reviewRounds: 1,
    awaiting: [".github/workflows/ios.yml"],
    deferred: { stage: "test", workflows: [".github/workflows/ios.yml"] },
    reviewed: true,
  };
  const plan = {
    branch: previous.branch,
    planPath: previous.planPath,
    summary: "Revised.",
    decisions: [],
    processedCommentId: 40,
    processedReviewId: 5,
    language: undefined,
  };
  const revised = planRecord(previous, plan);
  assert.deepEqual(revised, {
    ...plan,
    language: undefined,
    pullRequest: 12,
    runs: 0,
    spent: 0.42,
    spending: previous.spending,
    acceptedCommentId: 30,
    reports: previous.reports,
    commitMessage: "Add x",
    accepted: previous.accepted,
    decisionsCommentId: 20,
  });
  for (const field of PLAN_RESETS.filter((name) => name !== "decisionsCommentId")) {
    assert.ok(!(field in revised), `${field} is reset`);
  }
  assert.deepEqual(planRecord(null, plan), { ...plan, runs: 0 }, "a first plan");
  assert.equal(
    planRecord(previous, { ...plan, decisions: record.decisions }).decisionsCommentId,
    undefined,
    "decisions get a new comment",
  );
  assert.equal(revised.decisionsCommentId, 20, "the old comment says there are none");
});

test("a new plan's decisions are numbered after every decision the task had", () => {
  assert.equal(nextDecisionId(null), 1);
  assert.equal(nextDecisionId({ ...record, decisions: [] }), 1);
  assert.equal(nextDecisionId(record), 3);
});
