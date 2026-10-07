import type { Messages } from "./messages.ts";

const STAGES = {
  plan: "plano",
  route: "roteamento",
  web: "pesquisa",
  design: "design",
  code: "código",
  test: "testes",
  review: "revisão",
};

/** How a stage ended, after "Etapa de código:". */
const OUTCOMES = {
  done: "concluída",
  skipped: "pulada",
  partial: "inacabada",
  blocked: "bloqueada",
  "awaiting-workflow": "aguardando workflows",
  decisions: "precisa de decisões",
  changes: "mudanças pedidas",
  "out-of-time": "sem tempo",
  failed: "falhou",
};

/** Stage names after "etapa de": "etapa de código", "etapa de revisão". */
const OF_STAGE = (stage: keyof typeof STAGES) => `etapa de ${STAGES[stage]}`;

const number = (digits: number) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const ptBR: Messages = {
  locale: "pt-BR",

  money: (amount) => `US$ ${number(2).format(amount)}`,
  tokens: (count) =>
    new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(count),
  cost: (amount) => `US$ ${number(3).format(amount)}`,
  rate: (perSecond) => number(1).format(perSecond),
  dateTime: (iso) =>
    `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`,
  of: (part, whole) => `${part} de ${whole}`,

  stage: (stage) => STAGES[stage],
  runTitle: ({ action, stage, revised, outcome }) => {
    const ended = outcome ? OUTCOMES[outcome] : "";
    switch (action) {
      case "plan":
        return outcome === "done"
          ? revised
            ? "Plano: revisado"
            : "Plano: escrito"
          : `Plano: ${outcome === "failed" ? "falhou" : ended}`;
      case "route":
        return outcome === "done"
          ? "Próximas etapas escolhidas"
          : `Roteamento: ${outcome === "failed" ? "falhou" : ended}`;
      case "implement":
        return `${capitalize(OF_STAGE(stage ?? "code"))}${ended ? `: ${ended}` : ""}`;
      case "record":
        return "Respostas registradas";
      case "accept":
        return outcome === "failed" ? "Workflows não aceitos" : "Workflows aceitos";
    }
  },

  heading: (state) =>
    ({
      new: "Aguardando o início",
      planning: "Escrevendo o plano",
      "awaiting-decision": "Aguardando as suas decisões",
      ready: "Pronto para implementar",
      routing: "Escolhendo as próximas etapas",
      researching: "Registrando documentação de terceiros",
      designing: "Desenhando",
      coding: "Escrevendo o código",
      testing: "Testando",
      reviewing: "Revisando",
      "in-progress": "Implementando",
      "awaiting-workflow": "Aguardando um workflow",
      blocked: "Bloqueado",
      done: "Concluído",
    })[state],
  plan: "Plano",
  pullRequest: "Pull request",
  decisions: "Decisões",
  recommended: "recomendada",
  chosenBy: (by) => `escolhida por ${by}`,
  answeredBy: (by, text) => `Respondida por ${by}: ${text}`,
  howToAnswer:
    "Responda com `/codeman decide 1 a` (várias de uma vez: `/codeman decide 1 a 2 b`) ou aceite todas as recomendações com `/codeman approve`. Para responder com as suas palavras, use `/codeman answer 1 <texto>`; para revisar o plano, use `/codeman replan <o que mudar>`. Só quem tem acesso de escrita ao repositório pode responder.",
  decisionsLink: (pending) =>
    pending === 0 ? "todas respondidas" : `${pending} aguardando resposta`,
  noDecisions: "O plano não tem decisões agora.",
  decisionsOmitted: (count) =>
    `${count} decisão(ões) não aparecem aqui, para caber no limite de tamanho de comentários do GitHub. O plano tem todas.`,
  panelCut:
    "Parte deste painel não aparece, para caber no limite de tamanho de comentários do GitHub. O comentário da última rodada tem os detalhes.",
  workflowsToReview: "Workflows para revisar",
  workflowsHelp:
    "O agente escreveu estes workflows. Eles estão guardados em `.codeman/workflows/` na branch da tarefa e não rodam. Um workflow roda com os segredos do repositório, então leia-os antes no pull request ou na branch. Para movê-los para `.github/workflows/`, comente `/codeman accept-workflows`.",
  oldDocs: "Documentação de terceiros para atualizar",
  oldDocsHelp: (days) =>
    `Estas páginas em \`docs/web/\` foram buscadas há mais de ${days} dias, ou não têm um \`updated_at\` válido. O Codeman não as atualiza sozinho. Para atualizar algumas, peça numa tarefa, por exemplo com \`/codeman fix Atualize docs/web/<terceiro>/\`: o agente de roteamento a envia para a etapa de pesquisa.`,
  daysOld: (days) => `${days} dias`,
  noDate: "sem `updated_at` válido",
  morePages: (count) => `E mais ${count}.`,
  spending: "Gastos",
  spent: ({ run, task, budget }) =>
    `Gasto: ${run ? `${run} nesta rodada, ` : ""}${task} de ${budget} da tarefa`,
  refusedHeading: "Não é uma tarefa",
  refused:
    "O Codeman trabalha somente em issues abertas por quem tem acesso de escrita ao repositório. O agente lê o título e o corpo da issue como a sua tarefa, e quem abriu a issue pode editá-los a qualquer momento. Para seguir, um mantenedor abre uma nova issue com este conteúdo, com as suas próprias palavras, e aplica a label `codeman`. Depois, remova a label `codeman` desta.",
  panelFooter: (model, runUrl, reportUrl) =>
    `<sub>Modelo: \`${model}\` (troque com \`/codeman set model <id>\`) · [Última rodada](${runUrl})${reportUrl ? ` · [Último relatório](${reportUrl})` : ""}</sub>`,

  nextStepLabel: "Próximo passo",
  nextStep: (state) =>
    ({
      new: "o Codeman tenta de novo numa próxima rodada.",
      planning: "o plano.",
      "awaiting-decision": "as suas decisões, no comentário de decisões da tarefa.",
      ready: "o agente de roteamento, que escolhe as etapas que rodam em seguida.",
      routing: "o agente de roteamento, que escolhe as etapas que rodam em seguida.",
      researching: "etapa de pesquisa.",
      designing: "etapa de design.",
      coding: "etapa de código.",
      testing: "etapa de testes.",
      reviewing: "etapa de revisão.",
      "in-progress": "a implementação.",
      "awaiting-workflow": "os workflows: aceite-os ou aguarde as execuções.",
      blocked: "um mantenedor: veja acima como continuar.",
      done: "a sua revisão do pull request.",
    })[state],
  report: "Relatório",
  problems: "Problemas",
  costHeading: "Custo",
  runFooter: (model, spent, runUrl) =>
    `<sub>Modelo: \`${model}\`${spent ? ` · ${spent}` : ""} · [Rodada](${runUrl})</sub>`,

  tableHeader: [
    "Rodada",
    "Etapa",
    "Modelo",
    "Provedor",
    "Tempo",
    "Tokens de entrada",
    "Tokens de saída",
    "Contexto",
    "Tok/s",
    "Custo",
    "Limite da chave",
    "Orçamento da tarefa",
    "Mês (estimado)",
  ],
  provider: (mode) =>
    ({ openrouter: "OpenRouter", pod: "Runpod (pod)", serverless: "Runpod (Serverless)" })[mode],
  spendNote: (mode) =>
    ({
      openrouter:
        "**OpenRouter**: o custo de uma rodada é o que a sua chave usou, exato, e as rodadas seguintes o atualizam. O mês é o que as chaves do repositório usaram neste mês.",
      pod: "**Runpod (pod)**: o custo de uma rodada é o tempo do seu pod ao preço dele, atualizado depois pela cobrança da Runpod. O mês é uma estimativa: a cobrança de toda a conta da Runpod, com todos os repositórios dela, mais o que os pods em execução custaram além dela.",
      serverless:
        "**Runpod (Serverless)**: o custo de uma rodada é uma estimativa do tempo que a Runpod cobra pelos seus workers. O mês é a cobrança de toda a conta da Runpod, que conta uma rodada Serverless com uma hora ou mais de atraso.",
    })[mode],
  earlierRuns: (runs) => `Rodadas anteriores (${runs})`,
  totalRow: (runs) => `Total (${runs} ${runs === 1 ? "rodada" : "rodadas"})`,
  runsWithoutRow: "Rodadas sem linha",

  fullPlan: "Plano completo",
  changes: "Mudanças",
  squashMessage: "Mensagem sugerida para o squash commit",
  pullRequestFooter: (spent, runUrl) =>
    `<sub>Aberto pelo Codeman${spent ? ` · Gasto: ${spent}` : ""} · [Última rodada](${runUrl})</sub>`,
  draftSummary:
    "O Codeman ainda está trabalhando neste pull request: os testes e a revisão vêm a seguir. Ele fica pronto para revisão quando os dois passarem.",
  readySummary: (code, test) =>
    `Código: ${code ?? "(sem relatório)"}\n\nTestes: ${test ?? "(sem relatório)"}`,
  reviewHeading: "Revisão do Codeman",
  reviewChanges: "Mudanças pedidas à etapa de código",
  run: "Rodada",

  startPlan: (revising) =>
    revising
      ? "O Codeman está revisando o plano, como pedido."
      : "O Codeman está lendo a issue e escrevendo um plano.",
  startStage: (stage) =>
    ({
      web: "O Codeman está registrando a documentação de terceiros de que a tarefa depende.",
      design: "O Codeman está desenhando: fluxos e telas, se a tarefa precisar.",
      code: "O Codeman está escrevendo o código.",
      test: "O Codeman está testando o trabalho.",
      review: "O Codeman está revisando o trabalho.",
    })[stage],
  startRoute: "O agente de roteamento do Codeman está escolhendo as etapas que rodam em seguida.",
  startWithWorkflowResults: "O Codeman está continuando com os resultados dos workflows que pediu.",
  startWithChanges: "O Codeman está trabalhando nas mudanças pedidas.",
  startContinue: "O Codeman está continuando o trabalho, como pedido.",

  continueHint: "Comente `/codeman continue <orientação>` para tentar de novo.",
  stageBlockedHint:
    "Comente `/codeman continue <orientação>` para tentar de novo, ou `/codeman replan <o que mudar>` para revisar o plano, por exemplo para ampliar o escopo.",
  replanHint: "Comente `/codeman replan <o que mudar>` para tentar de novo.",
  removeLabelHint: "Remova a label `codeman:blocked` para tentar de novo.",

  noKey:
    "O Codeman não conseguiu dar a esta rodada acesso ao modelo (uma chave do OpenRouter, ou uma GPU). Veja o log da rodada.",
  taskBudgetSpent: (spent, budget, minimum) =>
    `A tarefa gastou ${spent} do orçamento de ${budget}, e uma rodada precisa de pelo menos ${minimum}. Um mantenedor pode aumentá-lo com \`/codeman set task-budget <usd>\` e depois comentar \`/codeman continue\`.`,
  monthlyBudgetReached: (used, budget, limit) =>
    `O orçamento mensal foi atingido: ${used} usados de ${budget}, e esta rodada pode usar até ${limit}.`,
  tryLater: (reason) => `${reason} O Codeman tenta de novo numa próxima rodada.`,

  planUnfinished: "O agente não terminou o plano. Veja o log da rodada.",
  noResult: "O agente não produziu resultado. Veja o log da rodada.",
  couldNotUse: "O Codeman não conseguiu usar o resultado do agente.",
  ignoredChange: (path) => `Mudança em ${path} ignorada.`,
  cutText: (field, length, max) =>
    `${field} tinha ${length} caracteres, além do limite; o Codeman o cortou para ${max}.`,
  droppedChange: (path, reason) => {
    const why = {
      "invalid-path": "não é um caminho válido no repositório",
      "codeman-settings": "são as configurações do próprio Codeman",
      protected: "protegido pelo .codemanignore",
      "not-a-file": "não é um arquivo comum",
      "too-large": `maior que ${reason.kind === "too-large" ? number(0).format(reason.max) : 0} bytes`,
      "workflow-deletion": "apagar um workflow fica a cargo de um mantenedor",
      "web-stage-only": "a etapa de pesquisa só muda docs/web/",
      "web-docs": "só a etapa de pesquisa muda docs/web/",
      "invalid-web-page": reason.kind === "invalid-web-page" ? reason.problem : "",
    }[reason.kind];
    return `Mudança em ${path} descartada: ${why}.`;
  },
  outOfTime: "O tempo do agente acabou. O trabalho feito até aqui foi commitado.",
  partial: "O trabalho feito até aqui foi commitado na branch da tarefa.",
  maxRuns: (stage, runs, max) =>
    `A ${OF_STAGE(stage)} rodou ${runs} vezes seguidas sem terminar (\`max-runs\` é ${max}). Comente \`/codeman continue <orientação>\` para permitir mais ${max} rodadas.`,
  stageNeedsMaintainer: (stage) => `A ${OF_STAGE(stage)} precisa de um mantenedor.`,
  agentReports: (reason) => `O agente relata: ${reason}`,
  missingWorkflows: (paths) => `O agente aguarda workflows que não estão na branch: ${paths}.`,
  awaitingWorkflows: (stage, paths, reason) =>
    `A ${OF_STAGE(stage)} precisa que ${paths} rode: ${reason} O Codeman continua quando essas execuções terminarem na branch da tarefa. \`/codeman continue <orientação>\` continua sem elas.`,
  deferredWorkflows: (stage, paths, reason, next) =>
    `A ${OF_STAGE(stage)} precisa que ${paths} rode: ${reason} Os workflows estão guardados e aguardam um mantenedor, então a tarefa segue ${next ? `para a ${OF_STAGE(next)} enquanto isso, até o fim da sua rota` : "até o fim da sua rota enquanto isso"}. Quando forem aceitos e as execuções terminarem, a ${OF_STAGE(stage)} continua com os resultados.`,
  acceptAfterReview: (paths) =>
    `A revisão passou. A tarefa aguarda que os workflows guardados sejam aceitos: ${paths}. Leia-os, junto com o relatório da revisão no pull request, e comente \`/codeman accept-workflows\`. O pull request continua em rascunho até lá, porque, mergeados agora, eles nunca rodariam.`,
  stageDecisions: (stage, count) =>
    `A ${OF_STAGE(stage)} precisa de ${count} decisão(ões) dos mantenedores.`,
  reviewRounds: (rounds, max) =>
    `A revisão devolveu o trabalho à etapa de código ${rounds} vezes seguidas (\`max-runs\` é ${max}). Comente \`/codeman continue <orientação>\` para continuar.`,
  skipped: (reason) => `Pulada: ${reason}`,
  routeChosen: (stages) => `O agente de roteamento escolheu estas etapas, nesta ordem: ${stages}.`,
  routeLabel: "Rota",
  leftOutLabel: "Deixadas de fora",
  routeFallback: (stages) =>
    `O Codeman não conseguiu usar o resultado do agente de roteamento, então as etapas rodam na ordem fixa: ${stages}.`,
  workDone:
    "O trabalho está feito e revisado. Revise o pull request. Para pedir mudanças, envie uma revisão pedindo-as ou comente `/codeman fix <o que mudar>` no pull request.",

  accepted: (by, paths) =>
    `${by} aceitou ${paths}, agora em \`.github/workflows/\` na branch da tarefa.`,
  acceptWaits: "O Codeman continua quando essas execuções terminarem.",
  acceptResumes: (stage) => `A ${OF_STAGE(stage)} continua.`,
  nothingStaged: "Não há workflows guardados para aceitar.",
  stagedChanged: "Os workflows guardados mudaram depois de terem sido aceitos.",
  stagedChangedDetail: (by, paths) =>
    `Mudaram depois do comentário de ${by}: ${paths}. Leia-os de novo e comente \`/codeman accept-workflows\` outra vez.`,

  allAnswered:
    "Todas as decisões foram respondidas. O Codeman implementa o plano na próxima rodada.",
  stillPending: (count) => `${count} decisão(ões) ainda precisam de resposta.`,
  commandProblem: (problem) => {
    switch (problem.kind) {
      case "takes-no-arguments":
        return `\`${problem.command}\` não recebe argumentos.`;
      case "unknown-command":
        return "Comando desconhecido. Use `decide`, `approve`, `answer`, `replan`, `fix`, `continue`, `accept-workflows`, `set` ou `model`.";
      case "not-in-description":
        return "Na descrição da issue, só `set` e `model` funcionam. Escreva os outros comandos em um comentário.";
      case "answer-needs-number":
        return "`answer` precisa do número de uma decisão, como em `answer 2 <texto>`.";
      case "answer-needs-text":
        return "`answer` precisa de um texto depois do número da decisão.";
      case "decide-needs-answers":
        return "`decide` precisa de respostas como `1 a` ou `1=a`.";
      case "not-an-answer":
        return `\`${problem.arg}\` não é uma resposta como \`1 a\` ou \`1=a\`.`;
      case "set-which":
        return `\`set\` muda, nesta tarefa, uma destas configurações: ${problem.names.map((name) => `\`${name}\``).join(", ")}.`;
      case "set-one-value":
        return `\`set ${problem.name}\` precisa de um valor.`;
      case "invalid-setting":
        return {
          model: `\`${problem.name}\` precisa ser o ID de um modelo, como \`provedor/modelo\` no OpenRouter ou \`qwen3-coder:30b\` no Ollama.`,
          language: `\`${problem.name}\` precisa ser \`auto\` ou a tag de um idioma, como \`pt-BR\`.`,
          number: `\`${problem.name}\` precisa ser um número positivo.`,
          integer: `\`${problem.name}\` precisa ser um número inteiro positivo.`,
          choice: `\`${problem.name}\` precisa ser um destes valores: ${(problem.values ?? []).map((value) => `\`${value}\``).join(", ")}.`,
          "gpu-type": `\`${problem.name}\` precisa ser um tipo de GPU, como \`NVIDIA RTX A6000\`.`,
          endpoint: `\`${problem.name}\` precisa ser o ID de um endpoint, com letras e dígitos.`,
        }[problem.type];
      case "settings-rejected":
        return `As configurações da tarefa não foram aplicadas: ${problem.error}`;
      case "text-too-long":
        return `O texto pode ter no máximo ${problem.max} caracteres.`;
      case "no-decision":
        return `A decisão ${problem.id} não existe.`;
      case "no-option":
        return `A decisão ${problem.id} não tem a opção \`${problem.option}\`.`;
    }
  },
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
