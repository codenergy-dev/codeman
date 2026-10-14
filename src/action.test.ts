import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  ACTION_ROOT,
  actionCommit,
  actionPathIn,
  TEMPLATE_VERSION,
  templateVersionProblem,
} from "./action.ts";
import { run } from "./main.ts";
import { FakePlatform, fakeServices } from "./testing/fake-platform.ts";
import { FakeRuntime } from "./testing/fake-runtime.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const dir = mkdtempSync(join(tmpdir(), "codeman-action-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("workflow files of the version the code expects run", () => {
  assert.equal(templateVersionProblem(String(TEMPLATE_VERSION), SHA), undefined);
  assert.equal(templateVersionProblem(` ${TEMPLATE_VERSION}\n`, undefined), undefined);
});

test("other workflow files fail, saying to copy the templates from the variable's commit", () => {
  const link = `https://github.com/codenergy-dev/codeman/tree/${SHA}/templates`;
  assert.equal(
    templateVersionProblem("", SHA),
    `This workflow's files pass no template version, but Codeman at commit ${SHA} expects ` +
      `version ${TEMPLATE_VERSION}. Copy templates/codeman.yml and templates/codeman-task.yml ` +
      `from the commit in CODEMAN_COMMIT_SHA (${link}) to .github/workflows/ again, keeping ` +
      "the steps you added to the agent job.",
  );
  const older = templateVersionProblem(String(TEMPLATE_VERSION - 1), SHA) ?? "";
  assert.match(older, new RegExp(`files are template version ${TEMPLATE_VERSION - 1}, but`));
  assert.ok(older.endsWith("agent job."));
  // Files newer than the code may also keep the files and move the variable back.
  const newer = templateVersionProblem(String(TEMPLATE_VERSION + 1), SHA) ?? "";
  assert.ok(newer.endsWith("; or set CODEMAN_COMMIT_SHA to the commit these files come from."));
  const unknown = templateVersionProblem("x", undefined) ?? "";
  assert.match(unknown, /but Codeman at the commit in CODEMAN_COMMIT_SHA expects/);
  assert.match(unknown, /tree\/<CODEMAN_COMMIT_SHA>\/templates/);
});

test("every step checks the version first, before its inputs", async () => {
  const platform = new FakePlatform({});
  const services = (inputs: Record<string, string>) =>
    fakeServices(platform, new FakeRuntime({ inputs }));
  await assert.rejects(run(services({ step: "select" }), SHA), /pass no template version/);
  await assert.rejects(
    run(services({ step: "nothing", "template-version": String(TEMPLATE_VERSION) }), SHA),
    /Unknown step "nothing"/,
  );
});

test("the action's commit is its checkout's detached HEAD", () => {
  const root = join(dir, "action");
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "HEAD"), `${SHA}\n`);
  assert.equal(actionCommit(root), SHA);
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  assert.equal(actionCommit(root), undefined);
  assert.equal(actionCommit(join(dir, "none")), undefined);
});

test("the action's folder is found inside the workspace, and only there", () => {
  assert.equal(actionPathIn("/w/repo", "/w/repo/.codeman/action/"), ".codeman/action");
  assert.equal(actionPathIn("/w/repo/", "/w/repo/.codeman/action"), ".codeman/action");
  assert.equal(actionPathIn("/w/repo", "/w/repo"), undefined);
  assert.equal(actionPathIn("/w/repo", "/w/_actions/codenergy-dev/codeman/abc"), undefined);
  assert.equal(actionPathIn("/w/repo", "/w/repo-other/x"), undefined);
  // In tests, the action is this repository.
  assert.equal(actionPathIn(join(ACTION_ROOT, ".."), ACTION_ROOT), ACTION_ROOT.split("/").at(-2));
});
