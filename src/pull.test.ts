import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./i18n/en.ts";
import { ptBR } from "./i18n/pt-BR.ts";
import { pullRequestBody, pullRequestFooter, pullRequestTitle, replaceFooter } from "./pull.ts";

const view = {
  t: en,
  issue: 12,
  planPath: "plans/x.md",
  planUrl: "https://github.com/o/r/blob/codeman/12-x/plans/x.md",
  planSummary: "Adds rate limiting.",
  summary: "- Added a limiter\n- Pinged @everyone ![x](http://tracker)",
  commitMessage: "Add rate limiting\n\nUses ```fences``` in the body.",
  runUrl: "https://github.com/o/r/actions/runs/1",
};

test("links the issue and renders the agent's text inert", () => {
  const body = pullRequestBody(view);
  assert.ok(body.startsWith("Closes #12\n"));
  assert.match(body, /^- Added a limiter$/m);
  assert.ok(!body.includes("@everyone"));
  assert.ok(!body.includes("![x]"));
});

test("fences the squash message with more backticks than it contains", () => {
  const body = pullRequestBody(view);
  assert.match(body, /\n````text\nAdd rate limiting\n\nUses ```fences``` in the body\.\n````\n/);
});

test("titles the pull request with the issue's title", () => {
  assert.equal(
    pullRequestTitle("Adicionar limite de requisições"),
    "Adicionar limite de requisições",
  );
  assert.equal(pullRequestTitle("Two\nlines "), "Two lines");
  assert.equal(pullRequestTitle(""), "Codeman task");
});

test("the footer carries the spend and can be replaced", () => {
  const body = pullRequestBody({ ...view, spent: "US$ 0.10 of US$ 2.00" });
  assert.match(body, /<sub>Opened by Codeman · Spent: US\$ 0\.10 of US\$ 2\.00 · \[Last run\]/);
  const updated = replaceFooter(body, pullRequestFooter(en, "https://x/2", "US$ 0.30 of US$ 2.00"));
  assert.match(updated, /Spent: US\$ 0\.30 of US\$ 2\.00 · \[Last run\]\(https:\/\/x\/2\)<\/sub>$/);
  assert.equal(updated.split("Opened by Codeman").length, 2);
  assert.equal(replaceFooter("Edited by a human.", "x"), "Edited by a human.");
});

test("the footer is found in any language, and in older descriptions", () => {
  const body = pullRequestBody({ ...view, t: ptBR, spent: "US$ 0,10 de US$ 2,00" });
  assert.match(body, /### Plano\n/);
  assert.match(
    body,
    /<sub>Aberto pelo Codeman · Gasto: US\$ 0,10 de US\$ 2,00 · \[Última rodada\]/,
  );
  const english = replaceFooter(body, pullRequestFooter(en, "https://x/2"));
  assert.match(english, /<sub>Opened by Codeman · \[Last run\]\(https:\/\/x\/2\)<\/sub>$/);
  assert.ok(!english.includes("Aberto pelo"));
  const older = "Text\n\n<sub>Opened by Codeman · [Last run](https://x/1)</sub>";
  assert.equal(
    replaceFooter(older, pullRequestFooter(ptBR, "https://x/2")).split("\n").at(-1),
    "<!-- codeman:footer --><sub>Aberto pelo Codeman · [Última rodada](https://x/2)</sub>",
  );
});
