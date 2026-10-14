import assert from "node:assert/strict";
import { test } from "node:test";
import { declaredPool, isPoolId, poolId, soloPool } from "./pool.ts";

test("a pool's ID is its members' logins, lowercase, sorted, joined by +", () => {
  assert.equal(poolId(["Organization-B", "organization-a"]), "organization-a+organization-b");
  assert.ok(isPoolId("a+b"));
  assert.ok(isPoolId("a"));
  assert.ok(!isPoolId("b+a"), "sorted");
  assert.ok(!isPoolId("A+b"), "lowercase");
  assert.ok(!isPoolId("a+a"), "each once");
  assert.ok(!isPoolId("a++b"));
  assert.ok(!isPoolId("a/b"));
});

test("an organization declares its `pool`, which must include it, or is a pool alone", () => {
  assert.deepEqual(declaredPool("Organization-A", ["organization-b", "ORGANIZATION-A"]), {
    ok: true,
    value: {
      id: "organization-a+organization-b",
      members: ["organization-a", "organization-b"],
    },
  });
  assert.deepEqual(declaredPool("Organization-A"), {
    ok: true,
    value: { id: "organization-a", members: ["organization-a"] },
  });
  assert.deepEqual(declaredPool("a", ["b", "c"]), {
    ok: false,
    error: "`pool` in the organization's settings must include the organization itself, `a`.",
  });
  assert.deepEqual(soloPool("A"), { id: "a", members: ["a"] });
});
