# A pool of organizations

This page sets up a [pool of organizations](../glossary.md#pool-of-organizations): organizations that share one GPU account, on Runpod or Salad, and so can [batch](../glossary.md#batch) tasks on the same pods. How the pool works is in [batches across repositories](../runs/batches.md#pools).

Without a pool, an organization is a pool alone: its repositories batch only with each other.

## Before you start

- One organization has Codeman set up, as in [installation](setup.md).
- Its App is made public: under **Where can this GitHub App be installed**, **Any account** ([step 1](setup.md#1-register-the-github-app)). Making it public does not list it in the Marketplace.
- Its backend uses the condition that lists repositories, which is recommended for a pool ([choose the attribute condition](setup.md#choose-the-attribute-condition)).

> [!WARNING]
> A pool is mutual trust. Anyone with write access to a repository of any member that receives the App's private key can read it, with a workflow on any branch ([who can read Codeman's secrets](../security/overview.md#who-can-read-codemans-secrets)). They then reach every member's installed repositories with the App's permissions ([risk 8](../security/risks.md#8-a-pool-shares-one-app-key)).

## Add an organization

For each organization of the pool:

1. **Install the same App**, by its link (**Public page → Install**), with **Only select repositories**.
2. **Add the same secrets and variables as the first organization** ([credentials](setup.md#3-add-the-credentials)):

   | Credential | In each member |
   | --- | --- |
   | `CODEMAN_GITHUB_APP_CLIENT_ID`, `CODEMAN_GITHUB_APP_PRIVATE_KEY` | The same App's |
   | `CODEMAN_RUNPOD_API_KEY` | The key of the same Runpod account |
   | `CODEMAN_SALAD_API_KEY`, `CODEMAN_SALAD_ORGANIZATION`, `CODEMAN_SALAD_PROJECT` | The same Salad user's key, organization and project, with `salad-pod` |
   | `CODEMAN_OPENROUTER_MANAGEMENT_KEY` | The OpenRouter keys, as in [credentials](setup.md#secrets) |
   | `CODEMAN_KEY_ENCRYPTION_SECRET` | An encryption secret, which the members need not share |
   | `CODEMAN_FIREBASE_PROJECT`, `CODEMAN_WORKLOAD_IDENTITY_PROVIDER`, `CODEMAN_SERVICE_ACCOUNT` | The same project, provider and service account |
   | `CODEMAN_COMMIT_SHA` | The same commit in every member: their runs share pods, the board and the batches, whose format a version may change |

3. **Add its ID to the provider's condition**, as `assertion.repository_owner_id in ['<ID of A>', '<ID of B>']`. With the listed-repositories condition, also add the IDs of its repositories that run Codeman ([change the condition](backend-maintenance.md#change-the-attribute-condition)).
4. **Set `pool`** to the same list in its `CODEMAN_SETTINGS`, such as `pool: [organization-a, organization-b]` ([shared settings](shared-settings.md#settings-only-the-organization-sets)).
5. **Copy the same workflow files** into each repository that runs Codeman ([step 5](setup.md#5-add-the-workflow-and-settings)).

> [!IMPORTANT]
> The attribute condition is the pool's real boundary. Only the owners and repositories it admits reach the [board](../glossary.md#board), the batches and the [pod registry](../glossary.md#pod-registry).

**You should now see**, in the `select` log of each member's next run, the line `Pool <pool ID>: batches with the repositories of <members>.` A member whose `pool` does not match gets a warning instead, and is not batched ([the handshake](../runs/batches.md#pools)).
