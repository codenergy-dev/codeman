import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ACCOUNTS, PROVIDERS } from "./inference/providers.ts";
import { renamedSetting } from "./settings.ts";
import { select } from "./steps/select.ts";
import { FakePlatform, fakeServices } from "./testing/fake-platform.ts";
import { FakeRuntime } from "./testing/fake-runtime.ts";

/**
 * Checks how the workflow templates fit together: `codeman.yml` calls `codeman-task.yml` once per
 * task, and each job keeps the secrets and permissions it had before parallel tasks. The
 * templates are read by indentation, without a YAML dependency.
 */
const caller = readFileSync("templates/codeman.yml", "utf8");
const task = readFileSync("templates/codeman-task.yml", "utf8");

/** The lines under the key at `path`, each key found below the one before it. */
function block(text: string, path: readonly string[]): string[] {
  let lines = text.split("\n");
  for (const key of path) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}:`).test(line));
    assert.ok(index >= 0, `no ${path.join(".")}`);
    const indent = /^\s*/.exec(lines[index] ?? "")?.[0].length ?? 0;
    const end = lines.findIndex(
      (line, at) =>
        at > index && line.trim() !== "" && (/^\s*/.exec(line)?.[0].length ?? 0) <= indent,
    );
    lines = lines.slice(index + 1, end < 0 ? undefined : end);
  }
  return lines;
}

/** The keys right under `path`, with their values. */
function entries(text: string, path: readonly string[]): Map<string, string> {
  const lines = block(text, path).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const indent = Math.min(...lines.map((line) => /^\s*/.exec(line)?.[0].length ?? 0));
  const found = new Map<string, string>();
  for (const line of lines) {
    const match = new RegExp(`^ {${indent}}([\\w-]+):\\s*(.*)$`).exec(line);
    if (match?.[1]) found.set(match[1], match[2] ?? "");
  }
  return found;
}

/** The secrets a job references. */
function secretsOf(text: string, job: string): string[] {
  const names = block(text, ["jobs", job])
    .join("\n")
    .matchAll(/secrets\.([A-Z_]+)/g);
  return [...new Set([...names].map((match) => match[1] ?? ""))].sort();
}

/** The input of `step` in a job, with its value. */
function stepInput(text: string, job: string, input: string): string | undefined {
  const line = block(text, ["jobs", job]).find((entry) => new RegExp(`^\\s*${input}:`).test(entry));
  return line?.slice(line.indexOf(":") + 1).trim();
}

const workdir = mkdtempSync(join(tmpdir(), "codeman-templates-"));
after(() => rmSync(workdir, { recursive: true, force: true }));

test("the run calls the task's workflow with each of select's task outputs, from the matrix", async () => {
  const inputs = entries(task, ["on", "workflow_call", "inputs"]);
  const passed = entries(caller, ["jobs", "task", "with"]);
  assert.deepEqual([...passed.keys()].sort(), [...inputs.keys()].sort());
  for (const [name, value] of passed) assert.equal(value, `\${{ matrix.${name} }}`);

  const platform = new FakePlatform({ ".codeman/settings.yml": "model: a/b\n" });
  platform.maintainers.add("alice");
  platform.openIssue("alice", "Add a cache", "Cache responses.");
  const runtime = new FakeRuntime({ inputs: { workdir } });
  await select(fakeServices(platform, runtime));
  const [first] = JSON.parse(runtime.outputs.tasks ?? "") as Record<string, string>[];
  assert.deepEqual(Object.keys(first ?? {}).sort(), [...inputs.keys()].sort());

  assert.equal(entries(caller, ["jobs", "task", "strategy"]).get("fail-fast"), "false");
  assert.equal(
    entries(caller, ["jobs", "task"]).get("uses"),
    "./.github/workflows/codeman-task.yml",
  );
});

test("each job keeps the secrets it had before parallel tasks, and the agent job its permissions", () => {
  const declared = entries(task, ["on", "workflow_call", "secrets"]);
  const passed = entries(caller, ["jobs", "task", "secrets"]);
  assert.deepEqual([...passed.keys()].sort(), [...declared.keys()].sort());
  for (const [name, value] of passed) assert.equal(value, `\${{ secrets.${name} }}`);

  const expected: Record<string, string[]> = {
    "open-key": [
      "CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET",
      "CODEMAN_OPENROUTER_MANAGEMENT_KEY",
      "CODEMAN_RUNPOD_API_KEY",
    ],
    agent: ["CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET", "CODEMAN_RUNPOD_SERVERLESS_KEY"],
    "close-key": ["CODEMAN_OPENROUTER_MANAGEMENT_KEY", "CODEMAN_RUNPOD_API_KEY"],
    apply: ["CODEMAN_GITHUB_APP_PRIVATE_KEY"],
    "release-pod": ["CODEMAN_RUNPOD_API_KEY"],
  };
  assert.deepEqual([...entries(task, ["jobs"]).keys()], Object.keys(expected));
  for (const [job, secrets] of Object.entries(expected)) {
    assert.deepEqual(secretsOf(task, job), secrets, job);
  }
  assert.deepEqual(secretsOf(caller, "select"), ["CODEMAN_GITHUB_APP_PRIVATE_KEY"]);
  assert.deepEqual(secretsOf(caller, "forward-review"), []);
  assert.deepEqual(secretsOf(caller, "next-run"), []);

  // No token permissions but the agent job's, and the store's OIDC token, which the call grants
  // at most.
  assert.match(task, /^permissions: \{\}$/m);
  const read = new Map([
    ["contents", "read"],
    ["actions", "read"],
  ]);
  assert.deepEqual(
    entries(caller, ["jobs", "task", "permissions"]),
    new Map([...read, ["id-token", "write"]]),
  );
  assert.deepEqual(entries(task, ["jobs", "agent", "permissions"]), read);
  assert.ok(!entries(task, ["jobs", "apply"]).has("permissions"));
});

test("each provider's secrets reach the jobs that use them, under the inputs the registry names", () => {
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    const account = ACCOUNTS[provider.account];
    assert.ok(account, name);
    for (const job of ["open-key", "close-key"]) {
      assert.equal(stepInput(task, job, account.input), `\${{ secrets.${account.secret} }}`, job);
    }
    for (const { secret, input, job } of provider.secrets) {
      assert.equal(stepInput(task, job, input), `\${{ secrets.${secret} }}`, `${name}: ${job}`);
    }
  }
});

test("the templates and the action name settings only as they are named now", () => {
  const settings = readFileSync("templates/settings.yml", "utf8");
  const action = readFileSync("action.yml", "utf8");
  for (const [file, text] of Object.entries({ caller, task, settings, action })) {
    const names = [...text.matchAll(/[a-z][a-z-]*[a-z]/g)].map((match) => match[0]);
    const old = names.filter((name) => renamedSetting(name) !== undefined && name !== "inference");
    assert.deepEqual(old, [], file);
  }
  // `inference` is the run's choice between jobs, not a setting; the settings file has none.
  assert.ok(!/^#? ?inference:/m.test(settings));
});

test("only the jobs that use Codeman's store get an OIDC token and the backend's settings", () => {
  const oidc = new Map([["id-token", "write"]]);
  const backend = new Map([
    ["firebase-project", `\${{ vars.CODEMAN_FIREBASE_PROJECT }}`],
    ["workload-identity-provider", `\${{ vars.CODEMAN_WORKLOAD_IDENTITY_PROVIDER }}`],
    ["service-account", `\${{ vars.CODEMAN_SERVICE_ACCOUNT }}`],
  ]);
  const settingsOf = (text: string, job: string) => {
    const lines = block(text, ["jobs", job]).join("\n");
    return new Map([...backend].filter(([name]) => new RegExp(`^\\s+${name}:`, "m").test(lines)));
  };
  const using: [string, string][] = [
    [caller, "select"],
    [task, "open-key"],
    [task, "close-key"],
    [task, "release-pod"],
  ];
  for (const [text, job] of using) {
    assert.deepEqual(entries(text, ["jobs", job, "permissions"]), oidc, job);
    const lines = block(text, ["jobs", job]);
    for (const [name, value] of backend) {
      assert.ok(lines.includes(`          ${name}: ${value}`), `${job} passes ${name}`);
    }
  }
  for (const job of ["agent", "apply"]) {
    assert.ok(!block(task, ["jobs", job]).join("\n").includes("id-token"), job);
    assert.deepEqual(settingsOf(task, job), new Map(), job);
  }
  for (const job of ["forward-review", "next-run"]) {
    assert.ok(!block(caller, ["jobs", job]).join("\n").includes("id-token"), job);
  }
  // The run's document in the ledger reaches the jobs that add to it.
  for (const job of ["open-key", "close-key", "release-pod"]) {
    assert.ok(
      block(task, ["jobs", job]).includes(`          ledger-run: \${{ inputs.ledger-run }}`),
    );
  }
  assert.ok(
    block(task, ["jobs", "close-key"]).includes(
      `          agent-job-result: \${{ needs.agent.result }}`,
    ),
  );
});

test("each task's jobs read its own context and result, and mark it for next-run", () => {
  for (const job of ["open-key", "agent", "apply"]) {
    assert.ok(block(task, ["jobs", job]).includes(`          task: \${{ inputs.task }}`), job);
  }
  const agent = block(task, ["jobs", "agent"]).join("\n");
  const apply = block(task, ["jobs", "apply"]).join("\n");
  assert.match(agent, /name: codeman-result-\$\{\{ inputs\.task \}\}/);
  assert.match(apply, /name: codeman-result-\$\{\{ inputs\.task \}\}/);
  assert.match(
    apply,
    /if: steps\.codeman\.outputs\.chain == 'true'\n\s+with:\n\s+name: codeman-chain-\$\{\{ inputs\.task \}\}\n\s+path: \$\{\{ runner\.temp \}\}\/codeman\/chain\n/,
  );
  const next = block(caller, ["jobs", "next-run"]).join("\n");
  assert.match(next, /select\(startswith\("codeman-chain-"\)\)/);
  assert.match(next, /needs: \[select, task\]/);
});
