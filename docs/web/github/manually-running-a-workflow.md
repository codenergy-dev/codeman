---
title: Manually running a workflow
url: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
created_at: 2026-11-05T12:55:17-03:00
updated_at: 2026-11-05T12:55:17-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Manually running a workflow

When a workflow is configured to run on the workflow_dispatch event, you can run the workflow using the Actions tab on GitHub, GitHub CLI, or the REST API.

## Configuring a workflow to run manually

To run a workflow manually, the workflow must be configured to run on the `workflow_dispatch` event.

To trigger the `workflow_dispatch` event, your workflow must be in the default branch. For more information about configuring the `workflow_dispatch` event, see [Events that trigger workflows](/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

Write access to the repository is required to perform these steps.

## Running a workflow

<div class="ghd-tool webui">

1. On GitHub, navigate to the main page of the repository.

2. Under your repository name, click **<svg version="1.1" width="16" height="16" viewBox="0 0 16 16" class="octicon octicon-play" aria-label="play" role="img"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"></path></svg> Actions**.

   ![Screenshot of the tabs for the "github/docs" repository. The "Actions" tab is highlighted with an orange outline.](/assets/images/help/repository/actions-tab-global-nav-update.png)

3. In the left sidebar, click the name of the workflow you want to run.

   ![Screenshot of the "Actions" page. In the left sidebar, a workflow name is highlighted with an outline in dark orange.](/assets/images/help/repository/actions-select-workflow-2022.png)

4. Above the list of workflow runs, click the **Run workflow** button.

   > [!NOTE]
   > To see the **Run workflow** button, your workflow file must use the `workflow_dispatch` event trigger. Only workflow files that use the `workflow_dispatch` event trigger will have the option to run the workflow manually using the **Run workflow** button. For more information about configuring the `workflow_dispatch` event, see [Events that trigger workflows](/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

   ![Screenshot of a workflow page. Above the list of workflow runs, a button, labeled "Run workflow", is outlined in dark orange.](/assets/images/help/actions/actions-workflow-dispatch.png)

5. Select the **Branch** dropdown menu and click a branch to run the workflow on.

6. If the workflow requires input, fill in the fields.

7. Click **Run workflow**.

</div>

<div class="ghd-tool cli">

> [!NOTE]
> To learn more about GitHub CLI, see [About GitHub CLI](/en/github-cli/github-cli/about-github-cli).

To run a workflow, use the `workflow run` subcommand. Replace the `workflow` parameter with either the name, ID, or file name of the workflow you want to run. For example, `"Link Checker"`, `1234567`, or `"link-check-test.yml"`. If you don't specify a workflow, GitHub CLI returns an interactive menu for you to choose a workflow.

```shell
gh workflow run WORKFLOW
```

If your workflow accepts inputs, GitHub CLI will prompt you to enter them. Alternatively, you can use `-f` or `-F` to add an input in `key=value` format. Use `-F` to read from a file.

```shell
gh workflow run greet.yml -f name=mona -f greeting=hello -F data=@myfile.txt
```

You can also pass inputs as JSON by using standard input.

```shell
echo '{"name":"mona", "greeting":"hello"}' | gh workflow run greet.yml --json
```

To run a workflow on a branch other than the repository's default branch, use the `--ref` flag.

```shell
gh workflow run WORKFLOW --ref BRANCH
```

To view the progress of the workflow run, use the `run watch` subcommand and select the run from the interactive list.

```shell
gh run watch
```

</div>

## Running a workflow using the REST API

When using the REST API, you configure the `inputs` and `ref` as request body parameters. If the inputs are omitted, the default values defined in the workflow file are used.

> [!NOTE]
> You can define up to 25  `inputs` for a `workflow_dispatch` event.

For more information about using the REST API, see [REST API endpoints for workflows](/en/rest/actions/workflows#create-a-workflow-dispatch-event).