import assert from "node:assert/strict";
import { test } from "node:test";
import { documentId, isLedgerRunId, LAYOUT, ledgerRunId, repositoryName } from "./layout.ts";

test("runs belong to the lowercase organization, by workflow run, attempt and task; pods to the pool", () => {
  assert.equal(
    LAYOUT.run("Codenergy", ledgerRunId("300", 2, 7)),
    "organizations/codenergy/runs/300-2-7",
  );
  assert.equal(
    LAYOUT.event("o", "300-2-7-key-opened"),
    "organizations/o/events/300-2-7-key-opened",
  );
  // What a pool shares is under the pool; the cache of fits, under no one.
  assert.equal(
    LAYOUT.endpointRun("a+b", "ep1", "300-2-7-1791000000000"),
    "pools/a+b/endpoints/ep1/runs/300-2-7-1791000000000",
  );
  assert.equal(LAYOUT.pod("A+B", "n1"), "pools/a+b/pods/n1");
  assert.equal(LAYOUT.boardEntry("a+b", "A/Repo"), "pools/a+b/board/a%2Frepo");
  assert.equal(LAYOUT.batch("a+b", "300-1-0"), "pools/a+b/batches/300-1-0");
  assert.equal(LAYOUT.context("k1"), "contexts/k1");
  assert.equal(LAYOUT.organizationPods("Codenergy"), "organizations/codenergy/pods");
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
