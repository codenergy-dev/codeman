import type { RepositoryRef } from "../platform/types.ts";

/** Where a step reports what it does. Untrusted text must reach it on one line (`oneLine`). */
export interface Log {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

/**
 * Where Codeman runs: a CI job today, maybe a service later. Each step reads its inputs and
 * writes its outputs here, and the runtime carries outputs to the steps that need them. See
 * docs/architecture.md#platforms.
 */
export interface Runtime extends Log {
  /** One of the step's inputs; empty when it is not set. Throws when `required` and empty. */
  input(name: string, options?: { required?: boolean }): string;
  /** One of the step's outputs, for the steps after it. Visible in the logs of those steps. */
  output(name: string, value: string): void;
  startGroup(name: string): void;
  endGroup(): void;
  /** Adds a section to the run's summary, if the runtime has one. */
  summary(heading: string, text: string, items: readonly string[]): Promise<void>;
  /**
   * Keeps a secret out of the logs from now on, should a tool print it. Steps never log secrets
   * on purpose; this is a second line of defense, which some runtimes do not have.
   */
  mask(secret: string): void;
  /**
   * The job's OpenID Connect token from the runtime, for `audience`, which proves to another
   * service which repository and workflow the job runs for. Masked. Throws when the job may not
   * have one.
   */
  idToken(audience: string): Promise<string>;
  /** Marks the step as failed; the step goes on. */
  fail(message: string): void;
  /** The checkout of the repository, for the agent step. Throws when there is none. */
  workspace(): string;
  /** A directory for temporary files that the step's later commands can read. */
  readonly tempDir: string;
  /**
   * This run: its ID, which is digits; its attempt, 1 and then one more for each re-run of its
   * jobs; and a link to it.
   */
  readonly run: { id: string; attempt: number; url: string };
  /** The ID of a run of this runtime from its link, as `run` gives them. */
  runIdOf(url: string): string | undefined;
  /** The repository the run works on. */
  readonly repository: RepositoryRef;
}
