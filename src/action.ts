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
