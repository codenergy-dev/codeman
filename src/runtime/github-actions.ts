import * as core from "@actions/core";
import type { RepositoryRef } from "../platform/types.ts";
import { oneLine } from "../text.ts";
import type { Runtime } from "./runtime.ts";

/** A step of a GitHub Actions workflow: inputs and outputs of the action, its logs and summary. */
export class GitHubActionsRuntime implements Runtime {
  input(name: string, options?: { required?: boolean }): string {
    return core.getInput(name, options);
  }

  output(name: string, value: string): void {
    core.setOutput(name, value);
  }

  info(message: string): void {
    core.info(message);
  }

  warning(message: string): void {
    core.warning(message);
  }

  error(message: string): void {
    core.error(message);
  }

  startGroup(name: string): void {
    core.startGroup(name);
  }

  endGroup(): void {
    core.endGroup();
  }

  async summary(heading: string, text: string, items: readonly string[]): Promise<void> {
    await core.summary
      .addHeading(heading, 3)
      .addRaw(text, true)
      .addList([...items])
      .write();
  }

  mask(secret: string): void {
    core.setSecret(secret);
  }

  /** GitHub's OIDC token, which `getIDToken` masks. The job needs `id-token: write`. */
  async idToken(audience: string): Promise<string> {
    try {
      return await core.getIDToken(audience);
    } catch (error) {
      throw new Error(
        `The job could not get GitHub's OIDC token: give it the \`id-token: write\` permission, as the templates do. ${error instanceof Error ? oneLine(error.message) : ""}`.trim(),
      );
    }
  }

  fail(message: string): void {
    core.setFailed(message);
  }

  workspace(): string {
    const workspace = process.env.GITHUB_WORKSPACE;
    if (!workspace) throw new Error("GITHUB_WORKSPACE is not set; check out the repository first.");
    return workspace;
  }

  get tempDir(): string {
    return process.env.RUNNER_TEMP ?? "/tmp";
  }

  get run(): { id: string; attempt: number; url: string } {
    const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
    const id = String(Number.parseInt(process.env.GITHUB_RUN_ID ?? "", 10));
    const attempt = Number.parseInt(process.env.GITHUB_RUN_ATTEMPT ?? "", 10);
    const { owner, name } = this.repository;
    return {
      id,
      attempt: attempt > 0 ? attempt : 1,
      url: `${server}/${owner}/${name}/actions/runs/${id}`,
    };
  }

  runIdOf(url: string): string | undefined {
    return /\/actions\/runs\/(\d+)$/.exec(url)?.[1];
  }

  /** As `@actions/github`'s context reads it. */
  get repository(): RepositoryRef {
    const [owner = "", name = ""] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
    if (!owner || !name) {
      throw new Error("GITHUB_REPOSITORY must name the repository, as in owner/repo.");
    }
    return { owner, name };
  }
}
