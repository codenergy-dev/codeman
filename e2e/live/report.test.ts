import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Report } from "./report.ts";

function report(actions: boolean) {
  const lines: string[] = [];
  return { lines, report: new Report((line) => lines.push(line), actions) };
}

describe("Report", () => {
  test("masks a hidden value in GitHub Actions, once, and only there", () => {
    const actions = report(true);
    actions.report.hide("token-123456");
    actions.report.hide("token-123456");
    actions.report.hide("short");
    assert.deepEqual(actions.lines, ["::add-mask::token-123456"]);
    const local = report(false);
    local.report.hide("token-123456");
    assert.deepEqual(local.lines, []);
  });

  test("withholds a line that holds a hidden value", () => {
    const { lines, report: out } = report(false);
    out.hide("podid12345");
    out.line("ollama.start", { result: "pass", model: "x/podid12345" });
    assert.deepEqual(lines, ["[pod-check] ollama.start withheld=true"]);
  });

  test("prints a text only when its field's pattern allows it", () => {
    const { lines, report: out } = report(false);
    out.line("check", {
      result: "pass",
      gpu: "NVIDIA RTX A5000",
      engine: "llama.cpp",
      url: "https://example.com",
      size_gb: 1.23456,
      ready: true,
      skipped: undefined,
      error: "Error: with a message",
    });
    assert.deepEqual(lines, [
      '[pod-check] check result=pass gpu="NVIDIA RTX A5000" engine=withheld url=withheld size_gb=1.235 ready=true error=withheld',
    ]);
  });

  test("cleans a message of hidden values, URLs and other characters", () => {
    const { report: out } = report(false);
    out.hide("podid12345");
    assert.equal(
      out.cleanMessage("Pod podid12345 at https://podid12345-8080.proxy.runpod.net\nfailed: ✗ no"),
      "Pod [hidden] at [url] failed: no",
    );
    assert.equal(out.cleanMessage("a".repeat(500)).length, 400);
  });
});
