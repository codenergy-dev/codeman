import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeStatus, type TaskRecord } from "./record.ts";
import { renderStatus } from "./status.ts";

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

test("lists problems", () => {
  const body = renderStatus({ ...view, errors: ["Decision 3 does not exist."] });
  assert.match(body, /#### Problems/);
  assert.match(body, /Decision 3 does not exist\./);
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
