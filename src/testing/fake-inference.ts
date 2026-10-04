import type { InferenceProvider, OpenedRun, RunRequest, RunUsage } from "../inference/provider.ts";
import type { Log } from "../runtime/runtime.ts";

/** An inference provider for tests: spend given up front, and the runs it opened and closed. */
export class FakeInference implements InferenceProvider {
  readonly name = "fake";
  spent: number;
  month: number;
  usage: RunUsage;
  readonly opened: RunRequest[] = [];
  readonly closed: string[] = [];

  constructor(options: { spent?: number; month?: number; usage?: RunUsage } = {}) {
    this.spent = options.spent ?? 0;
    this.month = options.month ?? 0;
    this.usage = options.usage ?? { cost: 0 };
  }

  async taskSpent(): Promise<number> {
    return this.spent;
  }

  async monthSpent(): Promise<number> {
    return this.month;
  }

  async open(run: RunRequest, _log: Log): Promise<OpenedRun> {
    this.opened.push(run);
    return { handle: `handle-${run.runId}`, credential: `credential-${run.runId}` };
  }

  async close(handle: string, _log: Log): Promise<RunUsage> {
    this.closed.push(handle);
    return this.usage;
  }
}
