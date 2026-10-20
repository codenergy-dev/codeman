import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const MAIN = new URL("./main.ts", import.meta.url).pathname;

test("main starts a fake by name on the port asked for, with its control token", async () => {
  const child = spawn(process.execPath, [MAIN, "google"], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", FAKE_CONTROL_TOKEN: "control" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    const [line] = (await once(child.stdout, "data")) as [Buffer];
    const origin = /listens on (\S+)\.$/m.exec(line.toString())?.[1];
    assert.ok(origin, line.toString());
    const discovery = await fetch(`${origin}/.well-known/openid-configuration`);
    assert.equal(discovery.status, 200);
    assert.equal((await fetch(`${origin}/_fake/reset`, { method: "POST" })).status, 401);
    const reset = await fetch(`${origin}/_fake/reset`, {
      method: "POST",
      headers: { authorization: "Bearer control" },
    });
    assert.equal(reset.status, 204);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});

test("main refuses a fake it does not know", async () => {
  const child = spawn(process.execPath, [MAIN, "nope"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
  assert.match(stderr, /No fake "nope"; the fakes are google\./);
});
