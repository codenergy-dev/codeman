import type { Conventions } from "../conventions.ts";

const WORKFLOWS_DIR = ".github/workflows/";

export const GITHUB: Conventions = {
  name: "GitHub",
  markdown: {
    references: /@|#(?=\d)/g,
    mentions: /@/g,
  },
  commentLimit: 65_536,
  workflows: {
    dir: WORKFLOWS_DIR,
    file: /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/,
    fileDescription: "files directly under .github/workflows/",
    protect: "# Workflows and repository automation.\n/.github/**\n",
    probes: [".github/workflows/codeman.yml", ".github/workflows/codeman-task.yml"],
    agentRules: (branch) =>
      `- Workflow files you write under \`${WORKFLOWS_DIR}\` are not committed there: Codeman stages them under \`.codeman/workflows/\` until a maintainer reads and accepts them, because a workflow runs with the repository's secrets. Deleting a workflow is left to a maintainer.
- If the task needs work this runner cannot do (another operating system, a device, a secret), write a workflow for it that runs on pushes to \`${branch}\`, with \`paths\` filters so it does not run on unrelated pushes (include the workflow file itself, so it runs when a maintainer accepts it), and report \`awaiting-workflow\`. While the workflow waits for a maintainer, the task goes on to the next stages and review; you get its results once it has run. Codeman gives you its results in a later run. A workflow that needs secrets must use a GitHub Environment. Never wait for a workflow that deploys, publishes or releases: run from the task branch, it would ship work nobody reviewed. Such a workflow is part of the change, and runs after the merge.`,
    reviewCheck: `If \`.codeman/workflows/\` has files, they are workflows the agent wrote, staged until a maintainer accepts them into \`${WORKFLOWS_DIR}\`, where they would run with the repository's secrets. Review each as a workflow: its triggers (never \`pull_request_target\` with a checkout of the branch), the least \`permissions\` it needs, secrets only through a GitHub Environment, actions pinned to a full commit SHA, and, for a workflow that runs on pushes to the task branch, \`paths\` filters and no deploy. What must change goes in \`changes\`, like any other finding.`,
  },
};
