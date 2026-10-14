import type { RepositoryRef } from "../platform/types.ts";
import type { Runtime } from "../runtime/runtime.ts";

/** A runtime for tests: inputs given up front, and everything a step reports kept in memory. */
export class FakeRuntime implements Runtime {
  readonly inputs: Record<string, string>;
  readonly outputs: Record<string, string> = {};
  readonly logs: { level: "info" | "warning" | "error"; message: string }[] = [];
  readonly masked: string[] = [];
  readonly failures: string[] = [];
  readonly summaries: { heading: string; text: string; items: readonly string[] }[] = [];
  readonly tempDir: string;
  readonly repository: RepositoryRef;
  readonly run: { id: string; attempt: number; url: string };
  /** The OIDC tokens the step asked for, by audience. */
  readonly idTokens: string[] = [];
  readonly #workspace: string | undefined;

  constructor(
    options: {
      inputs?: Record<string, string>;
      tempDir?: string;
      workspace?: string;
      repository?: RepositoryRef;
      runId?: string;
      attempt?: number;
    } = {},
  ) {
    this.inputs = { ...options.inputs };
    this.tempDir = options.tempDir ?? "/tmp";
    this.#workspace = options.workspace;
    this.repository = options.repository ?? { owner: "o", name: "r" };
    const id = options.runId ?? "1";
    this.run = { id, attempt: options.attempt ?? 1, url: `https://ci.test/runs/${id}` };
  }

  input(name: string, options?: { required?: boolean }): string {
    const value = this.inputs[name] ?? "";
    if (options?.required && value === "")
      throw new Error(`Input required and not supplied: ${name}`);
    return value;
  }

  output(name: string, value: string): void {
    this.outputs[name] = value;
  }

  info(message: string): void {
    this.logs.push({ level: "info", message });
  }

  warning(message: string): void {
    this.logs.push({ level: "warning", message });
  }

  error(message: string): void {
    this.logs.push({ level: "error", message });
  }

  startGroup(): void {}

  endGroup(): void {}

  async summary(heading: string, text: string, items: readonly string[]): Promise<void> {
    this.summaries.push({ heading, text, items });
  }

  async idToken(audience: string): Promise<string> {
    this.idTokens.push(audience);
    const token = `oidc-token-${this.idTokens.length}`;
    this.mask(token);
    return token;
  }

  mask(secret: string): void {
    this.masked.push(secret);
  }

  fail(message: string): void {
    this.failures.push(message);
  }

  workspace(): string {
    if (!this.#workspace) throw new Error("No workspace.");
    return this.#workspace;
  }

  runIdOf(url: string): string | undefined {
    return /^https:\/\/ci\.test\/runs\/(\d+)$/.exec(url)?.[1];
  }

  /** Messages logged at `level`. */
  logged(level: "info" | "warning" | "error"): string[] {
    return this.logs.filter((log) => log.level === level).map((log) => log.message);
  }
}
