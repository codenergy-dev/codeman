import assert from "node:assert/strict";
import { test } from "node:test";
import { fixPrompt, TASK_FILE } from "../../../src/prompt.ts";
import { HttpError } from "../http.ts";
import { identify } from "./identify.ts";
import { MARKER, marker, scriptOf } from "./script.ts";
import { readResult, Session, taskFile, tools, WORKDIR } from "./session.ts";

function rejects(value: unknown, message: RegExp) {
  assert.throws(
    () => scriptOf(value),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 400 &&
      message.test((error.body as { message: string }).message),
  );
}

test("a script's steps become turns, with delay and usage on the turn after them", () => {
  const script = scriptOf({
    i1: {
      code: [
        {
          usage: { prompt: 10, completion: 2 },
          steps: [
            { delay: 50 },
            { usage: { prompt: 100, completion: 20 } },
            { write: { path: "a.ts", content: "" } },
            { bash: "npm test" },
            "hang",
            { delay: { ms: 5 } },
          ],
          fix: [{ raw: "not json" }],
          final: "Finished.",
        },
      ],
    },
  });
  const round = script.i1?.code?.[0];
  assert.ok(round);
  assert.deepEqual(
    round.steps.map((turn) => [turn.action.kind, turn.delayMs, turn.usage?.prompt]),
    [
      ["write", 50, 100],
      ["bash", 0, undefined],
      ["hang", 0, undefined],
    ],
  );
  assert.equal(round.finalDelayMs, 5);
  assert.equal(round.final, "Finished.");
  assert.deepEqual(round.usage, { prompt: 10, completion: 2 });
  assert.deepEqual(round.fix?.[0]?.action, { kind: "raw", text: "not json" });
});

test("an invalid script names the field at fault", () => {
  rejects(
    { i1: { code: [{ steps: [{ write: { content: "x" } }] }] } },
    /\$\.i1\.code\[0\]\.steps\[0\]\.write\.path/,
  );
  rejects({ i1: { deploy: [] } }, /\$\.i1\.deploy: expected a stage/);
  rejects({ i1: { plan: [{ steps: [{ jump: true }] }] } }, /steps\[0\]: expected one of/);
  rejects({ i1: { plan: [{ steps: [], usage: { prompt: -1, completion: 0 } }] } }, /usage\.prompt/);
  rejects({ "bad ref": {} }, /an issue ref/);
});

test("the marker names the scenario and the issue, and refuses what it cannot carry", () => {
  const text = marker("happy-path/openrouter-to-done", "i1");
  assert.deepEqual(MARKER.exec(text)?.slice(1), ["happy-path/openrouter-to-done", "i1"]);
  assert.throws(() => marker("two words", "i1"));
  assert.throws(() => marker("s", "-->"));
});

/** A request after the task file's read, in the main phase. */
function afterRead(file: string) {
  const session = new Session(file);
  session.messages.push(
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "c", type: "function", function: { name: "read", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "c", content: readResult(`${WORKDIR}/${TASK_FILE}`, file) },
  );
  return session;
}

test("every stage's real task file names its stage, scenario and issue", () => {
  for (const stage of ["plan", "route", "web", "design", "code", "test", "review"] as const) {
    const found = identify(afterRead(taskFile("s/one", "i7", stage)).request());
    assert.equal(found.kind, "turn", stage);
    if (found.kind !== "turn") continue;
    assert.deepEqual(
      [found.scenario, found.issue, found.stage, found.phase, found.turn, found.workdir],
      ["s/one", "i7", stage, "main", 1, WORKDIR],
    );
  }
});

test("each task file is its own run; the first turn and the fix pass are told apart", () => {
  const first = identify(afterRead(taskFile("s", "i1", "code")).request());
  const second = identify(afterRead(taskFile("s", "i1", "code")).request());
  assert.ok(first.kind === "turn" && second.kind === "turn");
  assert.notEqual(first.run, second.run);

  assert.deepEqual(identify(new Session("").request()), { kind: "start", workdir: WORKDIR });

  const session = afterRead(taskFile("s", "i1", "code"));
  session.resume(fixPrompt(["summary is longer than 2000 characters."]));
  const fix = identify(session.request());
  assert.ok(fix.kind === "turn");
  assert.deepEqual([fix.phase, fix.turn], ["fix", 0]);
});

test("OpenCode's title request, and a task without the marker", () => {
  const title = identify({
    model: "e2e-model",
    messages: [
      { role: "system", content: "You are a title generator. You output ONLY a thread title." },
      { role: "user", content: "Generate a title for this conversation:\n" },
      { role: "user", content: "Read .codeman/task.md and do exactly what it asks." },
    ],
  });
  assert.deepEqual(title, { kind: "title" });

  const file = taskFile("s", "i1", "plan").replace(/<!-- codeman-e2e[^>]*-->/, "");
  const found = identify(afterRead(file).request());
  assert.equal(found.kind, "unknown");

  const other = identify({
    model: "m",
    messages: [{ role: "user", content: "Hello." }],
    tools: tools(),
  });
  assert.equal(other.kind, "unknown");
});
