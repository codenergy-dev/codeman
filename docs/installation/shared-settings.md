# Shared settings

An organization can give the repositories that use Codeman the same settings, such as the model and the budgets, instead of repeating them in each `.codeman/settings.yml`. These are the [organization's settings](../glossary.md#organizations-settings).

## Create the variable

1. As an organization owner, under the organization's **Settings → Secrets and variables → Actions → Variables**, create a variable named `CODEMAN_SETTINGS`. Its value has the format of `.codeman/settings.yml`:

   ```yaml
   model: deepseek/deepseek-v4.1-flash
   task-budget: 1
   monthly-budget: 50
   organization-monthly-budget: 120
   ```

2. Under **Repository access**, choose the repositories that use Codeman.
3. Check that each repository's workflow passes the variable to the `select` step, as the template does: `settings: ${{ vars.CODEMAN_SETTINGS }}`.

**You should now see**, in the `select` log of a run that picks a task, a line that names the values from the variable. For the example, in a repository without `.codeman/settings.yml`, it is such as:

```text
Settings from the `settings` input (organization variable CODEMAN_SETTINGS): model=deepseek/deepseek-v4.1-flash, task-budget=1, monthly-budget=50, organization-monthly-budget=120.
```

## How they combine

The organization's settings are the second [layer](../glossary.md#layer): a repository's `.codeman/settings.yml` inherits them and overrides them value by value, and so do the later layers. The order of the layers, and which value wins, is in [layers](../settings/reference.md#layers).

- A repository needs no `.codeman/settings.yml`. Without one, the shared settings and Codeman's defaults apply.
- With shared settings, write in the repository's file only the values to override.
- The `select` job's log names where each value came from.

> [!WARNING]
> A copy of [`templates/settings.yml`](../../templates/settings.yml) sets the model, the provider and the budgets itself, and so overrides the organization's values.

## Settings only the organization sets

Two settings are set only in `CODEMAN_SETTINGS`, not in `.codeman/settings.yml`. A repository's `.codeman/settings.yml` that sets either stops its runs with an error.

| Setting | What it does | Without it |
| --- | --- | --- |
| `organization-monthly-budget` | Limits what all the organization's repositories spend in a calendar month together, every provider included, with the Runpod account's whole billing ([budget](../budget/budget.md)) | Only each repository's `monthly-budget` holds |
| `pool` | Names the organizations whose repositories batch tasks on shared pods, this one included, such as `pool: [organization-a, organization-b]` ([a pool of organizations](pool.md), [batches across repositories](../runs/batches.md#pools)) | The organization's repositories batch only with each other |

Each organization of a pool must declare the same list in its own `CODEMAN_SETTINGS`, use the same Runpod account and the same backend, and have the App installed.

> [!WARNING]
> Anyone with write access to a repository can create a repository variable `CODEMAN_SETTINGS` ([GitHub](../web/github/store-information-in-variables.md#creating-configuration-variables-for-a-repository)). That repository's runs then read neither the organization's `organization-monthly-budget` nor its `pool`, only what that variable sets, if anything. They no longer stop at the organization's monthly limit, and the repository leaves the pool or declares another list. These two settings hold only as far as you trust everyone with write access to the repositories that use Codeman ([security](../security/overview.md#who-can-read-codemans-secrets)).

## Limits

- On GitHub Free, private repositories cannot read organization variables ([credentials](setup.md#3-add-the-credentials)).
- A repository variable named `CODEMAN_SETTINGS` replaces the organization's whole, not value by value: GitHub gives the repository's variable precedence ([GitHub](../web/github/variables-reference.md#configuration-variable-precedence)). Use `.codeman/settings.yml` to override single values.
- A variable holds at most 48 KB.
- The variable is plain text, shown in the logs. Never put secrets in it; see [security](../security/secrets.md).
- A malformed variable stops every run of those repositories, with an error that names the `settings` input.
