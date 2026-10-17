# Shared settings

An organization can give the repositories that use Codeman the same settings, such as the model and the budgets, instead of repeating them in each `.codeman/settings.yml`:

1. As an organization owner, under the organization's **Settings → Secrets and variables → Actions → Variables**, create a variable named `CODEMAN_SETTINGS`. Its value has the format of `.codeman/settings.yml`:

   ```yaml
   model: deepseek/deepseek-v4.1-flash
   task-budget: 1
   monthly-budget: 50
   organization-monthly-budget: 120
   ```

2. Under **Repository access**, choose the repositories that use Codeman.
3. Check that each repository's workflow passes the variable to the `select` step, as the template does: `settings: ${{ vars.CODEMAN_SETTINGS }}`. Workflow files copied before that line existed ignore the variable.

These are defaults: a repository's `.codeman/settings.yml` inherits them and overrides them value by value, and a manual run's inputs and a task's commands override both; see [settings](../settings/reference.md). A repository needs no `.codeman/settings.yml`: without one, the shared settings and Codeman's defaults apply. A copy of [`templates/settings.yml`](../../templates/settings.yml) sets the model, the provider and the budgets itself, and so overrides the organization's; write only the values to override. The `select` job's log names where each value came from. A malformed variable stops every run of those repositories, with an error that names the `settings` input.

`organization-monthly-budget` is the exception: only `CODEMAN_SETTINGS` sets it, not `.codeman/settings.yml`. It limits what all the organization's repositories spend in a calendar month together, every provider included, with the Runpod account's whole billing; without it, only each repository's `monthly-budget` holds. A repository's `.codeman/settings.yml` that sets it stops its runs with an error. See [budget](../budget/budget.md).

`pool` is the other: only `CODEMAN_SETTINGS` sets it, not `.codeman/settings.yml`. It names the organizations whose repositories batch tasks on shared pods, this one included, such as `pool: [organization-a, organization-b]`; each must declare the same list in its own `CODEMAN_SETTINGS`, use the same Runpod account and the same backend, and have the App installed. Without it, the organization's repositories batch only with each other. See [batches across repositories](../runs/batches.md#pools) and [setup](setup.md#a-pool-of-organizations).

- On GitHub Free, private repositories cannot read organization variables.
- A repository variable named `CODEMAN_SETTINGS` replaces the organization's whole, not value by value: GitHub gives the repository's variable precedence ([GitHub](../web/github/variables-reference.md#configuration-variable-precedence)). Use `.codeman/settings.yml` to override single values.
- A variable holds at most 48 KB.
- The variable is plain text, shown in the logs. Never put secrets in it; see [security](../security/secrets.md).

> [!WARNING]
> Anyone with write access to a repository can create a repository variable `CODEMAN_SETTINGS` ([GitHub](../web/github/store-information-in-variables.md#creating-configuration-variables-for-a-repository)). That repository's runs then read neither the organization's `organization-monthly-budget` nor its `pool`, only what that variable sets, if anything: they no longer stop at the organization's monthly limit, and the repository leaves the pool or declares another list. These two settings hold only as far as you trust everyone with write access to the repositories that use Codeman ([security](../security/overview.md#who-can-read-codemans-secrets)).
