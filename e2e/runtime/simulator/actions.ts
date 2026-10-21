import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { run as git } from "../../fakes/github/git.ts";
import type { StepInfo } from "./executor.ts";
import { ActionFailure, type GitHubPort } from "./github.ts";

/**
 * The actions the templates pin, emulated against the fake GitHub through `GitHubPort`:
 * `actions/checkout`, `actions/create-github-app-token`, `actions/upload-artifact` and
 * `actions/download-artifact`. Each reads its `with:` inputs as the real one does, for the inputs
 * the templates use, and fails its step as the real one would (`ActionFailure`). An input the
 * emulation does not implement throws `Unsupported`, which stops the run.
 */

/** A construct the simulator does not implement: the run stops, naming it. */
export class Unsupported extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "Unsupported";
  }
}

/** A path as the job sees it, and as the host reads it. */
export interface Place {
  view: string;
  host: string;
}

export interface ActionContext {
  /** The step's `with:`, as text; inputs left out are absent. */
  inputs: Record<string, string>;
  step: StepInfo;
  github: GitHubPort;
  job: {
    runId: number;
    repository: string;
    owner: string;
    /** `github.sha` and `github.ref`. */
    sha: string;
    ref: string;
    /** `github.token`. */
    token: string;
    /** The job's `backendId`, which its artifacts record. */
    backendId: string;
    workspace: Place;
    /** A path as the job sees it, on the host; throws outside the job's directory. */
    toHost(view: string): string;
    /** The repository whose checkout holds Codeman's action, and where the job checked it out. */
    codeman: { repository: string; paths: Set<string> };
  };
  log(line: string): void;
  /** Masks a value in the job's log and outputs, as `core.setSecret` does. */
  mask(value: string): void;
}

export interface ActionResult {
  outputs?: Record<string, string>;
  /** The action's post step, run at the job's end. */
  post?: () => Promise<void>;
}

export type EmulatedAction = (context: ActionContext) => Promise<ActionResult>;

const truthyInput = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === "" ? fallback : value.trim().toLowerCase() === "true";

/** A path input, as the job sees it: relative ones are under the workspace. */
function viewPath(context: ActionContext, value: string): string {
  const path = value.trim();
  return path.startsWith("/")
    ? posix.normalize(path)
    : posix.join(context.job.workspace.view, path);
}

function refuse(context: ActionContext, action: string, inputs: readonly string[]): void {
  for (const input of inputs) {
    if ((context.inputs[input] ?? "") !== "") {
      throw new Unsupported(`${action}: the input ${input} is not emulated (${context.step.name})`);
    }
  }
}

export const checkout: EmulatedAction = async (context) => {
  const { inputs, job } = context;
  refuse(context, "actions/checkout", [
    "sparse-checkout",
    "submodules",
    "lfs",
    "ssh-key",
    "filter",
  ]);
  const repository = inputs.repository || job.repository;
  const target = viewPath(context, inputs.path ?? "");
  const relativeTarget = posix.relative(job.workspace.view, target);
  if (relativeTarget.startsWith("..")) {
    throw new ActionFailure(`Repository path '${target}' is not under '${job.workspace.view}'`);
  }
  const host = job.toHost(target);
  rmSync(host, { recursive: true, force: true });
  mkdirSync(host, { recursive: true });
  if (repository.toLowerCase() === job.codeman.repository.toLowerCase()) {
    // Codeman's own checkout: the simulator runs the e2e bundle for `uses:` of this path.
    job.codeman.paths.add(target);
    writeFileSync(join(host, ".codeman-e2e"), `${inputs.ref ?? ""}\n`);
    context.log(`Codeman's action, as the e2e bundle, at ${target}`);
    return { outputs: { ref: inputs.ref ?? "", commit: inputs.ref ?? "" } };
  }
  const ref =
    inputs.ref || (repository.toLowerCase() === job.repository.toLowerCase() ? job.sha : "");
  const depth = Number(inputs["fetch-depth"] || "1");
  const { sha } = await context.github.checkout({
    repository,
    ref,
    token: inputs.token ?? job.token,
    path: host,
    fetchDepth: Number.isFinite(depth) ? depth : 1,
  });
  if (truthyInput(inputs["persist-credentials"], true)) {
    const token = inputs.token ?? job.token;
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    await git([
      "-C",
      host,
      "config",
      "--local",
      `http.${context.github.urls.server}/.extraheader`,
      `AUTHORIZATION: basic ${basic}`,
    ]);
  }
  context.log(`Checked out ${repository} at ${sha} into ${target}`);
  return { outputs: { ref: ref || sha, commit: sha } };
};

export const createAppToken: EmulatedAction = async (context) => {
  const { inputs, job } = context;
  refuse(context, "actions/create-github-app-token", ["enterprise"]);
  const clientId = inputs["client-id"] || inputs["app-id"] || "";
  const privateKey = inputs["private-key"] ?? "";
  if (!clientId) throw new ActionFailure("Input required and not supplied: client-id");
  if (!privateKey) throw new ActionFailure("Input required and not supplied: private-key");
  const permissions: Record<string, string> = {};
  for (const [name, value] of Object.entries(inputs)) {
    if (name.startsWith("permission-") && value !== "") {
      permissions[name.slice("permission-".length).replaceAll("-", "_")] = value;
    }
  }
  const listed = (inputs.repositories ?? "")
    .split(/[\n,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  let owner = inputs.owner ?? "";
  let repositories: string[];
  if (!owner && listed.length === 0) {
    const [own = "", name = ""] = job.repository.split("/");
    owner = own;
    repositories = [name];
  } else {
    owner ||= job.owner;
    repositories = listed.map((entry) => {
      const parts = entry.split("/");
      if (parts.length === 2) {
        if (parts[0]?.toLowerCase() !== owner.toLowerCase()) {
          throw new ActionFailure(
            `Repository '${entry}' includes owner '${parts[0]}', which does not match the resolved owner '${owner}'.`,
          );
        }
        return parts[1] ?? "";
      }
      return entry;
    });
  }
  const created = context.github.appToken({
    clientId,
    privateKey,
    owner,
    repositories,
    permissions,
  });
  context.mask(created.token);
  const skipRevoke = truthyInput(inputs["skip-token-revoke"], false);
  return {
    outputs: {
      token: created.token,
      "installation-id": String(created.installationId),
      "app-slug": created.appSlug,
    },
    ...(skipRevoke
      ? {}
      : {
          post: async () => {
            context.github.revokeToken(created.token);
            context.log("Token revoked");
          },
        }),
  };
};

/** The files under `root`, by their path relative to it, hidden ones only when asked. */
function collect(root: string, hidden: boolean): Map<string, string> {
  const found = new Map<string, string>();
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (!stat) return found;
  if (!stat.isDirectory()) {
    found.set(root.split(sep).at(-1) ?? "file", root);
    return found;
  }
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!hidden && entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.set(relative(root, path).split(sep).join("/"), path);
    }
  };
  walk(root);
  return found;
}

export const uploadArtifact: EmulatedAction = async (context) => {
  const { inputs, job } = context;
  refuse(context, "actions/upload-artifact", []);
  const name = inputs.name || "artifact";
  const lines = (inputs.path ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new ActionFailure("Input required and not supplied: path");
  for (const line of lines) {
    if (/[*?[\]!]/.test(line)) {
      throw new Unsupported(
        `actions/upload-artifact: the path ${line} is a pattern, which is not emulated`,
      );
    }
  }
  const hidden = truthyInput(inputs["include-hidden-files"], false);
  const roots = lines.map((line) => job.toHost(viewPath(context, line)));
  const files: Record<string, Buffer> = {};
  const base =
    roots.length === 1
      ? undefined
      : roots.reduce(
          (common, root) => {
            let prefix = common;
            while (!`${root}${sep}`.startsWith(`${prefix}${sep}`)) prefix = dirname(prefix);
            return prefix;
          },
          dirname(roots[0] ?? ""),
        );
  for (const root of roots) {
    for (const [path, host] of collect(root, hidden)) {
      const key = base === undefined ? path : relative(base, host).split(sep).join("/");
      files[key] = readFileSync(host);
    }
  }
  if (Object.keys(files).length === 0) {
    const mode = inputs["if-no-files-found"] || "warn";
    const message = `No files were found with the provided path: ${lines.join(", ")}. No artifacts will be uploaded.`;
    if (mode === "error") throw new ActionFailure(message);
    if (mode === "warn") context.log(`Warning: ${message}`);
    return {};
  }
  const retention = inputs["retention-days"] ? Number(inputs["retention-days"]) : undefined;
  const uploaded = context.github.uploadArtifact(job.runId, job.backendId, name, files, {
    ...(retention !== undefined && Number.isFinite(retention) ? { retentionDays: retention } : {}),
    overwrite: truthyInput(inputs.overwrite, false),
  });
  context.log(
    `Artifact ${name} has been successfully uploaded! (${Object.keys(files).length} files)`,
  );
  return {
    outputs: {
      "artifact-id": String(uploaded.id),
      "artifact-url": uploaded.url,
      "artifact-digest": uploaded.digest,
    },
  };
};

export const downloadArtifact: EmulatedAction = async (context) => {
  const { inputs, job } = context;
  refuse(context, "actions/download-artifact", [
    "pattern",
    "artifact-ids",
    "run-id",
    "repository",
    "github-token",
  ]);
  const target = viewPath(context, inputs.path ?? "");
  const host = job.toHost(target);
  const artifacts = context.github.artifacts(job.runId);
  const write = (dir: string, files: Map<string, Buffer>) => {
    for (const [path, data] of files) {
      const file = join(dir, ...path.split("/"));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    }
  };
  if (inputs.name) {
    const files = artifacts.get(inputs.name);
    if (!files) {
      throw new ActionFailure(
        `Unable to download artifact(s): Artifact not found for name: ${inputs.name}`,
      );
    }
    write(host, files);
  } else {
    const merge = truthyInput(inputs["merge-multiple"], false);
    for (const [name, files] of artifacts) write(merge ? host : join(host, name), files);
  }
  context.log(`Downloaded to ${target}`);
  return { outputs: { "download-path": target } };
};

/** The emulated actions, by `owner/repo`. */
export const ACTIONS: Record<string, EmulatedAction> = {
  "actions/checkout": checkout,
  "actions/create-github-app-token": createAppToken,
  "actions/upload-artifact": uploadArtifact,
  "actions/download-artifact": downloadArtifact,
};
