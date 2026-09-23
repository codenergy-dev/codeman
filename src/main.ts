import * as core from "@actions/core";
import * as github from "@actions/github";
import { OPT_IN_LABEL, stateOf } from "./state.ts";
import { oneLine, toTask } from "./tasks.ts";

export async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: "open",
    labels: OPT_IN_LABEL,
    per_page: 100,
  });
  const tasks = issues.map(toTask);

  core.info(`Found ${tasks.length} open task(s) labeled "${OPT_IN_LABEL}" in ${owner}/${repo}.`);
  for (const task of tasks) {
    const result = stateOf(task.labels);
    const line = `#${task.number} ${task.kind} ${oneLine(task.title)}`;
    if (result.ok) {
      core.info(`${line} [${result.state}]`);
    } else {
      core.warning(`${line}: ${result.error}`);
    }
  }
}
