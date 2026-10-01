import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./i18n/en.ts";
import { ptBR } from "./i18n/pt-BR.ts";
import { decodeStatus, isStatusComment, type TaskRecord } from "./record.ts";
import {
  COMMENT_LIMIT,
  decisionsUrl,
  isRunComment,
  renderDecisions,
  renderRefused,
  renderRun,
  renderStatus,
  reportUrl,
  runCommentText,
} from "./status.ts";

const decision = {
  id: 1,
  title: "Storage",
  question: "Where? Ping @ceo",
  options: [
    { key: "a", label: "Files" },
    { key: "b", label: "![img](http://tracker)" },
  ],
  recommendation: "a",
};

const record: TaskRecord = {
  branch: "codeman/1-x",
  planPath: "plans/x.md",
  summary: "Adds x. @everyone <script>",
  decisions: [
    {
      id: 1,
      title: "Storage",
      question: "Where? Ping @ceo",
      options: [
        { key: "a", label: "Files" },
        { key: "b", label: "![img](http://tracker)" },
      ],
      recommendation: "a",
      answer: { option: "b", by: "alice" },
    },
  ],
  processedCommentId: 0,
};

const view = {
  t: en,
  state: "awaiting-decision" as const,
  record,
  model: "deepseek/deepseek-v4.1-flash",
  runUrl: "https://github.com/o/r/actions/runs/1",
  planUrl: "https://github.com/o/r/blob/codeman/1-x/plans/x.md",
};

test("carries the record in a hidden block", () => {
  assert.deepEqual(decodeStatus(renderStatus(view)), record);
});

test("shows decisions, recommendation, answer and how to answer", () => {
  const body = renderDecisions({ ...view, record: { ...record, decisions: [decision] } });
  assert.match(body, /^<!-- codeman:decisions -->\n### Codeman: Decisions/);
  assert.ok(!isStatusComment(body) && !isRunComment(body));
  assert.match(body, /\*\*1\. Storage\*\*/);
  assert.match(body, /- \*\*a\)\*\* Files _\(recommended\)_/);
  assert.match(body, /\/codeman decide 1 a 2 b/);
  assert.match(body, /\/codeman answer 1/);
  assert.match(body, /\/codeman replan/);
  assert.ok(!renderDecisions(view).includes("/codeman decide"), "nothing left to answer");
});

const link = (id: number) => `https://github.com/o/r/issues/1#issuecomment-${id}`;

test("the panel links the plan and the decisions, and shows no decision itself", () => {
  const body = renderStatus({
    ...view,
    record: { ...record, decisions: [decision], decisionsCommentId: 7 },
    decisionsUrl: decisionsUrl({ ...record, decisionsCommentId: 7 }, link),
  });
  assert.match(body, /### Codeman: Waiting for your decisions/);
  assert.match(
    body,
    /\[plans\/x\.md\]\(https:\/\/github\.com\/o\/r\/blob\/codeman\/1-x\/plans\/x\.md\)/,
  );
  assert.match(
    body,
    /Decisions: \[1 waiting for an answer\]\(https:\/\/github\.com\/o\/r\/issues\/1#issuecomment-7\)/,
  );
  assert.ok(!body.includes("Storage"));
  assert.ok(!body.includes("/codeman decide"));
  assert.equal(decisionsUrl(record, link), undefined);
  assert.match(renderStatus({ ...view, decisionsUrl: "https://x" }), /Decisions: \[all answered\]/);
});

test("marks the chosen option", () => {
  assert.match(renderDecisions(view), /_\(chosen by alice\)_/);
});

test("a plan that no longer has decisions says so", () => {
  const body = renderDecisions({ ...view, record: { ...record, decisions: [] } });
  assert.match(body, /The plan has no decisions now\./);
});

/** A decision as long as the largest settings allow, with twice the margin. */
const huge = (id: number, answered: boolean) => ({
  id,
  title: "T".repeat(400),
  question: "Q".repeat(3000),
  options: ["a", "b", "c", "d", "e", "f"].map((key) => ({ key, label: "L".repeat(600) })),
  recommendation: "a",
  ...(answered ? { answer: { option: "b", by: "alice" } } : {}),
});

test("the decisions comment fits GitHub's limit, keeping pending decisions first", () => {
  const decisions = Array.from({ length: 30 }, (_, index) => huge(index + 1, index < 20));
  const body = renderDecisions({ ...view, record: { ...record, decisions } });
  assert.ok(body.length <= COMMENT_LIMIT, `${body.length} characters`);
  assert.match(body, /decision\(s\) are not shown here/);
  assert.match(body, /\*\*21\. T+\*\*\n\nQ+/, "the first pending decision is shown in full");
  assert.match(body, /\/codeman decide/);

  const fewer = Array.from({ length: 12 }, (_, index) => huge(index + 1, index < 8));
  const short = renderDecisions({ ...view, record: { ...record, decisions: fewer } });
  assert.ok(short.length <= COMMENT_LIMIT);
  assert.ok(!short.includes("not shown"));
  assert.match(short, /\*\*1\. T+\*\*: \*\*b\)\*\* L+ _\(chosen by alice\)_/, "answered in short");
});

test("the panel keeps its record whole and leaves out what does not fit", () => {
  const big = { ...record, summary: "S".repeat(70_000) };
  const body = renderStatus({ ...view, record: big });
  assert.ok(body.length <= COMMENT_LIMIT);
  assert.deepEqual(decodeStatus(body), big);
  assert.match(body, /Part of this panel is not shown/);
  assert.match(body, /\[Last run\]/);
});

test("neutralizes mentions, HTML and images written by the agent", () => {
  const visible = renderStatus(view).split("\n").slice(1).join("\n");
  assert.ok(!/@everyone|@ceo/.test(visible));
  assert.ok(!/(?<!\\)<script>/.test(visible), "HTML stays escaped");
  assert.ok(!visible.includes("![img]"));
});

test("shows free-text answers as inert text", () => {
  const body = renderDecisions({
    ...view,
    record: {
      ...record,
      decisions: [{ ...decision, answer: { text: "Use @ops <b>x</b>", by: "bob" } }],
    },
  });
  assert.match(body, /Answered by bob: Use @\u200bops \\<b\\>x\\<\/b\\>/);
});

test("the panel shows what the task spent and links the last report", () => {
  const body = renderStatus({
    ...view,
    cost: { run: 0.1234, task: 0.5, budget: 2 },
    reportUrl: "https://github.com/o/r/issues/1#issuecomment-9",
  });
  assert.match(body, /Spent: US\$ 0\.50 of US\$ 2\.00 for the task/);
  assert.ok(!body.includes("this run"), "a run's cost belongs to its comment");
  assert.match(body, /\[Last report\]\(https:\/\/github\.com\/o\/r\/issues\/1#issuecomment-9\)/);
  assert.ok(!renderStatus({ ...view, cost: { budget: 2 } }).includes("Spent"));
  assert.ok(!renderStatus(view).includes("Last report"));
});

test("links the newest run comment of a record", () => {
  assert.equal(reportUrl(record, link), undefined);
  assert.equal(
    reportUrl({ ...record, reportCommentId: 9 }, link),
    "https://github.com/o/r/issues/1#issuecomment-9",
  );
});

const run = {
  t: en,
  title: "Test stage: done",
  state: "reviewing" as const,
  model: "a/b",
  runUrl: "https://github.com/o/r/actions/runs/2",
};

test("a run comment says what the run did, with its report kept inert", () => {
  const body = renderRun({
    ...run,
    message: "Tests done. Next: review.",
    report: "Changes:\n- Added @everyone ![x](http://t)\n- Fixed <b>tests</b>",
    errors: ["Decision 3 does not exist."],
    cost: { run: 0.1234, task: 0.5, budget: 2 },
  });
  assert.ok(isRunComment(body));
  assert.ok(!isStatusComment(body));
  assert.match(body, /### Codeman · Test stage: done\n\nTests done\. Next: review\./);
  assert.match(body, /\*\*Next step:\*\* the review stage\./);
  assert.match(body, /#### Report\n\nChanges:\n- Added /);
  assert.match(body, /#### Problems\n\n- Decision 3 does not exist\./);
  assert.match(body, /Spent: US\$ 0\.12 this run, US\$ 0\.50 of US\$ 2\.00 for the task/);
  assert.match(body, /\[Run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/2\)/);
  assert.ok(!body.includes("@everyone"));
  assert.ok(!body.includes("![x]"));
  assert.ok(!/(?<!\\)<b>/.test(body), "HTML stays escaped");
  assert.equal(runCommentText(body).split("\n")[0], "### Codeman · Test stage: done");
  assert.ok(!renderRun(run).includes("####"));
});

const spendRow = {
  runUrl: "https://github.com/o/r/actions/runs/2",
  at: "2026-09-28T19:40:00.000Z",
  stage: "test" as const,
  model: "a/b",
  cost: 0.1234,
  keyLimit: 1.5,
  taskBudget: 2,
  monthlyBudget: 20,
  monthSpent: 3,
  durationMs: 120_000,
  inputTokens: 12_345,
  outputTokens: 800,
};

test("the panel shows the spend table, and a run comment its own row", () => {
  const panel = renderStatus({
    ...view,
    record: { ...record, spending: { rows: [spendRow] } },
    cost: { task: 0.5, budget: 2 },
  });
  assert.match(panel, /#### Spending\n\n\| Run \| Stage/);
  assert.match(panel, /\| test \| `a\/b` \| 2 min \| 12\.3K \| 800 \| US\$ 0\.123 \|/);
  assert.match(panel, /\| Runs without a row \| \| \| \| \| \| US\$ 0\.377 \|/);
  assert.match(panel, /Spent: US\$ 0\.50 of US\$ 2\.00 for the task\./);
  assert.match(panel, /Tokens: 12\.3K input and 800 output, in 2 min of agent time\./);
  const old = {
    ...spendRow,
    durationMs: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
  };
  assert.ok(
    !renderStatus({ ...view, record: { ...record, spending: { rows: [old] } } }).includes(
      "Tokens:",
    ),
    "rows from before tokens were kept",
  );

  const body = renderRun({ ...run, spend: spendRow, cost: { run: 0.1234, task: 0.5, budget: 2 } });
  assert.match(body, /#### Cost\n\n\| Run \| Stage/);
  assert.match(
    body,
    /\| test \| `a\/b` \| 2 min \| 12\.3K \| 800 \| US\$ 0\.123 \| US\$ 1\.50 \| US\$ 2\.00 \| US\$ 3\.00 of US\$ 20\.00 \|/,
  );
  assert.ok(!body.includes("this run"), "the row shows the run's cost");
  assert.match(body, /Spent: US\$ 0\.50 of US\$ 2\.00 for the task/);
});

test("lists staged workflows with how to accept them", () => {
  const body = renderStatus({ ...view, staged: [".github/workflows/deploy.yml", "@evil"] });
  assert.match(body, /#### Workflows to review/);
  assert.match(body, /\/codeman accept-workflows/);
  assert.ok(!body.includes("- @evil"));
  assert.ok(!renderStatus(view).includes("Workflows to review"));
});

test("the panel of an issue a maintainer did not open says why, keeps the record, and is stable", () => {
  const panel = renderRefused(en, record);
  assert.equal(isStatusComment(panel), true);
  assert.deepEqual(decodeStatus(panel), record);
  assert.match(panel, /### Codeman: Not a task/);
  assert.match(panel, /opened by someone with write access/);
  // Nothing in it changes from run to run, so an unchanged panel is not written again.
  assert.equal(renderRefused(en, record), panel);
  assert.doesNotMatch(panel, /actions\/runs/);
  assert.match(renderRefused(ptBR, undefined), /### Codeman: Não é uma tarefa/);
});
