import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository the templates check Codeman out from. */
export const CODEMAN_REPOSITORY = "codenergy-dev/codeman";

/**
 * The version of the workflow templates (`templates/codeman.yml` and `templates/codeman-task.yml`)
 * this code runs with; every Codeman step of both passes it as `template-version`. Add one
 * whenever the templates change in a way this code depends on: an input, an output, a job, a
 * permission, a secret or a step that older copies lack. See docs/development/guide.md.
 */
export const TEMPLATE_VERSION = 3;

/**
 * The action's own directory, the checkout of Codeman the job runs: one level above `src/` in
 * tests and above `dist/` in the action.
 */
export const ACTION_ROOT = fileURLToPath(new URL("..", import.meta.url));

const FULL_SHA = /^[0-9a-f]{40}$/;

/** The commit of the action's checkout, when it is one (`actions/checkout` of a SHA). */
export function actionCommit(root = ACTION_ROOT): string | undefined {
  try {
    const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
    return FULL_SHA.test(head) ? head : undefined;
  } catch {
    return undefined;
  }
}

/** The gateway's bundle in the action's checkout, which `npm run build` writes and commits. */
export const GATEWAY_FILE = "dist/gateway.js";

/** The gateway a pod downloads: where, and the SHA-256 it must have. */
export interface GatewayArtifact {
  url: string;
  sha256: string;
  /** The commit of Codeman it is from. */
  commit: string;
}

/**
 * The gateway a pod's bootstrap downloads (decision 3 of the plan to start pods from official
 * engine images): `dist/gateway.js` on raw.githubusercontent.com at the commit the action runs
 * from, and the SHA-256 of the action's own copy, which is that commit's file. Throws, before any
 * pod is created, when the commit is unknown, such as in a local build, or the file is missing.
 */
export function gatewayArtifact(
  root = ACTION_ROOT,
  commit = actionCommit(root),
  repository = CODEMAN_REPOSITORY,
): GatewayArtifact {
  if (!commit || !FULL_SHA.test(commit)) {
    throw new Error(
      `Codeman's commit is unknown: its checkout at ${root} is not of a full commit SHA, so a pod could not download this gateway from raw.githubusercontent.com, and no pod was created. Run Codeman from a checkout of the commit in CODEMAN_COMMIT_SHA, as the workflow templates do.`,
    );
  }
  let file: Buffer;
  try {
    file = readFileSync(join(root, GATEWAY_FILE));
  } catch (error) {
    throw new Error(
      `Codeman's checkout at ${root} has no ${GATEWAY_FILE} to give a pod (${error instanceof Error ? error.message : error}), so no pod was created.`,
    );
  }
  return {
    url: `https://raw.githubusercontent.com/${repository}/${commit}/${GATEWAY_FILE}`,
    sha256: createHash("sha256").update(file).digest("hex"),
    commit,
  };
}

/**
 * Why the workflow files do not fit this code, from the `template-version` they pass (empty in
 * files copied before there was one); undefined when they do.
 */
export function templateVersionProblem(
  given: string,
  commit: string | undefined,
): string | undefined {
  const version = given.trim();
  if (version === String(TEMPLATE_VERSION)) return undefined;
  const at = commit ? `commit ${commit}` : "the commit in CODEMAN_COMMIT_SHA";
  const templates = `https://github.com/${CODEMAN_REPOSITORY}/tree/${commit ?? "<CODEMAN_COMMIT_SHA>"}/templates`;
  const files = version
    ? `This workflow's files are template version ${version}`
    : "This workflow's files pass no template version";
  const newer = /^\d+$/.test(version) && Number(version) > TEMPLATE_VERSION;
  return (
    `${files}, but Codeman at ${at} expects version ${TEMPLATE_VERSION}. Copy ` +
    "templates/codeman.yml and templates/codeman-task.yml from the commit in CODEMAN_COMMIT_SHA " +
    `(${templates}) to .github/workflows/ again, keeping the steps you added to the agent job` +
    (newer ? "; or set CODEMAN_COMMIT_SHA to the commit these files come from." : ".")
  );
}

/**
 * The action's directory as a path inside `workspace`, with `/` separators, when the job checked
 * Codeman out there; undefined when it runs from elsewhere.
 */
export function actionPathIn(workspace: string, root = ACTION_ROOT): string | undefined {
  const path = relative(workspace, root);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    return undefined;
  }
  return path.split(sep).join("/");
}
