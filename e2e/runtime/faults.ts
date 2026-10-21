import type { JobName } from "./scenario/schema.ts";
import type { JobExecutor, JobSession, JobStart } from "./simulator/executor.ts";

/**
 * Job faults: a scenario's `fault: { job }` and `apply: fail` make a job of the templates end in
 * failure instead of running, for one task or every one, a number of times or always. The
 * executor wrapper starts no container for such a job: each of its commands fails at once.
 */

export interface JobFault {
  job: JobName;
  /** The task's issue number; every task when undefined. */
  issue: number | undefined;
  conclusion: "failure";
  /** How many jobs it fails; every one when undefined. */
  times: number | undefined;
}

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

  /** `root` is where a faulted job would see its directory. */
  constructor(inner: JobExecutor, faults: JobFault[], root: string) {
    this.#inner = inner;
    this.#faults = faults;
    this.#root = root;
  }

  start(job: JobStart): Promise<JobSession> {
    const fault = takeFault(this.#faults, job.name);
    if (!fault) return this.#inner.start(job);
    return Promise.resolve({
      root: this.#root,
      exec: async () => ({ exitCode: 1, output: `[e2e] The scenario fails ${job.name}.\n` }),
      stop: async () => undefined,
    });
  }
}
