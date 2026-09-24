const API = "https://openrouter.ai/api/v1";

export type Fetch = typeof fetch;

interface KeyInfo {
  hash: string;
  name: string;
  usage_monthly?: number;
}

/** Task keys are named `codeman/<owner>/<repo>/<issue>/<run>`, so usage can be summed per repository. */
export function keyPrefix(owner: string, repo: string): string {
  return `codeman/${owner}/${repo}/`;
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

  /** This month's usage, in USD, of every key whose name starts with `prefix`, disabled ones included. */
  async monthlyUsage(prefix: string): Promise<number> {
    let total = 0;
    for (let offset = 0, page = 0; page < 100; page++) {
      const { data } = (await this.#request(`/keys?include_disabled=true&offset=${offset}`)) as {
        data: KeyInfo[];
      };
      if (data.length === 0) return total;
      for (const key of data) {
        if (key.name.startsWith(prefix)) total += key.usage_monthly ?? 0;
      }
      offset += data.length;
    }
    throw new Error("Too many OpenRouter keys to add up.");
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
