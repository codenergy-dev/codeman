import type { BilledHours } from "../budget.ts";
import type { ProviderAccounts } from "../inference/budget.ts";
import type { InferenceProvider, OpenedRun, RunRequest, RunUsage } from "../inference/provider.ts";
import type { Log } from "../runtime/runtime.ts";

/** An inference provider for tests: the usage it reports, and the runs it opened and closed. */
export class FakeInference implements InferenceProvider {
  readonly name = "fake";
  usage: RunUsage;
  readonly opened: RunRequest[] = [];
  readonly closed: string[] = [];
  /** What `open` throws, when set. */
  failure: Error | undefined;

  constructor(options: { usage?: RunUsage } = {}) {
    this.usage = options.usage ?? { cost: 0 };
  }

  async open(run: RunRequest, _log: Log): Promise<OpenedRun> {
    if (this.failure) throw this.failure;
    this.opened.push(run);
    return { handle: `handle-${run.runId}`, credential: `credential-${run.runId}` };
  }

  async close(handle: string, _log: Log): Promise<RunUsage> {
    this.closed.push(handle);
    return this.usage;
  }
}

/** The providers' accounts for tests: what each says, given up front. */
export class FakeAccounts implements ProviderAccounts {
  /** The secrets the job lacks, by provider. */
  readonly secrets: Record<string, string> = {};
  /** OpenRouter's costs of the task's runs; undefined as without its key. */
  costs: Record<string, number> | undefined;
  /** Each GPU provider's hourly billing. */
  readonly hours = new Map<string, Map<number, number>>();
  readonly billingRead: string[] = [];

  missing(provider: string): string | undefined {
    return this.secrets[provider];
  }

  async taskCosts(): Promise<Record<string, number> | undefined> {
    return this.costs;
  }

  async billedHours(provider: string): Promise<BilledHours> {
    this.billingRead.push(provider);
    return this.hours.get(provider) ?? new Map();
  }
}
