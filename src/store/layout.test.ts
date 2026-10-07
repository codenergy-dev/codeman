import assert from "node:assert/strict";
import { test } from "node:test";
import { documentId, isLedgerRunId, LAYOUT, ledgerRunId, repositoryName } from "./layout.ts";

test("documents belong to the lowercase organization, runs by workflow run, attempt and task", () => {
  assert.equal(
    LAYOUT.run("Codenergy", ledgerRunId("300", 2, 7)),
    "organizations/codenergy/runs/300-2-7",
  );
  assert.equal(
    LAYOUT.event("o", "300-2-7-key-opened"),
    "organizations/o/events/300-2-7-key-opened",
  );
  assert.equal(repositoryName({ owner: "Codenergy", name: "Codeman.JS" }), "codenergy/codeman.js");
  assert.ok(isLedgerRunId("300-2-7"));
  assert.ok(!isLedgerRunId("300-2"));
  assert.ok(!isLedgerRunId("300-2-7/x"));
});

test("any text is a valid document ID, and two texts never share one", () => {
  assert.equal(documentId("codeman.js"), "codeman.js");
  assert.equal(documentId("a/b"), "a%2Fb");
  assert.equal(documentId("100%"), "100%25");
  assert.equal(documentId("__init__"), "%__init__");
  assert.equal(documentId("."), "%.");
  assert.equal(documentId(".."), "%..");
  assert.notEqual(documentId("%__x__"), documentId("__x__"));
  assert.throws(() => documentId(""), /may not be empty/);
});
