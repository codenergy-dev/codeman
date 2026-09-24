import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt, encrypt } from "./crypto.ts";

const secret = "a-long-random-secret-with-32-chars-or-more";

test("round-trips", () => {
  const token = encrypt("sk-or-v1-abc", secret);
  assert.ok(!token.includes("sk-or"));
  assert.equal(decrypt(token, secret), "sk-or-v1-abc");
});

test("uses a new salt and IV each time", () => {
  assert.notEqual(encrypt("same", secret), encrypt("same", secret));
});

test("fails with the wrong secret or a changed token", () => {
  const token = encrypt("sk-or-v1-abc", secret);
  assert.throws(() => decrypt(token, `${secret}!`));
  const parts = token.split(".");
  parts[4] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decrypt(parts.join("."), secret));
  assert.throws(() => decrypt("v2.a.b.c.d", secret), /unknown format/);
});

test("requires a strong secret", () => {
  assert.throws(() => encrypt("x", "short"), /at least 32/);
});
