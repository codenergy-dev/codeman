import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { adminToken } from "../../src/inference/selfhosted.ts";
import { TEST_COMMIT } from "../../src/testing/fake-releases.ts";
import { type CheckOptions, OWNER, parseInputs, podCheck, runCommit } from "./check.ts";
import { type FakeOptions, FakeRunpod } from "./fake-runpod.ts";

const KEY = "rpa_TESTKEY0123456789abcdefghijklmnop";

/** Runs the check against a fake Runpod, and gives what it printed and the fake. */
async function run(
  argv: string[],
  fake: FakeOptions = {},
  more: Partial<CheckOptions> & { actions?: boolean; env?: Record<string, string> } = {},
) {
  const lines: string[] = [];
  const runpod = new FakeRunpod(lines, fake);
  const code = await podCheck({
    argv,
    env: {
      CODEMAN_RUNPOD_API_KEY: KEY,
      GITHUB_SHA: TEST_COMMIT,
      ...(more.actions === false ? {} : { GITHUB_ACTIONS: "true" }),
      ...more.env,
    },
    write: (line) => lines.push(line),
    git: () => {
      throw new Error("No git in tests.");
    },
    fetch: runpod.fetch,
    wait: async () => {},
    ...more,
  });
  return { code, lines, runpod };
}

/** Every value the output must never show: pods' IDs, URLs and nonces, tokens, and the key. */
function secrets(runpod: FakeRunpod): string[] {
  const pods = [...runpod.pods.values()];
  return [
    KEY,
    ...pods.flatMap((pod) => [
      pod.id,
      `https://${pod.id}-8080.proxy.runpod.net`,
      pod.env.CODEMAN_NONCE ?? "",
      pod.env.CODEMAN_NONCE ? adminToken(KEY, pod.env.CODEMAN_NONCE) : "",
    ]),
    ...runpod.bearers.map((bearer) => bearer.token),
  ].filter((value) => value !== "");
}

/** Checks that no line but a mask shows a secret, and that each was masked before its use. */
function assertNothingLeaks(lines: readonly string[], runpod: FakeRunpod, actions = true): void {
  for (const secret of secrets(runpod)) {
    // The runner reads a mask command, and never shows it. A pod's URL is known only once the
    // pod runs, and is masked then.
    if (actions && !secret.startsWith("https://")) {
      assert.ok(lines.includes(`::add-mask::${secret}`), "A secret was not masked.");
    }
    for (const line of lines) {
      if (actions && line.startsWith("::add-mask::")) continue;
      assert.ok(!line.includes(secret), `A line shows a secret: ${line}`);
    }
  }
  if (!actions) assert.ok(!lines.some((line) => line.startsWith("::")));
  if (actions) {
    for (const { token, printed } of runpod.bearers) {
      assert.ok(printed.includes(`::add-mask::${token}`), "A token was used before its mask.");
    }
    assert.equal(lines[0], `::add-mask::${KEY}`);
  }
  for (const line of lines) {
    assert.match(line, /^(::add-mask::\S+|\[pod-check\] [a-z.-]+( [a-z0-9_]+=("[^"]*"|\S+))*)$/);
  }
}

/** The check's own pods, which must all be terminated. */
function assertAllTerminated(runpod: FakeRunpod): void {
  for (const pod of runpod.pods.values()) {
    if (pod.env.CODEMAN_ORGANIZATION !== OWNER) continue;
    assert.equal(pod.status, "TERMINATED", "A pod of the check was left running.");
  }
}

function line(lines: readonly string[], event: string): string {
  const found = lines.find((one) => one.startsWith(`[pod-check] ${event} `));
  assert.ok(found, `No line for ${event} in:\n${lines.join("\n")}`);
  return found;
}

describe("the pod check", () => {
  test("serves on Ollama then vLLM, prints only allowlisted values, and terminates both pods", async () => {
    const { code, lines, runpod } = await run(["--gpu=NVIDIA RTX A5000"]);
    assert.equal(code, 0, lines.join("\n"));
    assert.deepEqual(runpod.unexpected, []);
    assert.equal(runpod.pods.size, 2);
    assertAllTerminated(runpod);
    assertNothingLeaks(lines, runpod);
    for (const engine of ["ollama", "vllm"]) {
      for (const step of ["start", "bootstrap", "health", "fit", "chat", "end"]) {
        assert.match(line(lines, `${engine}.${step}`), / result=pass/);
      }
    }
    assert.match(line(lines, "gateway"), new RegExp(`result=pass commit=${TEST_COMMIT}`));
    assert.match(
      line(lines, "ollama.bootstrap"),
      /result=pass node=v24\.22\.1 node_match=true gateway_sha256_match=true command=true image=true node_spec=true gateway_spec=true gateway_answered=true gateway_version=2/,
    );
    assert.match(line(lines, "ollama.fit"), /gpu_memory_gb=24 size_gb=1.2 vram_gb=1.2/);
    assert.match(line(lines, "vllm.fit"), /cache_tokens=1717000 concurrency=52.4/);
    assert.match(line(lines, "ollama.chat"), /http_status=200 answered=true completion_tokens=2/);
    assert.match(line(lines, "cleanup"), /result=pass pods=2 leftover_pods=0/);
    assert.match(line(lines, "done"), /result=pass/);
  });

  test("gives each pod the bootstrap with the gateway at the run's commit", async () => {
    const { runpod } = await run(["--checks=ollama"]);
    const [pod] = runpod.pods.values();
    assert.equal(pod?.command[0], "/bin/sh");
    assert.equal(
      pod?.env.CODEMAN_BOOTSTRAP_GATEWAY_URL,
      `https://raw.githubusercontent.com/codenergy-dev/codeman/${TEST_COMMIT}/dist/gateway.js`,
    );
    assert.equal(pod?.env.CODEMAN_ORGANIZATION, OWNER);
  });

  test("fails the bootstrap when the gateway runs on another Node.js or another file", async () => {
    for (const [fake, field] of [
      [{ node: "v24.21.0" }, /node=v24\.21\.0 node_match=false gateway_sha256_match=true/],
      [{ gatewaySha256: "b".repeat(64) }, /node_match=true gateway_sha256_match=false/],
    ] as const) {
      const { code, lines, runpod } = await run(["--checks=ollama"], fake);
      assert.equal(code, 1);
      const bootstrap = line(lines, "ollama.bootstrap");
      assert.match(bootstrap, /result=fail/);
      assert.match(bootstrap, field);
      assertAllTerminated(runpod);
      assertNothingLeaks(lines, runpod);
    }
  });

  test("prints no mask outside GitHub Actions, and no secret either", async () => {
    const { code, lines, runpod } = await run(["--checks=ollama"], {}, { actions: false });
    assert.equal(code, 0, lines.join("\n"));
    assertNothingLeaks(lines, runpod, false);
  });

  test("terminates the pods when a check fails, and exits 1", async () => {
    const { code, lines, runpod } = await run([], { chatStatus: 500 });
    assert.equal(code, 1);
    assert.match(line(lines, "ollama.chat"), /result=fail http_status=500 answered=false/);
    assert.match(line(lines, "cleanup"), /result=pass pods=2/);
    assert.match(line(lines, "done"), /result=fail/);
    assertAllTerminated(runpod);
    assertNothingLeaks(lines, runpod);
  });

  test("terminates a pod whose start fails", async () => {
    const { code, lines, runpod } = await run(["--checks=ollama"], { podsFail: true });
    assert.equal(code, 1);
    assert.match(
      line(lines, "ollama.start"),
      /result=fail error=Error reason="The pod was failed before it served."/,
    );
    assert.equal(runpod.pods.size, 1);
    assertAllTerminated(runpod);
    assertNothingLeaks(lines, runpod);
  });

  test("prints the catalog's availability before each pod", async () => {
    const { lines } = await run([]);
    assert.match(
      line(lines, "ollama.start"),
      /result=pass engine=ollama model=qwen2.5:0.5b availability=HIGH data_centers=2 data_centers_with_room=1 create_s=/,
    );
    assert.match(line(lines, "vllm.start"), /availability=HIGH data_centers=2/);
  });

  test("a 400 while the catalog lists no room is unavailable, with Runpod's detail", async () => {
    const { code, lines, runpod } = await run(["--checks=ollama"], {
      availability: "NONE",
      createError: () => ({ status: 400, detail: "There are no instances available." }),
    });
    assert.equal(code, 1);
    assert.equal(runpod.pods.size, 0);
    assert.match(
      line(lines, "ollama.start"),
      /result=unavailable error=PodUnavailable http_status=400 message="Runpod created no pod with NVIDIA GeForce RTX 4090: Secure Cloud: Runpod POST \/pods failed with 400: Bad Request There are no instances available\..*availability=NONE/,
    );
  });

  test("a 400 while the catalog lists room fails the start, with Runpod's detail cleaned", async () => {
    const { code, lines, runpod } = await run(["--checks=ollama"], {
      createError: (spec) => {
        const nonce = spec.env.CODEMAN_NONCE ?? "";
        return {
          status: 400,
          detail: `env refused: ${KEY} ${adminToken(KEY, nonce)} ${nonce} at https://example.com/x`,
        };
      },
    });
    assert.equal(code, 1);
    const start = line(lines, "ollama.start");
    assert.match(
      start,
      /^\[pod-check\] ollama.start result=fail error=PodUnavailable http_status=400/,
    );
    assert.match(start, /env refused: \[hidden\] \[hidden\] \[hidden\] at \[url\]/);
    assert.match(
      start,
      /reason="Runpod refused the creation with 400 while its catalog listed room/,
    );
    assert.ok(!start.includes(KEY));
    assertNothingLeaks(lines, runpod);
  });

  test("terminates a pod whose creation's answer was lost, from its pool", async () => {
    const { code, lines, runpod } = await run(["--checks=ollama"], { loseCreateAnswer: true });
    assert.equal(code, 1);
    assert.equal(runpod.pods.size, 1);
    assert.match(line(lines, "cleanup"), /result=pass pods=1/);
    assertAllTerminated(runpod);
    assertNothingLeaks(lines, runpod);
  });

  test("terminates the pod when interrupted mid-start, and starts no other", async () => {
    const stop = new AbortController();
    const { code, lines, runpod } = await run(
      [],
      { onCreate: () => stop.abort() },
      { signal: stop.signal },
    );
    assert.equal(code, 1);
    assert.equal(runpod.pods.size, 1);
    assert.match(line(lines, "ollama"), /result=stopped reason="The run was interrupted."/);
    assert.ok(!lines.some((one) => one.startsWith("[pod-check] vllm")));
    assertAllTerminated(runpod);
    assertNothingLeaks(lines, runpod);
  });

  test("terminates an earlier run's leftover pod, and never another organization's", async () => {
    const lines: string[] = [];
    const runpod = new FakeRunpod(lines);
    const leftover = runpod.addPod({ CODEMAN_ORGANIZATION: OWNER, CODEMAN_POOL: `${OWNER}-1-1` });
    const theirs = runpod.addPod({ CODEMAN_ORGANIZATION: "acme", CODEMAN_POOL: "acme" });
    const code = await podCheck({
      argv: ["--checks=ollama"],
      env: { CODEMAN_RUNPOD_API_KEY: KEY, GITHUB_SHA: TEST_COMMIT, GITHUB_RUN_ID: "2" },
      write: (one) => lines.push(one),
      git: () => "",
      fetch: runpod.fetch,
      wait: async () => {},
    });
    assert.equal(code, 0, lines.join("\n"));
    assert.equal(leftover.status, "TERMINATED");
    assert.equal(theirs.status, "RUNNING");
    assert.match(line(lines, "cleanup"), /leftover_pods=1/);
    assertNothingLeaks(lines, runpod, false);
  });

  test("blocked: a release the policy blocks starts no pod", async () => {
    const { code, lines, runpod } = await run(["--checks=blocked"], {
      ollamaAdvisory: "GHSA-fccc-8m69-8r78",
    });
    assert.equal(code, 0, lines.join("\n"));
    assert.equal(runpod.pods.size, 0);
    assert.match(
      line(lines, "blocked"),
      /result=pass error=ReleaseBlocked advisories=GHSA-fccc-8m69-8r78 pods=0/,
    );
  });

  test("blocked: fails when the policy lets the release pass, and creates no pod", async () => {
    const { code, lines, runpod } = await run(["--checks=blocked"]);
    assert.equal(code, 1);
    assert.equal(runpod.pods.size, 0);
    assert.match(
      line(lines, "blocked"),
      /result=fail error=Error reason="The release policy did not block the release." pods=0/,
    );
  });

  test("unfit: a model that does not fit fails with the fit's message", async () => {
    const message =
      "`Qwen/Qwen2.5-0.5B-Instruct` does not fit the GPU with 256 parallel requests and a context of 32768 tokens: vLLM's K/V cache holds 52.40 of them (1717000 tokens).";
    const { code, lines, runpod } = await run(["--checks=unfit"], { startFailure: message });
    assert.equal(code, 0, lines.join("\n"));
    const unfit = line(lines, "unfit");
    assert.match(unfit, /result=pass engine=vllm model=Qwen\/Qwen2.5-0.5B-Instruct/);
    assert.ok(unfit.includes(JSON.stringify(message)), unfit);
    assertAllTerminated(runpod);
    assertNothingLeaks(lines, runpod);
  });

  test("refuses a GPU above the cost bound before any pod", async () => {
    const { code, lines, runpod } = await run([], { hourly: 1.5 });
    assert.equal(code, 1);
    assert.equal(runpod.pods.size, 0);
    assert.match(line(lines, "gpu"), /result=fail .*price_per_hour_usd=1.5 worst_case_usd=1.5/);
  });

  test("refuses a wrong input before any request, without repeating it", async () => {
    const { code, lines, runpod } = await run(["--gpu=::set-env name=X::1"]);
    assert.equal(code, 2);
    assert.equal(runpod.bearers.length, 0);
    assert.ok(!lines.join("\n").includes("set-env"));
    assert.match(line(lines, "inputs"), /result=fail reason="The GPU type must be one of/);
  });

  test("--cleanup terminates every pod of the check, and no other", async () => {
    const lines: string[] = [];
    const runpod = new FakeRunpod(lines);
    const ours = runpod.addPod({ CODEMAN_ORGANIZATION: OWNER, CODEMAN_POOL: `${OWNER}-9-1` });
    const theirs = runpod.addPod({ CODEMAN_ORGANIZATION: "acme" });
    const code = await podCheck({
      argv: ["--cleanup"],
      env: { CODEMAN_RUNPOD_API_KEY: KEY },
      write: (one) => lines.push(one),
      git: () => "",
      fetch: runpod.fetch,
    });
    assert.equal(code, 0);
    assert.equal(ours.status, "TERMINATED");
    assert.equal(theirs.status, "RUNNING");
    assert.deepEqual(lines, ["[pod-check] cleanup result=pass pods=1"]);
  });
});

describe("parseInputs", () => {
  test("takes arguments over the environment, and defaults", () => {
    const parsed = parseInputs(["--checks=vllm,blocked"], {
      CODEMAN_POD_CHECK_CHECKS: "ollama",
      CODEMAN_POD_CHECK_GPU: "NVIDIA L4",
      CODEMAN_POD_CHECK_MAX_MINUTES: "",
    });
    assert.deepEqual(parsed, {
      inputs: {
        gpu: "NVIDIA L4",
        checks: ["vllm", "blocked"],
        ollamaModel: "qwen2.5:0.5b",
        vllmModel: "Qwen/Qwen2.5-0.5B-Instruct",
        maxMinutes: 60,
        cleanup: false,
      },
    });
  });

  test("refuses what its patterns do not match", () => {
    for (const argv of [
      ["--gpu=NVIDIA H100 80GB HBM3"],
      ["--checks=ollama,ollama"],
      ["--checks=all"],
      ["--ollama-model=Qwen2.5;rm"],
      ["--vllm-model=../etc/passwd"],
      ["--max-minutes=90"],
      ["--max-minutes=1e2"],
      ["--unknown=1"],
      ["--gpu=NVIDIA L4", "--gpu=NVIDIA L4"],
    ]) {
      assert.ok("problem" in parseInputs(argv, {}), argv.join(" "));
    }
  });
});

describe("runCommit", () => {
  test("takes GITHUB_SHA, else git's HEAD, and only a full SHA", () => {
    const head = "f".repeat(40);
    assert.equal(
      runCommit({ GITHUB_SHA: TEST_COMMIT }, () => head),
      TEST_COMMIT,
    );
    assert.equal(
      runCommit({}, () => `${head}\n`),
      head,
    );
    assert.equal(
      runCommit({}, () => "main"),
      undefined,
    );
    assert.equal(
      runCommit({}, () => {
        throw new Error("not a repository");
      }),
      undefined,
    );
  });
});
