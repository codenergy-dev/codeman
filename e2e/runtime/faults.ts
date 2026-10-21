import type { JobName } from "./scenario/schema.ts";
import type { Command, JobExecutor, JobSession, JobStart } from "./simulator/executor.ts";

/**
 * Job faults: a scenario's `fault: { job }`, `apply: fail` and `apply: skip` act on a job of the
 * templates, for one task or every one, a number of times or always.
 *
 * - `failure`: the job ends in failure instead of running. The executor wrapper starts no
 *   container for it: each of its commands fails at once.
 * - `cancelled`: the run is cancelled as the job reaches its Codeman step (its first step, for a
 *   job without one), as a user's cancel would: that step does not run, the job's `always()` steps
 *   do, and the run's other jobs go on as GitHub's cancellation lets them.
 */

export interface JobFault {
  job: JobName;
  /** The task's issue number; every task when undefined. */
  issue: number | undefined;
  conclusion: "failure" | "cancelled";
  /** How many jobs it fails; every one when undefined. */
  times: number | undefined;
}

/** The jobs without a Codeman step: a cancel reaches their first step. */
const WITHOUT_CODEMAN = /^(Forward review|Next run|Wake .*)$/;

/** How GitHub names each job of the templates, as the simulator does. */
const NAMES: Record<JobName, RegExp> = {
  "forward-review": /^Forward review$/,
  select: /^Select tasks$/,
  dispatch: /^Wake /,
  task: /^#\d+ \/ /,
  "next-run": /^Next run$/,
  "open-key": /^#\d+ \/ Open key$/,
  agent: /^#\d+ \/ Agent \(/,
  "close-key": /^#\d+ \/ Close key$/,
  apply: /^#\d+ \/ Apply$/,
  "release-pod": /^#\d+ \/ Release pod$/,
};

/** The fault that applies to a job, counted against its `times`; undefined for none. */
export function takeFault(faults: JobFault[], name: string): JobFault | undefined {
  const index = faults.findIndex((fault) => {
    if (!NAMES[fault.job].test(name)) return false;
    if (fault.issue === undefined) return true;
    return name.startsWith(`#${fault.issue} / `);
  });
  const fault = faults[index];
  if (!fault) return undefined;
  if (fault.times !== undefined && --fault.times <= 0) faults.splice(index, 1);
  return fault;
}

export class FaultingExecutor implements JobExecutor {
  readonly #inner: JobExecutor;
  readonly #faults: JobFault[];
  readonly #root: string;
  readonly #cancel: ((runId: number) => void) | undefined;

  /**
   * `root` is where a faulted job would see its directory; `cancel` cancels a run, as a user
   * would, for the `cancelled` faults.
   */
  constructor(
    inner: JobExecutor,
    faults: JobFault[],
    root: string,
    cancel?: (runId: number) => void,
  ) {
    this.#inner = inner;
    this.#faults = faults;
    this.#root = root;
    this.#cancel = cancel;
  }

  async start(job: JobStart): Promise<JobSession> {
    const fault = takeFault(this.#faults, job.name);
    if (!fault) return this.#inner.start(job);
    if (fault.conclusion === "failure") {
      return {
        root: this.#root,
        exec: async () => ({ exitCode: 1, output: `[e2e] The scenario fails ${job.name}.\n` }),
        stop: async () => undefined,
      };
    }
    const cancel = this.#cancel;
    if (!cancel) throw new Error(`The runtime cannot cancel ${job.name}'s run here.`);
    const session = await this.#inner.start(job);
    const anyStep = WITHOUT_CODEMAN.test(job.name);
    let cancelled = false;
    return {
      root: session.root,
      exec: async (command: Command) => {
        if (!cancelled && (anyStep || command.kind === "action")) {
          cancelled = true;
          cancel(job.runId);
          return {
            exitCode: 1,
            output: `[e2e] The scenario cancels run ${job.runId} as ${job.name} reaches this step.\n`,
          };
        }
        return session.exec(command);
      },
      stop: () => session.stop(),
    };
  }
}
