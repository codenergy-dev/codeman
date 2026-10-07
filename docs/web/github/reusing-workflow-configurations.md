---
title: Reusing workflow configurations
url: https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations
created_at: 2026-10-06T23:14:04-03:00
updated_at: 2026-10-06T23:14:04-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Reusing workflow configurations

Find information about avoiding duplication when creating a workflow by reusing existing workflows.

## Reusable workflows

This article provides reference information for reusable workflows and workflow templates, including access rules, limitations, supported keywords, and runner behavior.

You can centralize deterministic, repeatable logic in reusable workflows, and use agentic workflows for tasks that require contextual judgment about your repository's content such as analysis, summaries, and recommendations. For more information, see [Creating GitHub Agentic Workflows](/en/copilot/how-tos/github-agentic-workflows/creating-github-agentic-workflows).

### Access to reusable workflows

A reusable workflow can be used by another workflow if any of the following is true:

* Both workflows are in the same repository.
* The called workflow is stored in a public repository, and your organization allows you to use public reusable workflows.
* The called workflow is stored in a private repository and the settings for that repository allow it to be accessed. For more information, see [Sharing actions and workflows with your organization](/en/actions/how-tos/reuse-automations/share-with-your-organization) and [Sharing actions and workflows from your private repository](/en/actions/how-tos/reuse-automations/share-across-private-repositories).

The following table shows the accessibility of reusable workflows to a caller workflow, depending on the visibility of the host repository.

| Caller repository | Accessible workflows repositories |
| ----------------- | --------------------------------- |
| `private`         | `private` and `public`            |
|                   |                                   |
| `public`          | `public`                          |

The **Actions permissions** on the callers repository's Actions settings page must be configured to allow the use of actions and reusable workflows - see [Managing GitHub Actions settings for a repository](/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#allowing-select-actions-and-reusable-workflows-to-run).

For private repositories, the **Access** policy on the Actions settings page of the called workflow's repository must be explicitly configured to allow access from repositories containing caller workflows - see [Managing GitHub Actions settings for a repository](/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#allowing-access-to-components-in-a-private-repository).

> \[!NOTE]
> To enhance security, GitHub Actions does not support redirects for actions or reusable workflows. This means that when the owner, name of an action's repository, or name of an action is changed, any workflows using that action with the previous name will fail.

### Limitations of reusable workflows

* You can connect up to ten levels of workflows. For more information, see [Nesting reusable workflows](/en/actions/how-tos/reuse-automations/reuse-workflows#nesting-reusable-workflows).

* You can call a maximum of 50 unique reusable workflows from a single workflow file. This limit includes any trees of nested reusable workflows that may be called starting from your top-level caller workflow file.

  For example, *top-level-caller-workflow\.yml* → *called-workflow-1.yml* → *called-workflow-2.yml* counts as 2 reusable workflows.

* Any environment variables set in an `env` context defined at the workflow level in the caller workflow are not propagated to the called workflow. For more information, see [Store information in variables](/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables) and [Contexts reference](/en/actions/reference/workflows-and-actions/contexts#env-context).

* Similarly, environment variables set in the `env` context, defined in the called workflow, are not accessible in the `env` context of the caller workflow. Instead, you must use outputs of the reusable workflow. For more information, see [Using outputs from a reusable workflow](/en/actions/how-tos/reuse-automations/reuse-workflows#using-outputs-from-a-reusable-workflow).

* To reuse variables in multiple workflows, set them at the organization, repository, or environment levels and reference them using the `vars` context. For more information, see [Store information in variables](/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables) and [Contexts reference](/en/actions/reference/workflows-and-actions/contexts#vars-context).

* Reusable workflows are called directly within a job, and not from within a job step. You cannot, therefore, use `GITHUB_ENV` to pass values to job steps in the caller workflow.

### Supported keywords for jobs that call a reusable workflow

When you call a reusable workflow, you can only use the following keywords in the job containing the call:

* [`jobs.<job_id>.name`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idname)
* [`jobs.<job_id>.uses`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_iduses)
* [`jobs.<job_id>.with`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idwith)
* [`jobs.<job_id>.with.<input_id>`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idwithinput_id)
* [`jobs.<job_id>.secrets`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idsecrets)
* [`jobs.<job_id>.secrets.<secret_id>`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idsecretssecret_id)
* [`jobs.<job_id>.secrets.inherit`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idsecretsinherit)
* [`jobs.<job_id>.strategy`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstrategy)
* [`jobs.<job_id>.needs`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds)
* [`jobs.<job_id>.if`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idif)
* [`jobs.<job_id>.concurrency`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idconcurrency)
* [`jobs.<job_id>.permissions`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idpermissions)
* [`jobs.<job_id>.cache-mode`](/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idcache-mode)

  > \[!NOTE]
  >
  > * If `jobs.<job_id>.permissions` is not specified in the calling job, the called workflow will have the default permissions for the `GITHUB_TOKEN`. For more information, see [Workflow syntax for GitHub Actions](/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).
  > * The `GITHUB_TOKEN` permissions passed from the caller workflow can be only downgraded (not elevated) by the called workflow.
  > * If you use `jobs.<job_id>.concurrency.cancel-in-progress: true`, don't use the same value for `jobs.<job_id>.concurrency.group` in the called and caller workflows as this will cause the workflow that's already running to be cancelled. A called workflow uses the name of its caller workflow in ${{ github.workflow }}, so using this context as the value of `jobs.<job_id>.concurrency.group` in both caller and called workflows will cause the caller workflow to be cancelled when the called workflow runs.

### How reusable workflows use runners

#### GitHub-hosted runners

The assignment of GitHub-hosted runners is always evaluated using only the caller's context. Billing for GitHub-hosted runners is always associated with the caller. The caller workflow cannot use GitHub-hosted runners from the called repository. For more information, see [GitHub-hosted runners](/en/actions/concepts/runners/github-hosted-runners).

#### Self-hosted runners

Called workflows that are owned by the same user or organization as the caller workflow can access self-hosted runners from the caller's context. This means that a called workflow can access self-hosted runners that are:

* In the caller repository
* In the caller repository's organization, provided that the runner has been made available to the caller repository

### Access and permissions for nested workflows

A workflow that contains nested reusable workflows will fail if any of the nested workflows is inaccessible to the initial caller workflow. For more information, see [Access to reusable workflows](#access-to-reusable-workflows).

`GITHUB_TOKEN` permissions can only be the same or more restrictive in nested workflows. For example, in the workflow chain A > B > C, if workflow A has `package: read` token permission, then B and C cannot have `package: write` permission. For more information, see [Use GITHUB\_TOKEN for authentication in workflows](/en/actions/tutorials/authenticate-with-github_token).

For information on how to use the API to determine which workflow files were involved in a particular workflow run, see [Reuse workflows](/en/actions/how-tos/reuse-automations/reuse-workflows#monitoring-which-workflows-are-being-used).

### Behavior of reusable workflows when re-running jobs

Reusable workflows from public repositories can be referenced using a SHA, a release tag, or a branch name. For more information, see [Reuse workflows](/en/actions/how-tos/reuse-automations/reuse-workflows#calling-a-reusable-workflow).

When you re-run a workflow that uses a reusable workflow and the reference is not a SHA, there are some behaviors to be aware of:

* Re-running all jobs in a workflow will use the reusable workflow from the specified reference. For more information about re-running all jobs in a workflow, see [Re-running workflows and jobs](/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs#re-running-all-the-jobs-in-a-workflow).
* Re-running failed jobs or a specific job in a workflow will use the reusable workflow from the same commit SHA of the first attempt. For more information about re-running failed jobs in a workflow, see [Re-running workflows and jobs](/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs#re-running-failed-jobs-in-a-workflow). For more information about re-running a specific job in a workflow, see [Re-running workflows and jobs](/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs#re-running-a-specific-job-in-a-workflow).

### `github` context

When a reusable workflow is triggered by a caller workflow, the `github` context is always associated with the caller workflow. The called workflow is automatically granted access to `github.token` and `secrets.GITHUB_TOKEN`. For more information about the `github` context, see [Contexts reference](/en/actions/reference/workflows-and-actions/contexts#github-context).

## Workflow templates

Reference information to use when creating workflow templates for your organization.

### Workflow template availability

You can use templates in repositories that match or have more restricted visibility than the template repository.

* Workflow templates in a public `.github` repository are available to all repository types.
* Workflow templates in an internal `.github` repository are only available to internal and private repositories.
* Workflow templates in a private `.github` repository are only available to private repositories.

### Granting access for private/internal repositories

If you're using a private or internal `.github` repository, you need to grant Read access to users or teams who should be able to use the templates.

### The `$default-branch` placeholder

If you need to refer to a repository's default branch, you can use the `$default-branch` placeholder in your workflow template. When a workflow is created the placeholder will be automatically replaced with the name of the repository's default branch.

### Example workflow template file

This file named `octo-organization-ci.yml` demonstrates a basic workflow.

```yaml copy
name: Octo Organization CI
on:
  push:
    branches: [ $default-branch ]
  pull_request:
    branches: [ $default-branch ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Run a one-line script
        run: echo Hello from Octo Organization
```

### Metadata file requirements

The metadata file must have the same name as the workflow file, but instead of the `.yml` extension, it must be appended with `.properties.json`. For example, this file named `octo-organization-ci.properties.json` contains the metadata for a workflow file named `octo-organization-ci.yml`:

```json copy
{
    "name": "Octo Organization Workflow",
    "description": "Octo Organization CI workflow template.",
    "iconName": "example-icon",
    "categories": [
        "Go"
    ],
    "filePatterns": [
        "package.json$",
        "^Dockerfile",
        ".*\\.md$"
    ]
}
```

* `name` - **Required.** The name of the workflow. This is displayed in the list of available workflows.

* `description` - **Required.** The description of the workflow. This is displayed in the list of available workflows.

* `iconName` - **Optional.** Specifies an icon for the workflow that is displayed in the list of workflows. `iconName` can be one of the following types:
  * An SVG file that is stored in the `workflow-templates` directory. To reference a file, the value must be the file name without the file extension. For example, an SVG file named `example-icon.svg` is referenced as `example-icon`.
  * An icon from GitHub's set of [Octicons](https://primer.style/octicons/). To reference an octicon, the value must be `octicon <icon name>`. For example, `octicon smiley`.

* `categories` - **Optional.** Defines the categories that the workflow is shown under. You can use category names from the following lists:
  * General category names from the [starter-workflows](https://github.com/actions/starter-workflows/blob/main/README.md#categories) repository.
  * Linguist languages from the list in the [linguist](https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml) repository.
  * Supported tech stacks from the list in the [starter-workflows](https://github.com/github-starter-workflows/repo-analysis-partner/blob/main/tech_stacks.yml) repository.

* `filePatterns` - **Optional.** Allows the workflow to be used if the user's repository has a file in its root directory that matches a defined regular expression.

## YAML anchors and aliases

You can use YAML anchors and aliases to reduce repetition in your workflows. An anchor (marked with `&`) identifies a piece of content that you want to reuse, while an alias (marked with `*`) repeats that content in another location.

For detailed information about anchors and aliases, see [Node Anchors and Aliases in the YAML specification](https://yaml.org/spec/1.2.2/#3222-anchors-and-aliases).

Here's an example that uses YAML anchors and aliases with environment variables:

```yaml
jobs:
  job1:
    env: &env_vars # Define the anchor on first use
      NODE_ENV: production
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
    steps:
      - run: echo "Using production settings"

  job2:
    env: *env_vars # Reuse the environment variables
    steps:
      - run: echo "Same environment variables here"
```

This is equivalent to writing the following YAML without anchors and aliases:

```yaml
jobs:
  job1:
    env:
      NODE_ENV: production
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
    steps:
      - run: echo "Using production settings"

  job2:
    env:
      NODE_ENV: production
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
    steps:
      - run: echo "Same environment variables here"
```

You can also use anchors for more complex configurations, such as reusing an entire job configuration:

```yaml
jobs:
  test: &base_job # Define the anchor on first use
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      NODE_VERSION: '18'
    steps:
      - uses: actions/checkout@v6
      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: ${{ env.NODE_VERSION }}
      - run: npm test

  alt-test: *base_job # Reuse the entire job configuration
```