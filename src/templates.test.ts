import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { TEMPLATE_VERSION } from "./action.ts";
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

test("the agent job's timeout comes from the settings, and open-key reserves past it", () => {
  assert.equal(
    entries(task, ["jobs", "agent"]).get("timeout-minutes"),
    `\${{ fromJSON(inputs.agent-job-minutes) }}`,
  );
  assert.equal(
    stepInput(task, "open-key", "agent-job-minutes"),
    `\${{ inputs.agent-job-minutes }}`,
  );
  // The agent's time is a setting the agent step reads from the task, not an input.
  assert.equal(stepInput(task, "agent", "agent-minutes"), undefined);
  assert.doesNotMatch(readFileSync("action.yml", "utf8"), /^ {2}agent-minutes:$/m);
});

test("each job keeps the secrets it had before parallel tasks, and the agent job its permissions", () => {
  const declared = entries(task, ["on", "workflow_call", "secrets"]);
  const passed = entries(caller, ["jobs", "task", "secrets"]);
  assert.deepEqual([...passed.keys()].sort(), [...declared.keys()].sort());
  for (const [name, value] of passed) assert.equal(value, `\${{ secrets.${name} }}`);

  const expected: Record<string, string[]> = {
    "open-key": [
      "CODEMAN_KEY_ENCRYPTION_SECRET",
      "CODEMAN_OPENROUTER_MANAGEMENT_KEY",
      "CODEMAN_RUNPOD_API_KEY",
    ],
    agent: ["CODEMAN_KEY_ENCRYPTION_SECRET", "CODEMAN_RUNPOD_SERVERLESS_KEY"],
    "close-key": ["CODEMAN_OPENROUTER_MANAGEMENT_KEY", "CODEMAN_RUNPOD_API_KEY"],
    apply: ["CODEMAN_GITHUB_APP_PRIVATE_KEY"],
    "release-pod": ["CODEMAN_RUNPOD_API_KEY"],
  };
  assert.deepEqual([...entries(task, ["jobs"]).keys()], Object.keys(expected));
  for (const [job, secrets] of Object.entries(expected)) {
    assert.deepEqual(secretsOf(task, job), secrets, job);
  }
  assert.deepEqual(secretsOf(caller, "select"), ["CODEMAN_GITHUB_APP_PRIVATE_KEY"]);
  assert.deepEqual(secretsOf(caller, "dispatch"), ["CODEMAN_GITHUB_APP_PRIVATE_KEY"]);
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
  for (const job of ["forward-review", "next-run", "dispatch"]) {
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

/** A condition's text, without its layout. */
function condition(lines: readonly string[]): string {
  return lines.join(" ").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
}

test("issue events start select only for the codeman label, and skipped runs never replace a pending one", () => {
  assert.deepEqual(
    entries(caller, ["on", "issues"]).get("types"),
    "[labeled, unlabeled, closed, reopened]",
  );
  const select = condition(block(caller, ["jobs", "select", "if"]));
  assert.match(select, /github\.event\.label\.name == 'codeman'/);
  assert.match(select, /contains\(github\.event\.issue\.labels\.\*\.name, 'codeman'\)/);
  // The group is `codeman` exactly when select runs; otherwise one of the run's own.
  const group = condition(block(caller, ["concurrency", "group"]));
  assert.equal(
    group,
    `\${{ (${select}) && 'codeman' || format('codeman-skipped-{0}', github.run_id) }}`,
  );
  assert.equal(entries(caller, ["concurrency"]).get("cancel-in-progress"), "false");
  // A dispatched run's batch reaches select, for its log only.
  assert.ok(entries(caller, ["on", "workflow_dispatch", "inputs"]).has("batch"));
  assert.equal(stepInput(caller, "select", "batch"), `\${{ inputs.batch }}`);
});

test("the dispatch job wakes each repository with a token for it alone, that may only start workflows", () => {
  const job = block(caller, ["jobs", "dispatch"]).join("\n");
  assert.match(job, /needs: select/);
  assert.equal(entries(caller, ["jobs", "dispatch"]).get("permissions"), "{}");
  assert.ok(!job.includes("actions/checkout"), "no checkout");
  assert.ok(!job.includes("id-token"), "no OIDC token");
  assert.ok(!job.includes("codenergy-dev/codeman@"), "no Codeman step");
  const token = entries(caller, ["jobs", "dispatch", "steps", "with"]);
  assert.deepEqual(
    [...token.keys()].filter((key) => key.startsWith("permission-")),
    ["permission-actions", "permission-metadata"],
  );
  assert.equal(token.get("permission-actions"), "write");
  assert.equal(token.get("permission-metadata"), "read");
  assert.equal(token.get("owner"), `\${{ matrix.owner }}`);
  assert.equal(token.get("repositories"), `\${{ matrix.repository }}`);
  assert.match(job, /uses: actions\/create-github-app-token@[0-9a-f]{40} # v3\.2\.0/);
  assert.match(job, /include: \$\{\{ fromJSON\(needs\.select\.outputs\.dispatches\) \}\}/);
  // Untrusted-looking values reach the shell through the environment only.
  assert.ok(!/\$\{\{ matrix\.[a-z]+ \}\}"/.test(job));
  // Always Codeman's workflow on the default branch: nothing from the board picks the file or ref.
  // The branch comes from REST, which metadata: read allows; gh's own GraphQL read does not.
  assert.match(job, /branch=\$\(gh api "repos\/\$OWNER\/\$REPOSITORY" --jq \.default_branch\)/);
  assert.match(
    job,
    /gh workflow run codeman\.yml --repo "\$OWNER\/\$REPOSITORY" --ref "\$branch" -f batch="\$BATCHES"/,
  );
  assert.equal(job.match(/--ref/g)?.length, 1);
  assert.ok(!/matrix\.(workflow|ref)/.test(job));
  // The agent's permissions stay as they were.
  assert.deepEqual(
    entries(task, ["jobs", "agent", "permissions"]),
    new Map([
      ["contents", "read"],
      ["actions", "read"],
    ]),
  );
  assert.equal(
    entries(caller, ["jobs", "select", "outputs"]).get("dispatches"),
    `\${{ steps.codeman.outputs.dispatches }}`,
  );
});

/** A job's steps, each as its lines, without comments. */
function stepsOf(text: string, job: string): string[][] {
  const steps: string[][] = [];
  for (const line of block(text, ["jobs", job, "steps"])) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (line.startsWith("      - ")) steps.push([]);
    steps.at(-1)?.push(line);
  }
  return steps;
}

const CHECK = [
  "      - name: Check CODEMAN_COMMIT_SHA",
  "        run: |",
  '          if [[ ! "$CODEMAN_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then',
  '            echo "::error::Set the CODEMAN_COMMIT_SHA variable to a full commit SHA of codenergy-dev/codeman (40 lowercase hexadecimal characters), not a branch or tag."',
  "            exit 1",
  "          fi",
  '          status=$(gh api "repos/codenergy-dev/codeman/compare/main...$CODEMAN_COMMIT_SHA" --jq .status) || status=""',
  '          if [[ "$status" != "behind" && "$status" != "identical" ]]; then',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell's expansion, as the template has it.
  '            echo "::error::CODEMAN_COMMIT_SHA must be a commit of codenergy-dev/codeman\'s main branch, but GitHub compares it with main as \\"${status:-not found}\\"."',
  "            exit 1",
  "          fi",
  "        env:",
  `          CODEMAN_COMMIT_SHA: \${{ vars.CODEMAN_COMMIT_SHA }}`,
  `          GH_TOKEN: \${{ github.token }}`,
];
const CHECKOUT = [
  "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  "        with:",
  "          repository: codenergy-dev/codeman",
  `          ref: \${{ vars.CODEMAN_COMMIT_SHA }}`,
  "          path: .codeman/action",
  "          persist-credentials: false",
];
/** The jobs that run Codeman, by file. */
const CODEMAN_JOBS: [string, string, string][] = [
  ["codeman.yml", "select", caller],
  ["codeman-task.yml", "open-key", task],
  ["codeman-task.yml", "agent", task],
  ["codeman-task.yml", "close-key", task],
  ["codeman-task.yml", "apply", task],
  ["codeman-task.yml", "release-pod", task],
];

test("each job runs Codeman from a checkout at CODEMAN_COMMIT_SHA, checked to be a full SHA first", () => {
  for (const [file, job, text] of CODEMAN_JOBS) {
    const steps = stepsOf(text, job);
    const at = steps.findIndex((step) => step[0] === "      - uses: ./.codeman/action");
    assert.ok(at >= 2, `${file}: ${job} runs Codeman`);
    assert.equal(
      steps.filter((step) => step.join("\n").includes(".codeman/action")).length,
      2,
      `${file}: ${job} checks out and runs Codeman once`,
    );
    const check = steps.findIndex((step) => step[0] === CHECK[0]);
    assert.deepEqual(steps[check], CHECK, `${file}: ${job} checks the variable`);
    assert.deepEqual(steps[check + 1], CHECKOUT, `${file}: ${job} checks out right after`);
    assert.ok(check + 1 < at, `${file}: ${job} checks out before it runs Codeman`);
    // The values reach the shell through the environment only.
    assert.ok(!steps[check]?.slice(1, -3).join("\n").includes("${{"), `${file}: ${job}`);
    assert.ok(
      steps[at]?.includes(`          template-version: ${TEMPLATE_VERSION}`),
      `${file}: ${job} passes the template version`,
    );
  }
  // The agent job checks out the repository first: its checkout cleans the workspace.
  const agent = stepsOf(task, "agent");
  assert.equal(agent[0]?.[0], CHECKOUT[0]);
  assert.ok(!agent[0]?.join("\n").includes("repository:"));
  assert.deepEqual(agent[1], CHECK);
});

test("no other job runs Codeman, and no commit is written in the files", () => {
  for (const [text, jobs] of [
    [caller, ["forward-review", "dispatch", "next-run"]],
    [task, []],
  ] as const) {
    for (const job of jobs)
      assert.ok(!block(text, ["jobs", job]).join("\n").includes("codeman/action"), job);
  }
  assert.ok(!entries(caller, ["jobs", "task"]).get("uses")?.includes("codeman/action"));
  for (const text of [caller, task]) {
    assert.ok(!/(?<!CODEMAN_)COMMIT_SHA/.test(text), "no placeholder");
    assert.ok(!text.includes("codenergy-dev/codeman@"), "no pinned Codeman");
    assert.equal(
      [...text.matchAll(/uses: \.\/\.codeman\/action$/gm)].length,
      CODEMAN_JOBS.filter(([, , source]) => source === text).length,
    );
  }
  assert.match(readFileSync("action.yml", "utf8"), /^ {2}template-version:$/m);
});

test("checking Codeman out changes no job's permissions", () => {
  const permissions = (text: string, job: string) => {
    const inline = entries(text, ["jobs", job]).get("permissions");
    if (inline === undefined) return "none";
    return inline === ""
      ? JSON.stringify([...entries(text, ["jobs", job, "permissions"])])
      : inline;
  };
  const expected: [string, string, string][] = [
    [caller, "forward-review", '[["actions","write"]]'],
    [caller, "select", '[["id-token","write"]]'],
    [caller, "dispatch", "{}"],
    [caller, "task", '[["contents","read"],["actions","read"],["id-token","write"]]'],
    [caller, "next-run", '[["actions","write"]]'],
    [task, "open-key", '[["id-token","write"]]'],
    [task, "agent", '[["contents","read"],["actions","read"]]'],
    [task, "close-key", '[["id-token","write"]]'],
    [task, "apply", "none"],
    [task, "release-pod", '[["id-token","write"]]'],
  ];
  for (const [text, job, value] of expected) assert.equal(permissions(text, job), value, job);
  for (const text of [caller, task]) assert.match(text, /^permissions: \{\}$/m);
});
