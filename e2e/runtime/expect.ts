import type { StoreReader } from "../../src/store/store.ts";
import type { FakeClient, Fakes } from "./fakes.ts";
import type { IssueRecord, RemoteGitHub } from "./github.ts";
import type {
  CommentMatch,
  EngineMatch,
  Expectation,
  FakeMatch,
  Pattern,
  PodMatch,
  StoreMatch,
} from "./scenario/schema.ts";

/**
 * What an `expect`, a `wait` or an `advance`'s `until` checks, against the fakes and the store.
 * `check` returns what does not hold, one line each: an empty list is a pass.
 */

/** What the checks read, and the refs the scenario defined so far. */
export interface CheckContext {
  github: RemoteGitHub;
  fakes: Fakes;
  store: StoreReader;
  /** Issue refs, with their repository and number. */
  issues: ReadonlyMap<string, { repo: string; number: number }>;
  /** Pod refs, with the fake Runpod's pod ID; `ref` checks add to it. */
  pods: Map<string, string>;
  /**
   * A pod's engine: the gateway's `/admin/status`, Ollama's `/api/ps`, and vLLM's first model of
   * `/v1/models` with its `metrics` (`vllmMetrics`).
   */
  engine?(
    podId: string,
  ): Promise<{ gateway?: unknown; ollama?: unknown; vllm?: unknown; tee?: unknown }>;
}

export async function check(expectation: Expectation, context: CheckContext): Promise<string[]> {
  const problems: string[] = [];
  const issueRef = expectation.issue;
  const issue = issueRef ? context.issues.get(issueRef) : undefined;
  if (issueRef && !issue) return [`The scenario has not opened ${issueRef}.`];
  let record: IssueRecord | undefined;
  let all: IssueRecord[] = [];
  const needsIssue =
    expectation.labels ||
    expectation.noLabels ||
    expectation.comments ||
    expectation.pullRequest ||
    expectation.commits;
  if (issue && needsIssue) {
    all = await context.github.issues(issue.repo);
    record = all.find((candidate) => candidate.number === issue.number);
    if (!record) return [`${issueRef} (#${issue.number}) is not on ${issue.repo}.`];
  }
  const names = (record?.labels ?? []).map((label) => label.name);
  for (const label of expectation.labels ?? []) {
    if (!names.includes(label)) {
      problems.push(`${issueRef} lacks the label ${label}; it has ${list(names)}.`);
    }
  }
  for (const label of expectation.noLabels ?? []) {
    if (names.includes(label)) problems.push(`${issueRef} has the label ${label}.`);
  }
  for (const match of expectation.comments ?? []) {
    const problem = commentProblem(match, record?.comment_list ?? []);
    if (problem) problems.push(`${issueRef}: ${problem}`);
  }
  if (issue && record && (expectation.pullRequest || expectation.commits)) {
    const pull = taskPull(all, issue.number);
    if (expectation.pullRequest === "none") {
      if (pull) problems.push(`${issueRef} has a pull request, #${pull.number}.`);
    } else if (expectation.pullRequest) {
      const want = expectation.pullRequest;
      if (!pull) problems.push(`${issueRef} has no pull request.`);
      else {
        if (want.ready !== undefined && want.ready === Boolean(pull.draft)) {
          problems.push(
            `${issueRef}'s pull request #${pull.number} is ${pull.draft ? "a draft" : "ready"}.`,
          );
        }
        if (want.state && pull.state !== want.state) {
          problems.push(`${issueRef}'s pull request is ${pull.state}, not ${want.state}.`);
        }
        if (want.files.length > 0) {
          const changed = await changedFiles(
            context.github,
            issue.repo,
            pull.base ?? "",
            pull.head ?? "",
          );
          for (const file of want.files) {
            if (!changed.files.includes(file)) {
              problems.push(
                `${issueRef}'s pull request does not change ${file}; it changes ${list(changed.files)}.`,
              );
            }
          }
        }
      }
    }
    if (expectation.commits) {
      const want = expectation.commits;
      const branch =
        want.branch ?? pull?.head ?? (await taskBranch(context.github, issue.repo, issue.number));
      if (!branch) problems.push(`${issueRef} has no task branch.`);
      else {
        const base = context.github.repository(issue.repo).defaultBranch;
        const changed = await changedFiles(context.github, issue.repo, base, branch);
        if (want.count) {
          const problem = matches(want.count, changed.messages.length);
          if (problem) problems.push(`${branch}'s commits: ${problem}.`);
        }
        for (const file of want.files) {
          if (!changed.files.includes(file)) problems.push(`${branch} does not change ${file}.`);
        }
        for (const file of want.noFiles) {
          if (changed.files.includes(file)) problems.push(`${branch} changes ${file}.`);
        }
        if (
          want.message &&
          !changed.messages.some((message) => message.includes(want.message as string))
        ) {
          problems.push(
            `No commit of ${branch} says "${want.message}": ${list(changed.messages)}.`,
          );
        }
      }
    }
  }
  for (const match of expectation.store ?? []) {
    problems.push(...(await storeProblems(match, context.store)));
  }
  if (expectation.ledger) {
    const owners = issue
      ? [issue.repo.split("/")[0] ?? ""]
      : [...new Set([...context.issues.values()].map((one) => one.repo.split("/")[0] ?? ""))];
    let runs: Record<string, unknown>[] = [];
    for (const owner of owners) {
      const documents = await context.store.query(`organizations/${owner.toLowerCase()}/runs`);
      runs.push(...documents.map((document) => document.fields as Record<string, unknown>));
    }
    if (issue) {
      const name = issue.repo.toLowerCase();
      runs = runs.filter(
        (run) =>
          Number(run.task) === issue.number &&
          (run.repository === undefined ||
            [name, name.split("/")[1]].includes(String(run.repository).toLowerCase())),
      );
    }
    const cost = runs.reduce(
      (total, run) => total + (typeof run.cost === "number" ? run.cost : 0),
      0,
    );
    const ledger = expectation.ledger;
    if (ledger.costAtMost !== undefined && cost > ledger.costAtMost) {
      problems.push(`The ledger's cost is ${cost}, above ${ledger.costAtMost}.`);
    }
    if (ledger.costAtLeast !== undefined && cost < ledger.costAtLeast) {
      problems.push(`The ledger's cost is ${cost}, below ${ledger.costAtLeast}.`);
    }
    if (ledger.runs) {
      const problem = matches(ledger.runs, runs.length);
      if (problem) problems.push(`The ledger's runs: ${problem}.`);
    }
    if (ledger.splitOn) {
      problems.push(...(await splitProblems(ledger.splitOn, owners, runs, context.store)));
    }
    if (ledger.splitPod) {
      const id = context.pods.get(ledger.splitPod);
      if (!id) problems.push(`No pod ${ledger.splitPod}.`);
      else problems.push(...(await podSplitProblems(id, owners, runs, context.store)));
    }
  }
  for (const match of expectation.fakes ?? []) {
    problems.push(...(await fakeProblems(match, context.fakes)));
  }
  for (const match of expectation.pods ?? []) {
    problems.push(...(await podProblems(match, context)));
  }
  if (expectation.engine) problems.push(...(await engineProblems(expectation.engine, context)));
  if (expectation.violations === "none") problems.push(...(await violations(context)));
  return problems;
}

/**
 * Whether the runs on a Serverless endpoint split its worker's time, recomputed from what
 * `close-key` wrote under the endpoint (docs/backend/data-layout.md, "Serverless endpoint runs"):
 * at least two runs whose billed times overlap; each closed ledger run's `cost` is its share;
 * no share is above its own estimate; and the shares add up to the union of the billed times at
 * the worker's price, which is less than the estimates' sum.
 */
async function splitProblems(
  endpoint: string,
  owners: string[],
  ledgerRuns: Record<string, unknown>[],
  store: StoreReader,
): Promise<string[]> {
  const problems: string[] = [];
  const documents: Record<string, unknown>[] = [];
  for (const owner of owners) {
    const organization = await store.get(`organizations/${owner.toLowerCase()}`);
    const pool = String(organization?.fields.pool ?? owner.toLowerCase());
    for (const document of await store.query(`pools/${pool}/endpoints/${endpoint}/runs`)) {
      documents.push(document.fields as Record<string, unknown>);
    }
  }
  if (documents.length < 2) {
    return [`Endpoint ${endpoint} has ${documents.length} runs in the ledger; a split needs 2.`];
  }
  const spans: [number, number][] = [];
  let shares = 0;
  let estimates = 0;
  let price = 0;
  for (const document of documents) {
    const busy = JSON.parse(String(document.busy ?? "[]")) as [number, number][];
    spans.push(...busy);
    const share = Number(document.share);
    const estimate = Number(document.estimate);
    price = Number(document.pricePerSecond);
    shares += share;
    estimates += estimate;
    if (share > estimate + 1e-6) {
      problems.push(
        `Run ${String(document.run)}'s share ${share} is above its estimate ${estimate}.`,
      );
    }
    const run = ledgerRuns.find((one) => one.endpoint === endpoint && sameRun(one, document));
    if (!run) problems.push(`The ledger has no closed run for ${String(document.run)}.`);
    else if (Math.abs(Number(run.cost) - share) > 1e-6) {
      problems.push(
        `Run ${String(document.run)} costs ${String(run.cost)}, not its share ${share}.`,
      );
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let union = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const [from, to] of spans) {
    if (to <= end) continue;
    union += to - Math.max(from, end);
    end = to;
  }
  const billed = (union / 1000) * price;
  // Each share is rounded, as the ledger keeps costs.
  if (Math.abs(shares - billed) > 1e-5 * documents.length) {
    problems.push(`The shares add up to ${shares}, not the worker's billed time, ${billed}.`);
  }
  if (estimates - billed < 1e-6) {
    problems.push(
      `The runs on endpoint ${endpoint} did not overlap: their estimates add up to ${estimates}.`,
    );
  }
  return problems;
}

/**
 * Whether the runs on a pod split its time (docs/inference/pods.md, "Splitting"), from the
 * ledger's closed runs on it and its registry document: at least two runs; each one's cost is
 * below the pod's time from its creation to the run's close, the most a run alone would count;
 * and their costs add up to no more than the pod's time until the last close, and to no less
 * than its time from the last run's opening to the last close, when every run was on it.
 */
async function podSplitProblems(
  pod: string,
  owners: string[],
  ledgerRuns: Record<string, unknown>[],
  store: StoreReader,
): Promise<string[]> {
  const runs = ledgerRuns.filter((run) => run.pod === pod && run.status === "closed");
  if (runs.length < 2) return [`Pod ${pod} has ${runs.length} closed runs; a split needs 2.`];
  let record: Record<string, unknown> | undefined;
  for (const owner of owners) {
    const organization = await store.get(`organizations/${owner.toLowerCase()}`);
    const pool = String(organization?.fields.pool ?? owner.toLowerCase());
    const found = (await store.query(`pools/${pool}/pods`)).find(
      (document) => document.fields.pod === pod,
    );
    if (found) record = found.fields as Record<string, unknown>;
  }
  if (!record) return [`No registry document holds pod ${pod}.`];
  const price = Number(record.pricePerSecond);
  const created = time(record.createdAt);
  if (!Number.isFinite(price) || created === undefined) {
    return [`Pod ${pod}'s document has no price or creation time.`];
  }
  const problems: string[] = [];
  let shares = 0;
  let lastOpen = Number.NEGATIVE_INFINITY;
  let lastClose = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    const cost = Number(run.cost);
    const opened = time(run.openedAt);
    const closed = time(run.closedAt);
    const name = `${String(run.workflowRun)}-${String(run.attempt)}-${String(run.task)}`;
    if (!Number.isFinite(cost) || opened === undefined || closed === undefined) {
      problems.push(`Run ${name} has no cost, opening or close.`);
      continue;
    }
    shares += cost;
    lastOpen = Math.max(lastOpen, opened);
    lastClose = Math.max(lastClose, closed);
    const alone = ((closed - created) / 1000) * price;
    if (cost >= alone - 1e-9) {
      problems.push(`Run ${name} costs ${cost}, the pod's whole time while it ran (${alone}).`);
    }
  }
  if (problems.length > 0) return problems;
  const most = ((lastClose - created) / 1000) * price;
  const least = ((lastClose - lastOpen) / 1000) * price;
  // Each cost is rounded, as the ledger keeps costs.
  if (shares > most + 1e-5 * runs.length) {
    problems.push(`The runs on pod ${pod} cost ${shares}, above the pod's time, ${most}.`);
  }
  if (shares < least - 1e-5 * runs.length) {
    problems.push(
      `The runs on pod ${pod} cost ${shares}, below the pod's time while all ran, ${least}.`,
    );
  }
  return problems;
}

/** A stored time in milliseconds, from a date or its text. */
function time(value: unknown): number | undefined {
  const at =
    value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : undefined;
}

/** Whether a ledger run is the endpoint document's: run IDs are `{workflow run}-{attempt}-{task}`. */
function sameRun(run: Record<string, unknown>, document: Record<string, unknown>): boolean {
  return (
    String(document.run) === `${String(run.workflowRun)}-${String(run.attempt)}-${String(run.task)}`
  );
}

/** What the fakes refused: tokens the fake GitHub did not give, requests no script covered. */
export async function violations(context: {
  github: RemoteGitHub;
  fakes: Fakes;
}): Promise<string[]> {
  const problems: string[] = [];
  for (const violation of await context.github.violations()) {
    problems.push(
      `The fake GitHub saw a violation: ${violation.kind}${violation.method ? ` on ${violation.method} ${violation.path}` : ""}: ${violation.detail}`,
    );
  }
  const unscripted = await context.fakes.llm.json<{ reason?: string; message?: string }[]>(
    "GET",
    "/llm/violations",
  );
  for (const violation of unscripted) {
    problems.push(
      `The scripted model got a request no script covers: ${violation.reason ?? violation.message ?? JSON.stringify(violation)}`,
    );
  }
  return problems;
}

/** The pull request of the task on issue `number`: its head is `codeman/<number>-...`. */
export function taskPull(issues: IssueRecord[], number: number): IssueRecord | undefined {
  return issues
    .filter((issue) => issue.pull_request !== undefined && isTaskBranch(issue.head, number))
    .at(-1);
}

function isTaskBranch(branch: string | undefined, number: number): boolean {
  return branch === `codeman/${number}` || (branch?.startsWith(`codeman/${number}-`) ?? false);
}

export async function taskBranch(
  github: RemoteGitHub,
  repository: string,
  number: number,
): Promise<string | undefined> {
  const answer = await github.rest(
    repository,
    "GET",
    `/repos/${repository}/git/matching-refs/heads/codeman/${number}`,
    { ok: (status) => status === 200 || status === 404 },
  );
  const refs = Array.isArray(answer.json) ? (answer.json as { ref: string }[]) : [];
  return refs
    .map((ref) => ref.ref.replace(/^refs\/heads\//, ""))
    .find((branch) => isTaskBranch(branch, number));
}

async function changedFiles(
  github: RemoteGitHub,
  repository: string,
  base: string,
  head: string,
): Promise<{ files: string[]; messages: string[] }> {
  const answer = await github.rest(
    repository,
    "GET",
    `/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    { ok: (status) => status === 200 || status === 404 },
  );
  if (answer.status !== 200) return { files: [], messages: [] };
  const compare = answer.json as {
    files: { filename: string }[];
    commits: { commit: { message: string } }[];
  };
  return {
    files: compare.files.map((file) => file.filename),
    messages: compare.commits.map((commit) => commit.commit.message),
  };
}

const MARKERS: Record<string, (body: string) => boolean> = {
  status: (body) => /<!-- codeman:status [A-Za-z0-9_-]* -->/.test(body),
  decisions: (body) => body.includes("<!-- codeman:decisions -->"),
  run: (body) => body.startsWith("<!-- codeman:run -->"),
  any: () => true,
};

function commentProblem(
  match: CommentMatch,
  comments: IssueRecord["comment_list"],
): string | undefined {
  const found = comments.filter(
    (comment) =>
      (MARKERS[match.kind] ?? MARKERS.any)?.(comment.body) &&
      match.contains.every((text) => comment.body.includes(text)) &&
      (match.by === undefined || comment.user.login === match.by),
  );
  const what = `${match.kind === "any" ? "a" : `a ${match.kind}`} comment${match.contains.length ? ` with ${list(match.contains.map((text) => `"${text}"`))}` : ""}${match.by ? ` by ${match.by}` : ""}`;
  if (match.count) {
    const problem = matches(match.count, found.length);
    return problem ? `${what}: ${problem}` : undefined;
  }
  if (found.length > 0) return undefined;
  const kinds = comments.map((comment) => firstLine(comment.body));
  return `no ${what}; its comments: ${list(kinds)}`;
}

async function storeProblems(match: StoreMatch, store: StoreReader): Promise<string[]> {
  if ("doc" in match) {
    const document = await store.get(match.doc);
    if (match.absent) return document ? [`The store has ${match.doc}.`] : [];
    if (!document) return [`The store has no ${match.doc}.`];
    if (!match.fields) return [];
    const problem = matches({ kind: "object", fields: match.fields }, plain(document.fields));
    return problem ? [`${match.doc}: ${problem}`] : [];
  }
  const documents = await store.query(match.collection);
  const found = documents.filter(
    (document) =>
      !match.where || !matches({ kind: "object", fields: match.where }, plain(document.fields)),
  );
  if (match.count) {
    const problem = matches(match.count, found.length);
    return problem ? [`${match.collection}'s documents: ${problem}.`] : [];
  }
  return found.length > 0 ? [] : [`No document of ${match.collection} matches.`];
}

/** A fake's list, by the schema's names. */
export async function fakeList(fakes: Fakes, fake: string, list: string): Promise<unknown[]> {
  const client = (fakes as unknown as Record<string, FakeClient>)[fake];
  if (!client || typeof client === "string") throw new Error(`No fake ${fake}.`);
  if (list === "requests") return client.requests();
  const paths: Record<string, string> = {
    "github.events": "/github/events",
    "github.dispatches": "/github/dispatches",
    "github.runs": "/github/runs",
    "github.violations": "/github/violations",
    "openrouter.keys": "/openrouter/keys",
    "openrouter.generations": "/openrouter/generations",
    "runpod.jobs": "/runpod/jobs",
    "runpod.pods": "/runpod/pods",
    "llm.turns": "/llm/turns",
    "llm.violations": "/llm/violations",
  };
  const path = paths[`${fake}.${list}`];
  if (!path) throw new Error(`The ${fake} fake has no list ${list}.`);
  return client.json<unknown[]>("GET", path);
}

async function fakeProblems(match: FakeMatch, fakes: Fakes): Promise<string[]> {
  const items = await fakeList(fakes, match.fake, match.list);
  const found = items.filter(
    (item) => !match.where || !matches({ kind: "object", fields: match.where }, item),
  );
  const what = `The ${match.fake} fake's ${match.list}`;
  if (match.count) {
    const problem = matches(match.count, found.length);
    return problem ? [`${what}: ${problem}${match.where ? " matching" : ""}.`] : [];
  }
  return found.length > 0 ? [] : [`${what}: none matches, of ${items.length}.`];
}

async function podProblems(match: PodMatch, context: CheckContext): Promise<string[]> {
  const pods = await context.fakes.runpod.json<Record<string, unknown>[]>("GET", "/runpod/pods");
  const fits = (pod: Record<string, unknown>) =>
    (match.status === undefined || pod.status === match.status) &&
    (!match.where || !matches({ kind: "object", fields: match.where }, pod));
  if (match.pod) {
    const id = context.pods.get(match.pod);
    const pod = pods.find((candidate) => candidate.id === id);
    if (!pod) return [`No pod ${match.pod} (${id}).`];
    return fits(pod)
      ? []
      : [`Pod ${match.pod} is ${String(pod.status)}: ${describeMismatch(match, pod)}`];
  }
  const found = pods.filter(fits);
  if (match.ref) {
    const pod = found.at(-1);
    if (!pod) return [`No pod matches for ${match.ref}, of ${pods.length}.`];
    context.pods.set(match.ref, String(pod.id));
    return [];
  }
  if (match.count) {
    const problem = matches(match.count, found.length);
    return problem ? [`The pods: ${problem}.`] : [];
  }
  return found.length > 0 ? [] : [`No pod matches, of ${pods.length}.`];
}

function describeMismatch(match: PodMatch, pod: Record<string, unknown>): string {
  if (match.status !== undefined && pod.status !== match.status) return `not ${match.status}`;
  return match.where ? (matches({ kind: "object", fields: match.where }, pod) ?? "") : "";
}

async function engineProblems(match: EngineMatch, context: CheckContext): Promise<string[]> {
  if (!context.engine) return ["The runtime cannot read pods' engines here."];
  let id: string | undefined;
  if (match.pod) id = context.pods.get(match.pod);
  else {
    const pods = await context.fakes.runpod.json<{ id: string; status: string }[]>(
      "GET",
      "/runpod/pods",
    );
    const live = pods.filter((pod) => pod.status !== "TERMINATED");
    if (live.length !== 1) return [`The engine check needs one pod; there are ${live.length}.`];
    id = live[0]?.id;
  }
  if (!id) return [`No pod ${match.pod ?? ""}.`];
  let status: Awaited<ReturnType<NonNullable<CheckContext["engine"]>>>;
  try {
    status = await context.engine(id);
  } catch (error) {
    return [`Pod ${match.pod ?? id}'s engine cannot be read: ${(error as Error).message}`];
  }
  const problems: string[] = [];
  for (const source of ["gateway", "ollama", "vllm", "tee"] as const) {
    const fields = match[source];
    if (!fields) continue;
    const problem = matches({ kind: "object", fields }, status[source]);
    if (problem) problems.push(`The pod's ${source}: ${problem}`);
  }
  return problems;
}

/** What the tee saw at the engine, as `engine.tee` checks it. */
export interface TeeStatus {
  /** The chat requests it took, the agents' and the others, such as the gateway's probe. */
  requests: number;
  /** The agents' requests, for which the engine got the short prompt. */
  agent: number;
  /**
   * The most agents' requests the tee had at the engine at once, from their start and end there:
   * those the engine ran, and those it queued.
   */
  overlap: number;
  /**
   * The most issues whose agents' requests the tee had at the engine at once: how many tasks'
   * agents met there. Only the turns the scripted model tells the issue of count, not the first
   * turn nor the title.
   */
  issues: number;
  /** The engine's runner processes, such as Ollama's `llama-server`, with `context` and `parallel`. */
  runners: unknown[];
  /** The runners' slots, each with its context (`n_ctx`): llama-server's `/slots`. */
  slots: unknown[];
  /**
   * The most slots that processed at once, or for vLLM the most requests its `/metrics` said were
   * running, as the tee sampled them: what the engine ran together.
   */
  busiest: number | undefined;
  /** The most requests vLLM's `/metrics` said were waiting, as the tee sampled them. */
  waiting: number | undefined;
}

/**
 * The tee's records (`GET /_fake/tee/requests`), runners (`GET /_fake/tee/runners`) and slots
 * (`GET /_fake/tee/slots`) as the check reads them. A request still at the engine counts as open until now.
 */
export function teeStatus(
  records: readonly {
    kind?: unknown;
    identified?: { issue?: unknown };
    engine?: { start?: unknown; end?: unknown };
  }[],
  runners: readonly unknown[],
  slots?: { slots?: unknown; busiest?: unknown; waiting?: unknown; samples?: unknown },
): TeeStatus {
  const agent = records.filter((record) => record.kind === "agent");
  const edges: [number, number, string | undefined][] = [];
  for (const record of agent) {
    const start = Number(record.engine?.start);
    if (!Number.isFinite(start)) continue;
    const end = Number(record.engine?.end ?? Number.POSITIVE_INFINITY);
    const issue = record.identified?.issue;
    const of = typeof issue === "string" ? issue : undefined;
    edges.push([start, 1, of], [Number.isNaN(end) ? Number.POSITIVE_INFINITY : end, -1, of]);
  }
  // At a tie, an end goes first: a request that ends as another starts did not overlap it.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let overlap = 0;
  const atEngine = new Map<string, number>();
  let issues = 0;
  for (const [, step, issue] of edges) {
    open += step;
    overlap = Math.max(overlap, open);
    if (issue === undefined) continue;
    const left = (atEngine.get(issue) ?? 0) + step;
    if (left > 0) atEngine.set(issue, left);
    else atEngine.delete(issue);
    issues = Math.max(issues, atEngine.size);
  }
  return {
    requests: records.length,
    agent: agent.length,
    overlap,
    issues,
    runners: [...runners],
    slots: Array.isArray(slots?.slots) ? slots.slots : [],
    busiest: typeof slots?.busiest === "number" ? slots.busiest : undefined,
    waiting: typeof slots?.waiting === "number" ? slots.waiting : undefined,
  };
}

/** The labels every vLLM metric has (docs/web/vllm/vllm-v1-metrics-loggers-py-at-v0-31-0.md). */
const VLLM_LABELS = new Set(["model_name", "engine"]);

/**
 * vLLM's `/metrics`, by sample: the `vllm:` metrics under their name, with their labels other
 * than `model_name` and `engine` in braces, such as
 * `vllm:num_requests_waiting_by_reason{reason="capacity"}`, so samples of one metric stay apart.
 * An info gauge, such as `vllm:cache_config_info`, permanently 1, gives its labels instead.
 */
export function vllmMetrics(text: string): Record<string, number | Record<string, string>> {
  const metrics: Record<string, number | Record<string, string>> = {};
  for (const line of text.split("\n")) {
    const found = /^(vllm:[A-Za-z0-9_:]+)(?:\{(.*)\})? (\S+)(?: \d+)?$/.exec(line.trim());
    if (!found?.[1] || found[3] === undefined) continue;
    const labels: Record<string, string> = {};
    for (const label of (found[2] ?? "").matchAll(
      /([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\]|\\.)*)"/g,
    )) {
      const [, name = "", value = ""] = label;
      if (!VLLM_LABELS.has(name))
        labels[name] = value.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
    }
    if (found[1].endsWith("_info")) {
      metrics[found[1]] = labels;
      continue;
    }
    const extra = Object.entries(labels)
      .map(([name, value]) => `${name}="${value}"`)
      .join(",");
    metrics[extra ? `${found[1]}{${extra}}` : found[1]] = Number(found[3]);
  }
  return metrics;
}

/** Why `value` does not match `pattern`; undefined when it does. */
export function matches(pattern: Pattern, value: unknown, at = ""): string | undefined {
  const where = at ? `${at}: ` : "";
  switch (pattern.kind) {
    case "equals": {
      const same =
        value === pattern.value ||
        (typeof value === "number" &&
          typeof pattern.value === "string" &&
          String(value) === pattern.value) ||
        (typeof value === "string" &&
          typeof pattern.value === "number" &&
          value === String(pattern.value)) ||
        (value instanceof Date &&
          typeof pattern.value === "string" &&
          value.toISOString() === pattern.value);
      return same ? undefined : `${where}${show(value)}, not ${show(pattern.value)}`;
    }
    case "range": {
      // A list matches by its length, such as a pod's seats.
      const number = Array.isArray(value)
        ? value.length
        : typeof value === "number"
          ? value
          : Number(value);
      if (value === undefined || value === null || Number.isNaN(number)) {
        return `${where}${show(value)} is not a number`;
      }
      if (pattern.atLeast !== undefined && number < pattern.atLeast) {
        return `${where}${number}, below ${pattern.atLeast}`;
      }
      if (pattern.atMost !== undefined && number > pattern.atMost) {
        return `${where}${number}, above ${pattern.atMost}`;
      }
      return undefined;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `${where}${show(value)} is not an object`;
      }
      for (const [name, field] of Object.entries(pattern.fields)) {
        const problem = matches(
          field,
          (value as Record<string, unknown>)[name],
          at ? `${at}.${name}` : name,
        );
        if (problem) return problem;
      }
      return undefined;
    }
    case "list": {
      if (!Array.isArray(value)) return `${where}${show(value)} is not a list`;
      if (value.length !== pattern.items.length) {
        return `${where}${value.length} items, not ${pattern.items.length}`;
      }
      for (const [index, item] of pattern.items.entries()) {
        const problem = matches(item, value[index], `${at}[${index}]`);
        if (problem) return problem;
      }
      return undefined;
    }
  }
}

/** A store document's fields as plain values: dates as ISO text. */
function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

/** An expectation in a few words, for messages. */
export function describe(expectation: Expectation): string {
  const parts: string[] = [];
  if (expectation.labels) parts.push(`labels ${expectation.labels.join(", ")}`);
  if (expectation.noLabels) parts.push(`no labels ${expectation.noLabels.join(", ")}`);
  if (expectation.comments) parts.push(`${expectation.comments.length} comment checks`);
  if (expectation.pullRequest) parts.push("a pull request check");
  if (expectation.commits) parts.push("a commits check");
  if (expectation.store) parts.push("store checks");
  if (expectation.ledger) parts.push("a ledger check");
  if (expectation.fakes) parts.push("fake checks");
  if (expectation.pods) parts.push("pod checks");
  if (expectation.engine) parts.push("an engine check");
  if (expectation.violations) parts.push("no violations");
  return `${expectation.issue ? `${expectation.issue}: ` : ""}${parts.join("; ")}`;
}

function show(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

function list(items: string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}

function firstLine(text: string): string {
  const line = text.split("\n").find((one) => one.trim() !== "" && !one.startsWith("<!--")) ?? "";
  return JSON.stringify(line.slice(0, 80));
}
