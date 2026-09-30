import assert from "node:assert/strict";
import { test } from "node:test";
import { renderRun, renderStatus } from "../status.ts";
import { en } from "./en.ts";
import { languageName, messages, taskLanguage } from "./index.ts";
import { ptBR } from "./pt-BR.ts";

test("finds the catalog of a tag, of its base language, or falls back to English", () => {
  assert.equal(messages("pt-BR"), ptBR);
  assert.equal(messages("pt-br"), ptBR);
  assert.equal(messages("pt"), ptBR);
  assert.equal(messages("pt-PT"), ptBR);
  assert.equal(messages("en-GB"), en);
  assert.equal(messages("fr"), en);
  assert.equal(messages(undefined), en);
});

test("a language setting wins over the one the agent reported", () => {
  assert.equal(taskLanguage("auto", "pt-BR"), "pt-BR");
  assert.equal(taskLanguage("auto", undefined), "en");
  assert.equal(taskLanguage("es", "pt-BR"), "es");
});

test("names languages for prompts", () => {
  assert.equal(languageName("pt-BR"), "Brazilian Portuguese");
  assert.equal(languageName("en"), "English");
});

test("formats numbers and dates for the language", () => {
  assert.equal(ptBR.money(1234.5), "US$ 1.234,50");
  assert.equal(ptBR.cost(0.0123), "US$ 0,012");
  assert.equal(ptBR.dateTime("2026-09-28T19:40:12.345Z"), "28/09/2026 19:40 UTC");
  assert.equal(en.money(1234.5), "US$ 1,234.50");
  assert.equal(en.dateTime("2026-09-28T19:40:12.345Z"), "2026-09-28 19:40 UTC");
});

test("the panel and run comments come out in the task's language", () => {
  const record = {
    branch: "codeman/1-x",
    planPath: "docs/plans/x.md",
    summary: "Adiciona x.",
    decisions: [
      {
        id: 1,
        title: "Armazenamento",
        question: "Onde?",
        options: [
          { key: "a", label: "Arquivos" },
          { key: "b", label: "Banco" },
        ],
        recommendation: "a",
      },
    ],
    processedCommentId: 0,
  };
  const panel = renderStatus({
    t: ptBR,
    state: "awaiting-decision",
    record,
    model: "a/b",
    runUrl: "https://x/runs/1",
    cost: { task: 0.5, budget: 2 },
  });
  assert.match(panel, /### Codeman: Aguardando as suas decisões/);
  assert.match(panel, /#### Decisões/);
  assert.match(panel, /_\(recomendada\)_/);
  assert.match(panel, /Responda com `\/codeman decide 1 a`/);
  assert.match(panel, /Gasto: US\$ 0,50 de US\$ 2,00 da tarefa\./);
  assert.match(panel, /<sub>Modelo: `a\/b` \(troque com `\/codeman set model <id>`\)/);

  const run = renderRun({
    t: ptBR,
    title: ptBR.runTitle({
      action: "implement",
      stage: "review",
      revised: false,
      outcome: "blocked",
    }),
    state: "blocked",
    model: "a/b",
    runUrl: "https://x/runs/2",
    message: ptBR.stageNeedsMaintainer("review"),
    errors: [ptBR.commandProblem({ kind: "no-decision", id: 3 })],
  });
  assert.match(run, /### Codeman · Etapa de revisão: bloqueada\n/);
  assert.match(run, /\*\*Próximo passo:\*\* um mantenedor: veja acima como continuar\./);
  assert.match(run, /A etapa de revisão precisa de um mantenedor\./);
  assert.match(run, /#### Problemas\n\n- A decisão 3 não existe\./);
});

test("every command problem has a text in each catalog", () => {
  const problems = [
    { kind: "takes-no-arguments", command: "approve" },
    { kind: "unknown-command" },
    { kind: "not-in-description" },
    { kind: "answer-needs-number" },
    { kind: "answer-needs-text" },
    { kind: "decide-needs-answers" },
    { kind: "not-an-answer", arg: "x" },
    { kind: "set-which", names: ["model"] },
    { kind: "set-one-value", name: "model" },
    { kind: "invalid-setting", name: "language", type: "language" },
    { kind: "text-too-long", max: 2000 },
    { kind: "no-decision", id: 1 },
    { kind: "no-option", id: 1, option: "z" },
  ] as const;
  for (const t of [en, ptBR]) {
    for (const problem of problems) assert.ok(t.commandProblem(problem).length > 10, problem.kind);
  }
});

test("a run's title says what ran and how it ended; its last line, what comes next", () => {
  const title = (t: typeof en, run: Parameters<typeof en.runTitle>[0]) => t.runTitle(run);
  assert.equal(
    title(ptBR, { action: "implement", stage: "design", revised: false, outcome: "skipped" }),
    "Etapa de design: pulada",
  );
  assert.equal(
    title(ptBR, { action: "implement", stage: "review", revised: false, outcome: "changes" }),
    "Etapa de revisão: mudanças pedidas",
  );
  assert.equal(
    title(en, { action: "implement", stage: "test", revised: false, outcome: "done" }),
    "Test stage: done",
  );
  assert.equal(title(en, { action: "plan", revised: true, outcome: "done" }), "Plan: revised");
  assert.equal(title(ptBR, { action: "plan", revised: false, outcome: "failed" }), "Plano: falhou");
  assert.equal(title(en, { action: "record", revised: false }), "Answers recorded");
  assert.equal(
    title(en, { action: "accept", revised: false, outcome: "failed" }),
    "Workflows not accepted",
  );

  assert.equal(ptBR.nextStep("coding"), "etapa de código.");
  assert.equal(ptBR.nextStep("done"), "a sua revisão do pull request.");
  assert.equal(en.nextStep("awaiting-decision"), "your decisions, in the task's status comment.");
});
