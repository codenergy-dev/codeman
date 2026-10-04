import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness, HarnessCommand, HarnessOptions } from "./harness.ts";

/** Pinned version and npm `dist.integrity` of each platform package. See docs/dependencies.md. */
export const OPENCODE_VERSION = "1.18.32";
const PACKAGES: Record<string, { name: string; integrity: string }> = {
  "linux-x64": {
    name: "opencode-linux-x64",
    integrity:
      "sha512-CIatvoyi8V5a56xyw6ZUnsKxB9wqYIZqfNeqUNWhBBY4aENAm907LP0xXAwL6tR0cYbqNl2+Dvx8mOqXIxbDeQ==",
  },
  "linux-arm64": {
    name: "opencode-linux-arm64",
    integrity:
      "sha512-SDMw716oYxxJ9CWDO5roCpziw98ANwPZSz6L8evUOHkFCq6OU31xZGQwv/T1ROJnoPNJKWODmm1vzS6s6uEgUA==",
  },
};

/** The provider ID OpenCode knows Codeman's self-hosted inference by. */
export const SELF_HOSTED_PROVIDER = "codeman";

/**
 * Configuration passed through `OPENCODE_CONFIG_CONTENT`, which overrides the repository's own
 * `opencode.json`. Every permission is explicit: nobody is there to answer an `ask`. With
 * `provider`, the only provider is an OpenAI-compatible one at Codeman's gateway, whose token
 * this configuration holds; otherwise OpenRouter, whose key is in the environment.
 */
export function openCodeConfig(
  model: string,
  instructions?: string,
  provider?: HarnessOptions["provider"] & { apiKey: string },
): Record<string, unknown> {
  const id = provider ? SELF_HOSTED_PROVIDER : "openrouter";
  const limit = provider?.contextLength
    ? {
        limit: {
          context: provider.contextLength,
          output: Math.min(32_768, Math.floor(provider.contextLength / 4)),
        },
      }
    : {};
  return {
    $schema: "https://opencode.ai/config.json",
    // Added to the repository's AGENTS.md, not used in its place.
    ...(instructions ? { instructions: [instructions] } : {}),
    autoupdate: false,
    share: "disabled",
    enabled_providers: [id],
    model: `${id}/${model}`,
    // Registers the model in case the model catalog does not list it yet.
    provider: provider
      ? {
          [id]: {
            npm: "@ai-sdk/openai-compatible",
            name: "Codeman",
            options: { baseURL: provider.baseUrl, apiKey: provider.apiKey },
            models: { [model]: { name: model, ...limit } },
          },
        }
      : { openrouter: { models: { [model]: {} } } },
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      bash: "allow",
      task: "allow",
      skill: "allow",
      lsp: "allow",
      webfetch: "deny",
      websearch: "deny",
      external_directory: "deny",
      question: "deny",
      doom_loop: "deny",
    },
  };
}

export const openCode: Harness = {
  name: "opencode",

  async install(dir: string): Promise<string> {
    const platform = `${process.platform}-${process.arch}`;
    const pkg = PACKAGES[platform];
    if (!pkg) throw new Error(`The OpenCode harness does not support ${platform} runners.`);

    const url = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name}-${OPENCODE_VERSION}.tgz`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Downloading ${url} failed with ${response.status}.`);
    const tarball = Buffer.from(await response.arrayBuffer());
    const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    if (integrity !== pkg.integrity) {
      throw new Error(`${pkg.name}@${OPENCODE_VERSION} does not match its pinned integrity.`);
    }

    mkdirSync(dir, { recursive: true });
    const file = join(dir, "opencode.tgz");
    writeFileSync(file, tarball);
    const tar = spawnSync("tar", ["-xzf", file, "-C", dir, "package/bin/opencode"], {
      stdio: "inherit",
    });
    if (tar.status !== 0) throw new Error("Extracting OpenCode failed.");
    const executable = join(dir, "package", "bin", "opencode");
    chmodSync(executable, 0o755);
    return executable;
  },

  command({
    executable,
    model,
    apiKey,
    provider,
    prompt,
    instructions,
    resume,
  }: HarnessOptions): HarnessCommand {
    const config = openCodeConfig(model, instructions, provider && { ...provider, apiKey });
    return {
      file: executable,
      // `--continue` takes the last session that is not a subagent's.
      args: [
        "run",
        "--format",
        "json",
        "--model",
        `${provider ? SELF_HOSTED_PROVIDER : "openrouter"}/${model}`,
        ...(resume ? ["--continue"] : []),
        prompt,
      ],
      // Secrets only in the environment: any user can list arguments.
      env: {
        ...(provider ? {} : { OPENROUTER_API_KEY: apiKey }),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
    };
  },
};
