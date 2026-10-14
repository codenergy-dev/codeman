---
status: completed
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
commit: 03d284b
---

# The backend's condition, secrets' repository access and maintenance

## Goal

Let each organization choose how far the backend's attribute condition reaches, close the gap [forks](../security/forks.md) describes with documented settings, and give whoever runs the backend the commands to read, change, delete and audit its Google Cloud setup.

## Context

- The provider's condition admits any repository of the organization whose `codeman.yml` on `main` asks for a token ([setup](../installation/setup.md#4-set-up-the-backend)). Anyone who can create a repository, or fork one inside the organization, reaches the backend without a secret ([forks](../security/forks.md#what-a-fork-cannot-reach)).
- GitHub's OIDC token carries `repository_id`, `repository_owner_id` and `workflow_ref`, as strings ([OpenID Connect](../web/github/openid-connect.md)). A condition may use `assertion` directly, and Google's guide asks for a mapping of every field a condition uses ([deployment pipelines](../web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md#define-an-attribute-condition)). A condition is at most 4096 characters ([update-oidc](../web/google-cloud/gcloud-iam-workload-identity-pools-providers-update-oidc.md)).
- Organization secrets and variables can be limited to selected repositories, in the UI, with `gh` and with the REST API ([secrets](../web/github/using-secrets-in-github-actions.md#creating-secrets-for-an-organization), [gh secret set](../web/github-cli/gh-secret-set.md), [REST](../web/github/rest-api-endpoints-for-github-actions-secrets.md)).
- The responsible person has not run the `gcloud` part of the setup yet, so the setup can change without a migration.
- Documentation only. No calls that change anything at Google or GitHub; pages are fetched, never acted on.

## Decisions

### Answered by the responsible person on 2026-10-14

1. **The condition.** Document two variants and let each reader choose: *any repository of the organization(s)* (owner IDs and `codeman.yml` on the default branch, today's), whose cost is restricting repository creation and forking; and *only listed repositories* (`assertion.repository_id in [...]` added, with the owner and `workflow_ref` checks kept), whose cost is a condition update for each new repository. Recommend the second for pools and public repositories.
2. **Secrets and variables.** Recommend the "Selected repositories" policy for every organization secret and variable of Codeman, with the UI steps and the `gh` commands.
3. **Maintenance.** A new page for reading, updating, deleting and restoring each Google Cloud resource of the backend, with `gcloud` and console paths verified in recorded pages, and where to see who changed them.

### Taken while writing

4. **Where the maintenance page lives:** `docs/installation/backend-maintenance.md`. `docs/installation/` holds what an operator runs (setup, upgrading), and the page continues part 4 of the setup with its placeholders; `docs/backend/` explains how the backend works.
5. **The mapping includes `repository_id` in both variants**, so moving from one variant to the other changes only the condition.

## Steps

1. Record the pages relied on: Google's guides on managing pools and providers, Workload Identity Federation, deleting service accounts, Cloud Audit Logs, Resource Manager's audit logging and the token exchange's logs (full copies); IAM's audit logging and each `gcloud` command used (own words, since they have no Markdown source); Firebase's pages on managing databases and rules; GitHub's REST pages on Actions secrets and variables; the `gh` commands used, with a new tool. Done when `npm test` accepts them.
2. Setup: the two condition variants, the mapping with `repository_id`, the repository access of secrets and variables, and links to the maintenance page instead of the inline update command. Done when each command is in a recorded page.
3. The maintenance page, linked from the index. Done when each resource has its read, update, delete and restore commands, and the audit section its query.
4. Security pages: [forks](../security/forks.md), the [checklist](../security/overview.md#checklist), [secrets](../security/secrets.md) and [backend](../backend/backend.md) link to the variants and the policy without repeating them. Done when `npm run check` passes.

All four were done on 2026-10-14.

## Out of scope

- Changing Codeman's code or templates.
- Deleting the whole Firebase project.
- A condition built from repository custom properties or any claim beyond those listed above.
