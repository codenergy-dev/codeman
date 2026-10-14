import type { RepositoryRef } from "../platform/types.ts";

/**
 * Where Codeman keeps its documents in the store (docs/backend/data-layout.md). What belongs to an
 * organization, the repository's owner (a user account is its own organization), is under it:
 * its runs and events, which the budgets read. What a pool of organizations shares is under the
 * pool (decision 9 of the plan for GPU batches across repositories): the pod registry, the
 * Serverless endpoints' runs, the board and the batches. The cache of fits is shared by all.
 * Owners, repositories and pools are lowercase, as GitHub compares them.
 *
 * The budgets' queries (an organization's or a repository's runs of a month, a task's runs)
 * filter on equality only, which Firestore's automatic indexes serve.
 */
export const LAYOUT = {
  organization: (owner: string) => `organizations/${documentId(owner.toLowerCase())}`,
  /** A run of a task's agent: one per task a workflow run's attempt picked for an agent. */
  runs: (owner: string) => `${LAYOUT.organization(owner)}/runs`,
  run: (owner: string, run: string) => `${LAYOUT.runs(owner)}/${documentId(run)}`,
  /** What the jobs did, one document each, named after its run and what happened. */
  events: (owner: string) => `${LAYOUT.organization(owner)}/events`,
  event: (owner: string, event: string) => `${LAYOUT.events(owner)}/${documentId(event)}`,
  /**
   * The pod registry of an organization before pools, kept as history: the organization's month
   * still counts the time its pods' tasks did not.
   */
  organizationPods: (owner: string) => `${LAYOUT.organization(owner)}/pods`,
  /** A pool, by its ID: its members' logins joined by `+`. */
  pool: (pool: string) => `pools/${documentId(pool.toLowerCase())}`,
  /**
   * The pod registry: a pod Codeman created, named by the nonce of its admin token, which the
   * task that creates it draws first; with the leases of the tasks that use or keep it.
   */
  pods: (pool: string) => `${LAYOUT.pool(pool)}/pods`,
  pod: (pool: string, nonce: string) => `${LAYOUT.pods(pool)}/${documentId(nonce)}`,
  /**
   * The board: each repository's ready tasks that a pod could serve, as its last `select` saw
   * them, named by the repository (`owner/name`).
   */
  board: (pool: string) => `${LAYOUT.pool(pool)}/board`,
  boardEntry: (pool: string, repository: string) =>
    `${LAYOUT.board(pool)}/${documentId(repository.toLowerCase())}`,
  /** A batch: the tasks, of any repository of the pool, that one pod serves at once. */
  batches: (pool: string) => `${LAYOUT.pool(pool)}/batches`,
  batch: (pool: string, id: string) => `${LAYOUT.batches(pool)}/${documentId(id)}`,
  /**
   * The cache of fits: the context a pod's model fitted its GPU with, for one combination of
   * image, model, GPU type and engine settings, named by their hash (decision 4 of the plan for
   * fitting Ollama to the GPU). It depends on nothing an organization owns.
   */
  contexts: () => "contexts",
  context: (key: string) => `${LAYOUT.contexts()}/${documentId(key)}`,
  /**
   * A Serverless endpoint of the pool's GPU account, by its ID; under it, each run's billed times
   * on the endpoint's worker, named by the run and its reservation, which the ledger splits among
   * the runs that used the worker at once.
   */
  endpoint: (pool: string, endpoint: string) =>
    `${LAYOUT.pool(pool)}/endpoints/${documentId(endpoint)}`,
  endpointRuns: (pool: string, endpoint: string) => `${LAYOUT.endpoint(pool, endpoint)}/runs`,
  endpointRun: (pool: string, endpoint: string, id: string) =>
    `${LAYOUT.endpointRuns(pool, endpoint)}/${documentId(id)}`,
} as const;

/**
 * A run's ID in the ledger: the workflow run, the attempt that picked the task, and the task.
 * Workflow runs' IDs are unique and grow with time, so runs sort in the order they started. A
 * re-run of failed jobs keeps the attempt that picked the task, and so the run's documents; a
 * re-run of the whole workflow picks again, as a new run.
 */
export function ledgerRunId(workflowRun: string, attempt: number, task: number): string {
  return `${workflowRun}-${attempt}-${task}`;
}

/** The month a run counts in, for the budgets' queries: its UTC month, such as `2026-10`. */
export function ledgerMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function isLedgerRunId(text: string): boolean {
  return /^\d+-\d+-\d+$/.test(text);
}

/** The repository as the ledger names it in its documents' fields: `owner/name`, lowercase. */
export function repositoryName(repository: RepositoryRef): string {
  return `${repository.owner}/${repository.name}`.toLowerCase();
}

/**
 * A valid Firestore document ID for `text`, and another for each other text: `/` and `%` are
 * escaped, and the IDs Firestore reserves (`.`, `..`, `__…__`) get a `%` before them, which
 * escaping never puts before `.` or `_`.
 */
export function documentId(text: string): string {
  if (text === "") throw new Error("A document ID may not be empty.");
  const escaped = text.replaceAll("%", "%25").replaceAll("/", "%2F");
  return escaped === "." || escaped === ".." || /^__.*__$/.test(escaped) ? `%${escaped}` : escaped;
}
