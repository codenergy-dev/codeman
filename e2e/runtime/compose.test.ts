import assert from "node:assert/strict";
import { test } from "node:test";
import { failedServices } from "./compose.ts";

test("only the services that exited with an error are shown, from either listing", () => {
  const entries = [
    { Service: "seed-hf", State: "exited", ExitCode: 1 },
    { Service: "seed-npm", State: "exited", ExitCode: 0 },
    { Service: "github", State: "running", ExitCode: 0 },
    { Service: "seed-hf", State: "exited", ExitCode: 1 },
  ];
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
  assert.deepEqual(failedServices(`${lines}\n`), ["seed-hf"]);
  assert.deepEqual(failedServices(JSON.stringify(entries)), ["seed-hf"]);
  assert.deepEqual(failedServices(""), []);
});
