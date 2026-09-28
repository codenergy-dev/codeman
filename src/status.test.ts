import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeStatus, isStatusComment, type TaskRecord } from "./record.ts";
import { isRunComment, renderRun, renderStatus, reportUrl, runCommentText } from "./status.ts";

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
  const body = renderStatus({
    ...view,
    record: { ...record, decisions: [decision] },
  });
  assert.match(body, /### Codeman: Waiting for your decisions/);
  assert.match(body, /\*\*1\. Storage\*\*/);
  assert.match(body, /- \*\*a\)\*\* Files _\(recommended\)_/);
  assert.match(body, /\/codeman decide 1 a 2 b/);
  assert.match(body, /\/codeman answer 1/);
  assert.match(body, /\/codeman replan/);
  assert.match(
    body,
    /\[plans\/x\.md\]\(https:\/\/github\.com\/o\/r\/blob\/codeman\/1-x\/plans\/x\.md\)/,
  );
});

test("marks the chosen option", () => {
  assert.match(renderStatus(view), /_\(chosen by alice\)_/);
});

test("neutralizes mentions, HTML and images written by the agent", () => {
  const visible = renderStatus(view).split("\n").slice(1).join("\n");
  assert.ok(!/@everyone|@ceo/.test(visible));
  assert.ok(!visible.includes("<script>"));
  assert.ok(!visible.includes("![img]"));
});

test("shows free-text answers as inert text", () => {
  const body = renderStatus({
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
  assert.equal(reportUrl("https://github.com/o/r/issues/1", record), undefined);
  assert.equal(
    reportUrl("https://github.com/o/r/issues/1", { ...record, reportCommentId: 9 }),
    "https://github.com/o/r/issues/1#issuecomment-9",
  );
});

const run = {
  title: "Test stage",
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
  assert.match(body, /### Codeman: Test stage\n\nNow: Reviewing\./);
  assert.match(body, /#### Report\n\nChanges:\n- Added /);
  assert.match(body, /#### Problems\n\n- Decision 3 does not exist\./);
  assert.match(body, /Spent: US\$ 0\.12 this run, US\$ 0\.50 of US\$ 2\.00 for the task/);
  assert.match(body, /\[Run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/2\)/);
  assert.ok(!body.includes("@everyone"));
  assert.ok(!body.includes("![x]"));
  assert.ok(!body.includes("<b>"));
  assert.equal(runCommentText(body).split("\n")[0], "### Codeman: Test stage");
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
};

test("the panel shows the spend table, and a run comment its own row", () => {
  const panel = renderStatus({
    ...view,
    record: { ...record, spending: { rows: [spendRow] } },
    cost: { task: 0.5, budget: 2 },
  });
  assert.match(panel, /#### Spending\n\n\| Run \| Stage/);
  assert.match(panel, /\| test \| `a\/b` \| US\$ 0\.123 \|/);
  assert.match(panel, /\| Runs without a row \| \| \| US\$ 0\.377 \|/);
  assert.match(panel, /Spent: US\$ 0\.50 of US\$ 2\.00 for the task\./);

  const body = renderRun({ ...run, spend: spendRow, cost: { run: 0.1234, task: 0.5, budget: 2 } });
  assert.match(body, /#### Cost\n\n\| Run \| Stage/);
  assert.match(
    body,
    /\| test \| `a\/b` \| US\$ 0\.123 \| US\$ 1\.50 \| US\$ 2\.00 \| US\$ 3\.00 of US\$ 20\.00 \|/,
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
