import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hasGit } from "../../fakes/github/git.ts";
import { RecordingExecutor } from "./executor.ts";
import { writeOutputs } from "./files.ts";
import { byName, dispatch, setup } from "./testing.ts";

const skip = hasGit() ? false : "git is not on the PATH";
const PIN = "0123456789abcdef0123456789abcdef01234567";

const WORKFLOW = `on: workflow_dispatch
permissions: {}
jobs:
  make:
    runs-on: ubuntu-latest
    outputs:
      token: \${{ steps.app-token.outputs.token }}
      action: \${{ steps.codeman.outputs.action }}
    steps:
      - run: make-files
      - uses: actions/upload-artifact@${PIN}
        with:
          name: out
          path: \${{ runner.temp }}/out
          retention-days: 1
      - id: missing
        uses: actions/upload-artifact@${PIN}
        continue-on-error: true
        with:
          name: none
          path: \${{ runner.temp }}/absent
          if-no-files-found: error
      - id: app-token
        uses: actions/create-github-app-token@${PIN}
        with:
          client-id: \${{ vars.CODEMAN_GITHUB_APP_CLIENT_ID }}
          private-key: \${{ secrets.CODEMAN_GITHUB_APP_PRIVATE_KEY }}
          permission-issues: write
          permission-pull-requests: read
      - uses: actions/checkout@${PIN}
        with:
          repository: codenergy-dev/codeman
          ref: \${{ vars.CODEMAN_COMMIT_SHA }}
          path: .codeman/action
          persist-credentials: false
      - id: codeman
        uses: ./.codeman/action
        with:
          step: select
          github-token: \${{ steps.app-token.outputs.token }}
  use:
    needs: make
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${PIN}
        with:
          persist-credentials: false
      - uses: actions/download-artifact@${PIN}
        with:
          name: out
          path: \${{ runner.temp }}/in
      - id: look
        run: look
  unreadable:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${PIN}
`;

test("checkout, App tokens, artifacts and Codeman's bundle, against the fake GitHub", {
  skip,
}, async () => {
  let appToken = "";
  const executor = new RecordingExecutor((command) => {
    if (command.kind === "action") {
      appToken = command.env["INPUT_GITHUB-TOKEN"] ?? "";
      writeOutputs(command.env, { action: command.env.INPUT_STEP ?? "" });
      return undefined;
    }
    const temp = command.env.RUNNER_TEMP ?? "";
    if (command.script.startsWith("make-files")) {
      mkdirSync(join(temp, "out", "sub"), { recursive: true });
      writeFileSync(join(temp, "out", "sub", "a.txt"), "A");
      writeFileSync(join(temp, "out", ".hidden"), "H");
    }
    if (command.script.startsWith("look")) {
      writeOutputs(command.env, {
        artifact: readFileSync(join(temp, "in", "sub", "a.txt"), "utf8"),
        hidden: String(existsSync(join(temp, "in", ".hidden"))),
        readme: readFileSync(join(command.cwd, "README.md"), "utf8"),
      });
    }
    return undefined;
  });
  const { simulator, fake } = await setup({ ".github/workflows/main.yml": WORKFLOW }, executor);
  const result = await dispatch(simulator);
  const jobs = byName(result);

  const make = jobs.make;
  assert.equal(make?.result, "success", make?.log);
  assert.deepEqual(
    make?.steps.map((entry) => entry.outcome),
    ["success", "success", "failure", "success", "success", "success"],
  );
  assert.match(make?.log ?? "", /No files were found with the provided path/);
  // The App token is masked, so the job output holding it is not sent; it is revoked at the end.
  assert.deepEqual(make?.outputs, { action: "select" });
  const token = fake.world.tokens.get(appToken);
  assert.ok(token, "the bundle got the App token");
  assert.equal(token.revoked, true);
  assert.deepEqual(token.permissions, { issues: "write", pull_requests: "read" });
  // Codeman's bundle gets INPUT_* with action.yml's defaults.
  const bundle = executor.commands.find((command) => command.kind === "action");
  assert.equal(bundle?.inputs?.step, "select");
  assert.equal(bundle?.env["INPUT_KEY-EXPIRY-HOURS"], "24");
  assert.equal(bundle?.env.INPUT_HARNESS, "opencode");
  assert.match(bundle?.env.GITHUB_ACTION_PATH ?? "", /\/app\/app\/\.codeman\/action$/);

  const artifacts = fake.world.runArtifacts(fake.world.run(result.id));
  assert.deepEqual(
    artifacts.map((artifact) => artifact.name),
    ["out"],
  );
  assert.deepEqual(byName(result).use?.steps.at(-1)?.outputs, {
    artifact: "A",
    hidden: "false",
    readme: "# App\n",
  });
  // A job token without contents: read cannot check out the private repository.
  assert.equal(jobs.unreadable?.result, "failure");
  assert.match(jobs.unreadable?.log ?? "", /actions\/checkout cannot read acme\/app/);
});
