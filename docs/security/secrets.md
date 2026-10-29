# Secrets

This page lists the credentials Codeman's jobs use, the permissions each job requests, and why each credential is safe from the agent and from the other jobs.

> [!IMPORTANT]
> These sections say what protects each secret from the agent and from other jobs, not from people with write access. Codeman's secrets are plain repository or organization secrets: anyone with write access to a repository that receives them can read them all, with a workflow on any branch ([who can read Codeman's secrets](overview.md#who-can-read-codemans-secrets)).

## Where each credential goes

The workflow is [`templates/codeman.yml`](../../templates/codeman.yml). It runs each task's jobs (`open-key`, `agent`, `close-key`, `apply`, `release-pod`) in [`templates/codeman-task.yml`](../../templates/codeman-task.yml); the jobs are described in [runs and jobs](../runs/runs-and-jobs.md#jobs). `codeman.yml` passes that workflow its secrets by name, and each of its jobs references only the secrets this table names.

| Credential | Jobs that hold it | Reaches the agent | Safe | Worst case if it leaks |
| --- | --- | --- | --- | --- |
| [GitHub App private key](#github-app-private-key), and its App tokens | `select`, `dispatch`, `apply` | No | Yes | Tokens for every installation of the App, with the App's permissions |
| [OpenRouter management key](#openrouter-management-key) | `open-key`, `close-key` | No | Yes | Keys without limits, on the account's credits; the account's keys listed and changed |
| [Runpod API key](#runpod-api-key) | `open-key`, `close-key`, `release-pod` | No | Yes | Anything in the Runpod account, including spending all its credits |
| [Salad API key](#salad-api-key) | `open-key`, `close-key`, `release-pod` | No | Yes | Anything in every Salad organization of the key's user, including spending all their credits |
| [Runpod Serverless key](#runpod-serverless-key) | Codeman's step in `agent` | No | Yes, with the `agent` job as the template has it | The endpoint, run at the account's cost until someone revokes the key |
| [Key encryption secret](#key-encryption-secret) | `open-key`, Codeman's step in `agent` | No | Yes, with the `agent` job as the template has it | The task keys in the run logs, decrypted |
| [The run's task key or run token](#the-runs-task-key-or-run-token) | The agent, in `agent` | Yes: it is the agent's own | Partly | What remains of the task's budget, until the run ends |
| [GitHub's OIDC token and the backend's tokens](#githubs-oidc-token-and-the-backends-tokens) | `select`, `open-key`, `close-key`, `release-pod` | No: `agent` never gets one | Yes | All of the project's Firestore data, for an hour |
| [The jobs' `GITHUB_TOKEN`](#the-jobs-github_token) | Every job, with its own permissions | No | Yes | Reading the repository and its runs (`agent`), or starting workflows (`forward-review`, `next-run`) |
| [The repository's own secrets](#the-repositorys-own-secrets) | The repository's other workflows | Indirectly ([risk 1](risks.md#1-code-the-agent-wrote-runs-with-the-repositorys-secrets)) | Depends on those workflows | Whatever those workflows expose |

## Permissions each job requests

Both templates set `permissions: {}` at the top, so a job's `GITHUB_TOKEN` has only what the job asks for. `codeman.yml` grants `codeman-task.yml` at most the `agent` job's permissions plus `id-token: write`, which only the jobs that use Codeman's [backend](../backend/backend.md) ask for. Each job of `codeman-task.yml` asks for its own.

| Workflow | Job | `GITHUB_TOKEN` | App token | OIDC token | Codeman's secrets |
| --- | --- | --- | --- | --- | --- |
| `codeman.yml` | `forward-review` | `actions: write` | — | No | None |
| `codeman.yml` | `select` | Only `id-token: write` | Contents, pull requests, actions and metadata read; issues write | Yes | App key |
| `codeman.yml` | `dispatch` | None | For one repository of the pool: `actions: write`, `metadata: read` | No | App key |
| `codeman-task.yml` | `open-key` | Only `id-token: write` | — | Yes | Management key, Runpod and Salad API keys, encryption secret |
| `codeman-task.yml` | `agent` | `contents: read`, `actions: read` | — | No | Encryption secret, Serverless key |
| `codeman-task.yml` | `close-key` | Only `id-token: write` | — | Yes | Management key, Runpod and Salad API keys |
| `codeman-task.yml` | `apply` | None | Contents, issues and pull requests write; for `accept` only, a second token with contents and workflows write | No | App key |
| `codeman-task.yml` | `release-pod` | Only `id-token: write` | — | Yes | Runpod and Salad API keys |
| `codeman.yml` | `next-run` | `actions: write` | — | No | None |

Every job that runs Codeman also uses its `GITHUB_TOKEN` to check `CODEMAN_COMMIT_SHA` against Codeman's public repository ([risk 7](risks.md#7-codemans-own-code-and-dependencies)).

## Each credential

### GitHub App private key

`CODEMAN_GITHUB_APP_PRIVATE_KEY`, and the App tokens made from it.

- **Used by:** `select`, `apply` and `dispatch`.
- **Why it is safe:**
  - These jobs run no LLM and no repository code.
  - Each job requests a token with only the permissions it needs.
  - `dispatch`'s token is for one repository of the [pool](../glossary.md#pool-of-organizations), with `actions: write` and `metadata: read` only, to start that repository's Codeman run on its default branch ([risk 8](risks.md#8-a-pool-shares-one-app-key)).
  - `apply` treats the agent's result as untrusted, and filters it through the [change policy](../runs/changes.md#change-policy).
  - The token that may write workflows is requested only to move workflows a [maintainer](../glossary.md#maintainer) accepted.
- **Gap:** the App may write to every branch of the repositories it is installed on. Codeman only writes to [task branches](../glossary.md#task-branch), but nothing else stops it.
- **Mitigation:** install the App on selected repositories only. Add a ruleset on the default branch that requires a pull request.

### OpenRouter management key

`CODEMAN_OPENROUTER_MANAGEMENT_KEY`.

- **Used by:** `open-key` and `close-key`.
- **Why it is safe:** these jobs check out only Codeman's code, run no LLM, and send this key only to OpenRouter.
- **Gap:**
  - It creates keys without limits, which spend the account's credits. It can also list and change the account's keys ([create](../web/openrouter/create-a-new-api-key.md), [list](../web/openrouter/list-api-keys.md), [update](../web/openrouter/update-an-api-key.md)).
  - Anyone with write access to a repository that receives it can read it ([who can read Codeman's secrets](overview.md#who-can-read-codemans-secrets)).
- **Mitigation:** an OpenRouter account dedicated to Codeman, with prepaid credits and nothing that refills them automatically. Rotate the key if it may have leaked.

### Runpod API key

`CODEMAN_RUNPOD_API_KEY`, for the `runpod-pod` and `runpod-serverless` [inference providers](../glossary.md#inference-provider).

- **Used by:** `open-key`, `close-key` and `release-pod`.
- **Why it is safe:**
  - These jobs check out only Codeman's code, run no LLM, and only call Runpod and the pods' gateways.
  - A [pod](../glossary.md#pod) gets only the hash of its admin token, which is derived from this key.
- **Gap:** it may do anything in the Runpod account, including spend all its credits.
- **Mitigation:** an account dedicated to Codeman, with prepaid credits and no auto-pay ([installation](../installation/runpod.md)).

### Salad API key

`CODEMAN_SALAD_API_KEY`, for the `salad-pod` provider, with the variables `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT`, which name where Codeman creates its container groups.

- **Used by:** `open-key`, `close-key` and `release-pod`.
- **Why it is safe:**
  - These jobs check out only Codeman's code, run no LLM, and only call Salad and the pods' gateways.
  - A pod gets no Salad key at all, only the hash of its admin token, which is derived from this key. It ends by exiting, and the key jobs delete its group ([self-termination](../inference/pods.md#self-termination)).
- **Gap:** the key is its Salad user's, not the organization's. It may do anything in every organization and project the user belongs to, including spend all their credits ([using the API](../web/salad/using-the-api.md)).
- **Mitigation:** a Salad user that belongs only to Codeman's organization, with prepaid credits and no auto recharge ([installation](../installation/salad.md)).

### Runpod Serverless key

`CODEMAN_RUNPOD_SERVERLESS_KEY`, for the `runpod-serverless` provider.

- **Used by:** Codeman's step in `agent`, which runs the [gateway](../glossary.md#gateway) outside the sandbox.
- **Why it is safe**, with the `agent` job as the template has it: it has the same isolation as the [key encryption secret](#key-encryption-secret). The agent gets only a local URL and the run's token, which stops working when the run ends or its budget is spent.
- **Gap:**
  - It does not expire and has no spending limit.
  - A step added to `agent` that runs repository code can read it ([risk 3](risks.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox)), and run the endpoint at the account's cost until someone revokes it.
- **Mitigation:**
  - Restrict the key to the endpoint.
  - Keep the endpoint at one worker.
  - Use prepaid credits.
  - If a step did run repository code, revoke the key.

### Key encryption secret

`CODEMAN_KEY_ENCRYPTION_SECRET`.

- **Used by:** `open-key`, and Codeman's step in `agent`.
- **Why it is safe**, with the `agent` job as the template has it: in `agent`, only Codeman's own step holds it. The agent runs as another user, which cannot read that step's process ([agent sandbox](../runs/agent.md#agent-sandbox)).
- **Gap:** a step added to `agent` that runs repository code runs as the runner's user, and can read it ([risk 3](risks.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox)). With it, anyone can decrypt the task keys in the run logs, which are public on public repositories.
- **Mitigation:** run no repository code in `agent`. If a step did, rotate the secret. Each key it protects is disabled when its run ends, and expires within 24 hours.

### The run's task key or run token

The [agent run](../glossary.md#agent-run)'s credential: an OpenRouter [task key](../glossary.md#task-key), or a [run token](../glossary.md#run-token) for a self-hosted gateway.

- **Used by:** the agent, in `agent`. It is the agent's own credential.
- **Why it is only partly safe:**
  - **Limit:** what remains of the task's [budget](../budget/budget.md).
  - **Lifetime:** `close-key` disables the key, or ends the run on its gateway, when the run ends. A key expires after 24 hours, and a pod's run once its budget is spent ([OpenRouter](../inference/openrouter.md)).
  - **Isolation:** on a pod that several tasks share, of any repository of the pool, it opens only its own run.
  - **Exposure:** it is masked in the logs, and travels between jobs encrypted.
- **Gap:** a manipulated agent can send it out ([risk 4](risks.md#4-the-agent-can-send-its-task-key-out)).
- **Mitigation:** keep the task budget low. [Roadmap](overview.md#roadmap) item 1 would restrict the agent's network.

### GitHub's OIDC token and the backend's tokens

GitHub's OIDC token (`id-token: write`), and the backend's tokens made from it.

- **Used by:** `select`, `open-key`, `close-key` and `release-pod`.
- **Why it is safe:**
  - These jobs run no LLM and no repository code.
  - No key is stored. The OIDC token proves the job's repository and workflow. Google exchanges it for an hour's access as the backend's service account, to Firestore only.
  - The provider's [attribute condition](../glossary.md#attribute-condition) admits only `codeman.yml` on the default branch ([installation](../installation/setup.md#4-set-up-the-backend)). It admits the repositories of the organization, by its ID, or only those it lists, by theirs.
  - Both tokens are masked.
  - `agent` never gets one, so neither the agent nor a Serverless gateway reaches the backend ([backend](../backend/backend.md)).
- **Gap:**
  - Whoever can change `codeman.yml` or `codeman-task.yml` on the default branch can read and write all of the project's Firestore data.
  - That data holds Codeman's records, but no secret. The [pod registry](../glossary.md#pod-registry) holds each pod's nonce, from which only the GPU account's key derives its admin token.
  - With that access, they can make other repositories' pods end, or take new tasks.
  - The condition cannot tell one job of the workflow from another: `id-token: write` given to `agent` would let the agent in.
- **Mitigation:**
  - A Firebase project for Codeman only.
  - The attribute condition of [installation](../installation/setup.md#4-set-up-the-backend).
  - Reviewed pull requests on the default branch.
  - Never give `agent` that permission.

### The jobs' GITHUB_TOKEN

Each job's permissions are in [permissions each job requests](#permissions-each-job-requests).

| Jobs | Permissions | Used for | Why it is safe | Gap |
| --- | --- | --- | --- | --- |
| `agent` | `contents: read`, `actions: read` | The repository's checkout, the commit check, and Codeman's step, which downloads the results of workflows | The agent never sees it: it has the [key encryption secret](#key-encryption-secret)'s isolation. It can only read | The encryption secret's, with its mitigation |
| `forward-review`, `next-run` | `actions: write` | Starting the Codeman workflow with `gh workflow run` | They check out nothing. Values reach the command through environment variables, not the script | None known |
| The other jobs | None, besides `id-token: write` where the job asks for it | The commit check, on Codeman's public repository | It can do nothing else | — |

### The repository's own secrets

The secrets the repository's other workflows use.

- **Used by:** the repository's workflows. Codeman never reads or references them.
- **Safe:** it depends on those workflows.
- **Gap:** workflows that run on Codeman's branches run code the agent wrote, with the secrets those workflows expose ([risk 1](risks.md#1-code-the-agent-wrote-runs-with-the-repositorys-secrets)).
- **Mitigation:** see [risk 1](risks.md#1-code-the-agent-wrote-runs-with-the-repositorys-secrets).

## Visibility across repositories

Organization secrets whose visibility is limited to selected repositories stay limited to those repositories. Inside each of them, though, every workflow that references them gets them, on any branch, Codeman's task branches included. So anyone with write access to one of them can read them all ([who can read Codeman's secrets](overview.md#who-can-read-codemans-secrets)).

## Variables

Variables are not secrets. Organization owners change the organization's variables. Anyone with write access to a repository can create a repository variable of the same name, which overrides the organization's for that repository ([precedence](../web/github/variables-reference.md#configuration-variable-precedence)).

| Variable | What it does | What it grants by itself |
| --- | --- | --- |
| `CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER`, `CODEMAN_SERVICE_ACCOUNT` | Name the backend's project and identity | Nothing without a job's OIDC token that the provider admits |
| `CODEMAN_GITHUB_APP_CLIENT_ID` | Names the App | Nothing without the App's private key ([forks](forks.md#variables)) |
| `CODEMAN_SETTINGS` | Holds the [organization's settings](../glossary.md#organizations-settings) ([shared settings](../installation/shared-settings.md)) | The settings of every repository it is shared with, budgets and model included |
| `CODEMAN_COMMIT_SHA` | Names [Codeman's commit](../glossary.md#codemans-commit): the commit every job checks out and runs with the secrets above | Nothing, but whoever changes it chooses the code that runs ([risk 7](risks.md#7-codemans-own-code-and-dependencies)) |

`CODEMAN_SETTINGS` is plain text:

- Every repository it is shared with can read it, in any workflow.
- The `select` job prints it, and the values it gives, in its log, which is public on public repositories.
- A repository variable of that name replaces the settings whole, `organization-monthly-budget` and `pool` included ([who can read Codeman's secrets](overview.md#who-can-read-codemans-secrets)).
- Each repository's `.codeman/settings.yml` still overrides either.

> [!WARNING]
> Never put a secret in `CODEMAN_SETTINGS`, or in any variable: settings never hold secrets, and variables are shown in the logs.
