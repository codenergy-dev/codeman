const API = "https://openrouter.ai/api/v1";

export type Fetch = typeof fetch;

export interface KeyInfo {
  hash: string;
  name: string;
  /** Total usage, in USD. */
  usage?: number;
  usage_monthly?: number;
}

/**
 * Task keys are named `codeman/<owner>/<repo>/<issue>/<run>`, so usage can be summed per
 * repository and per task.
 */
export function keyPrefix(owner: string, repo: string): string {
  return `codeman/${owner}/${repo}/`;
}

export function taskKeyPrefix(owner: string, repo: string, issue: number | string): string {
  return `${keyPrefix(owner, repo)}${issue}/`;
}

/** Adds up one usage field over the keys whose name starts with `prefix`. */
export function sumUsage(
  keys: readonly KeyInfo[],
  prefix: string,
  field: "usage" | "usage_monthly",
): number {
  return keys
    .filter((key) => key.name.startsWith(prefix))
    .reduce((total, key) => total + (key[field] ?? 0), 0);
}

/** Below this, a run is not worth starting: it would stop midway. */
export const MIN_RUN_BUDGET = 0.1;

/**
 * The limit for the next run's key: what remains of the task's budget, in whole cents rounded
 * down, or undefined when that is below MIN_RUN_BUDGET.
 */
export function runLimit(taskBudget: number, spent: number): number | undefined {
  const remaining = Math.floor((taskBudget - spent) * 100 + 1e-9) / 100;
  return remaining >= MIN_RUN_BUDGET ? remaining : undefined;
}

export function usd(amount: number): string {
  return `US$ ${amount.toFixed(2)}`;
}

/** OpenRouter wants `YYYY-MM-DDTHH:MM:SSZ`. */
export function expiresAt(now: Date, hours: number): string {
  return `${new Date(now.getTime() + hours * 3_600_000).toISOString().slice(0, 19)}Z`;
}

export class OpenRouter {
  readonly #managementKey: string;
  readonly #fetch: Fetch;

  constructor(managementKey: string, fetchFn: Fetch = fetch) {
    this.#managementKey = managementKey;
    this.#fetch = fetchFn;
  }

  /** Every key of the account, disabled ones included. */
  async listKeys(): Promise<KeyInfo[]> {
    const keys: KeyInfo[] = [];
    for (let page = 0; page < 100; page++) {
      const { data } = (await this.#request(
        `/keys?include_disabled=true&offset=${keys.length}`,
      )) as { data: KeyInfo[] };
      if (data.length === 0) return keys;
      keys.push(...data);
    }
    throw new Error("Too many OpenRouter keys to add up.");
  }

  /** This month's usage, in USD, of every key whose name starts with `prefix`, disabled ones included. */
  async monthlyUsage(prefix: string): Promise<number> {
    return sumUsage(await this.listKeys(), prefix, "usage_monthly");
  }

  /** The total usage of one key, in USD. */
  async keyUsage(hash: string): Promise<number> {
    const { data } = (await this.#request(`/keys/${encodeURIComponent(hash)}`)) as {
      data: KeyInfo;
    };
    return data.usage ?? 0;
  }

  async createKey(options: {
    name: string;
    limit: number;
    expiresAt: string;
  }): Promise<{ key: string; hash: string }> {
    const response = (await this.#request("/keys", "POST", {
      name: options.name,
      limit: options.limit,
      expires_at: options.expiresAt,
    })) as { key: string; data: KeyInfo };
    return { key: response.key, hash: response.data.hash };
  }

  /** Disables instead of deleting, so the key's usage still counts towards the monthly cap. */
  async disableKey(hash: string): Promise<void> {
    await this.#request(`/keys/${encodeURIComponent(hash)}`, "PATCH", { disabled: true });
  }

  async #request(path: string, method = "GET", body?: unknown): Promise<unknown> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#managementKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (!response.ok) {
      // The body may echo request data; report only the status.
      throw new Error(`OpenRouter ${method} ${path.split("?")[0]} failed with ${response.status}.`);
    }
    return response.json();
  }
}
