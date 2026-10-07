import type { RepositoryRef } from "../platform/types.ts";

/**
 * Where Codeman keeps its documents in the store (docs/architecture.md#backend). Everything
 * belongs to an organization, the repository's owner (a user account is its own organization),
 * so one Firebase project serves several organizations, and a repository's documents carry it
 * in a field. Owners and repositories are lowercase, as GitHub compares them.
 *
 * The queries the next plans need (an organization's or a repository's runs of a month, a
 * task's runs) filter on equality only, which Firestore's automatic indexes serve.
 */
export const LAYOUT = {
  organization: (owner: string) => `organizations/${documentId(owner.toLowerCase())}`,
  /** A run of a task's agent: one per task a workflow run's attempt picked for an agent. */
  runs: (owner: string) => `${LAYOUT.organization(owner)}/runs`,
  run: (owner: string, run: string) => `${LAYOUT.runs(owner)}/${documentId(run)}`,
  /** What the jobs did, one document each, named after its run and what happened. */
  events: (owner: string) => `${LAYOUT.organization(owner)}/events`,
  event: (owner: string, event: string) => `${LAYOUT.events(owner)}/${documentId(event)}`,
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
