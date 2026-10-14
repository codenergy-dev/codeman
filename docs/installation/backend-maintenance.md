# Backend maintenance

For whoever runs Codeman's backend: how to read, change, delete and restore each part of the Google Cloud setup that [installation](setup.md#4-set-up-the-backend) creates, and how to see who changed it. Creating them is in the installation; this page starts from there.

The commands use the installation's names: the pool `codeman`, the provider `github` and the service account `codeman`, in the project `PROJECT_ID`. Run them where `gcloud` is installed, such as [Cloud Shell](https://shell.cloud.google.com), with an account that may manage the project, such as its owner:

```sh
PROJECT_ID=codeman-ops   # the project ID
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="codeman@$PROJECT_ID.iam.gserviceaccount.com"
ORG_ID=123456789   # the organization's numeric ID: gh api orgs/<organization> --jq .id
```

Make changes between runs. Each of a run's jobs that reaches the backend (`select`, `open-key`, `close-key`, `release-pod`) exchanges its own token, so a change that refuses them fails the jobs that start after it, even within a run that `select` already passed.

## The pool

In the console, the **Workload Identity Pools** page (`https://console.cloud.google.com/iam-admin/workload-identity-pools`) lists the pools; a pool's display name opens its details ([manage pools](../web/google-cloud/manage-workload-identity-pools-and-providers.md#list-pools)).

```sh
gcloud iam workload-identity-pools list --project="$PROJECT_ID" --location=global
gcloud iam workload-identity-pools describe codeman --project="$PROJECT_ID" --location=global
```

`list --show-deleted` includes deleted pools ([list](../web/google-cloud/gcloud-iam-workload-identity-pools-list.md)).

- **Change.** `update` changes its display name, description, or state ([update](../web/google-cloud/gcloud-iam-workload-identity-pools-update.md)).
- **Disable: the backend's emergency stop.** A disabled pool exchanges no tokens, and the tokens it already issued stop granting access; every Codeman job that reaches the backend fails until the pool is enabled again, and then those tokens work again. Enable it again with the pool's **Status** toggle in the console ([update a pool](../web/google-cloud/manage-workload-identity-pools-and-providers.md#update-a-pool)); the `gcloud` reference documents no flag for it.

  ```sh
  gcloud iam workload-identity-pools update codeman --project="$PROJECT_ID" --location=global --disabled
  ```

- **Delete.** Deleting the pool deletes its providers too. Google advises disabling it first and deleting it once nothing broke. A deleted pool can be restored for 30 days; then it is gone, and until then its ID cannot be reused ([delete a pool](../web/google-cloud/manage-workload-identity-pools-and-providers.md#delete-a-pool)).

  ```sh
  gcloud iam workload-identity-pools delete codeman --project="$PROJECT_ID" --location=global
  gcloud iam workload-identity-pools undelete codeman --project="$PROJECT_ID" --location=global
  ```

  In the console, **Show deleted pools and providers**, then the pool's **Restore** icon, restores it with its providers ([undelete a pool](../web/google-cloud/manage-workload-identity-pools-and-providers.md#undelete-a-pool)).

## The provider

In the console, on the **Workload Identity Pools** page, the pool's **Expand node** icon lists its providers, and a provider's **Edit** icon shows its details and edits them ([get a provider](../web/google-cloud/manage-workload-identity-pools-and-providers.md#get-a-provider), [update a provider](../web/google-cloud/manage-workload-identity-pools-and-providers.md#update-a-provider)).

```sh
gcloud iam workload-identity-pools providers list --project="$PROJECT_ID" \
  --location=global --workload-identity-pool=codeman
gcloud iam workload-identity-pools providers describe github --project="$PROJECT_ID" \
  --location=global --workload-identity-pool=codeman
```

### Read the condition and the mapping

`--format` prints one field of the provider ([formats](../web/google-cloud/gcloud-topic-formats.md); the fields are `attributeCondition` and `attributeMapping`, [provider resource](../web/google-cloud/rest-resource-projects-locations-workloadidentitypools-providers.md)):

```sh
gcloud iam workload-identity-pools providers describe github --project="$PROJECT_ID" \
  --location=global --workload-identity-pool=codeman --format='value(attributeCondition)'
gcloud iam workload-identity-pools providers describe github --project="$PROJECT_ID" \
  --location=global --workload-identity-pool=codeman --format='yaml(attributeMapping)'
```

### Change the attribute condition

The condition decides which repositories reach the backend ([the two variants](setup.md#4-set-up-the-backend)). Change it to add a repository with the listed-repositories variant, add an organization to a [pool](setup.md#a-pool-of-organizations), move from one variant to the other, or follow a renamed `codeman.yml` or default branch.

1. **Save the current condition**, to put it back if needed:

   ```sh
   gcloud iam workload-identity-pools providers describe github --project="$PROJECT_ID" \
     --location=global --workload-identity-pool=codeman \
     --format='value(attributeCondition)' > condition-before.txt
   ```

2. **Write the new one** in a variable, from the saved one, and check its length: at most 4096 characters ([update-oidc](../web/google-cloud/gcloud-iam-workload-identity-pools-providers-update-oidc.md)). A repository's ID comes from `gh api repos/<owner>/<repository> --jq .id`; IDs are quoted, since the token's claims are strings.

   ```sh
   CONDITION="assertion.repository_owner_id == '$ORG_ID' && assertion.repository_id in ['111111111', '222222222', '333333333'] && assertion.workflow_ref == assertion.repository + '/.github/workflows/codeman.yml@refs/heads/main'"
   printf %s "$CONDITION" | wc -c
   ```

3. **Test it on a provider of its own** (recommended). Create `github-test` in the same pool, with the new condition and the provider's mapping ([create-oidc](../web/google-cloud/gcloud-iam-workload-identity-pools-providers-create-oidc.md)):

   ```sh
   gcloud iam workload-identity-pools providers create-oidc github-test --project="$PROJECT_ID" \
     --location=global --workload-identity-pool=codeman --display-name="GitHub test" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.workflow_ref=assertion.workflow_ref" \
     --attribute-condition="$CONDITION"
   ```

   In a repository that is not in production use and that the new condition admits, add the repository variable `CODEMAN_WORKLOAD_IDENTITY_PROVIDER` with `projects/<project number>/locations/global/workloadIdentityPools/codeman/providers/github-test`; it overrides the organization's. Run Codeman by hand (**Actions → Codeman → Run workflow**) and check that `select` passes. Then delete that repository variable and the test provider: the service account's binding admits every provider of the pool, so `github-test` is a second way in while it exists. Its ID cannot be used again for 30 days ([delete a provider](../web/google-cloud/manage-workload-identity-pools-and-providers.md#delete-a-provider)).

   ```sh
   gcloud iam workload-identity-pools providers delete github-test --project="$PROJECT_ID" \
     --location=global --workload-identity-pool=codeman
   ```

4. **Apply it** to `github`:

   ```sh
   gcloud iam workload-identity-pools providers update-oidc github --project="$PROJECT_ID" \
     --location=global --workload-identity-pool=codeman --attribute-condition="$CONDITION"
   ```

   The condition may use only fields the mapping also maps ([attribute condition](../web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md#define-an-attribute-condition)). A provider created before `repository_id` was in the installation's mapping needs it to use the listed-repositories variant: pass the whole mapping of step 3 with `--attribute-mapping` in the same command.

5. **Check it.** Read the condition back (above), and run Codeman by hand in one repository the condition admits. A condition that admits too much fails nothing, so read it, not only the runs.
6. **Put the old one back** if a run fails:

   ```sh
   gcloud iam workload-identity-pools providers update-oidc github --project="$PROJECT_ID" \
     --location=global --workload-identity-pool=codeman --attribute-condition="$(cat condition-before.txt)"
   ```

**What a wrong condition does.** Every job that reaches the backend fails at the token exchange, in each repository the condition refuses: `select` first, before it marks any task, with `Google's STS refused the request with <status>: <error>`, where the error is what Google's Security Token Service answered ([`src/store/google.ts`](../../src/store/google.ts)). Google's audit logs do not record the refused exchange: the logs of token exchanges are Data Access logs, off by default, and they leave out failures caused by the request, such as invalid credentials ([example logs](../web/google-cloud/example-logs-for-workload-identity-federation.md#logs-for-exchanging-an-idp-token-for-a-federated-token)).

**Many repositories.** About 280 repository IDs of 10 digits fit in 4096 characters with the rest of the condition. Beyond that, add a second provider to the pool with the next IDs, created as in step 3 and kept, and set `CODEMAN_WORKLOAD_IDENTITY_PROVIDER` to it in the repositories it lists; or use the variant that admits any repository of the organization.

### Disable, delete or restore it

- **Disable.** A disabled provider exchanges no tokens, but the tokens it already issued still grant access; to stop those too, disable the pool ([update-oidc](../web/google-cloud/gcloud-iam-workload-identity-pools-providers-update-oidc.md)). Enable it again from its **Edit** icon in the console ([update a provider](../web/google-cloud/manage-workload-identity-pools-and-providers.md#update-a-provider)).

  ```sh
  gcloud iam workload-identity-pools providers update-oidc github --project="$PROJECT_ID" \
    --location=global --workload-identity-pool=codeman --disabled
  ```

- **Delete and restore.** As for the pool: Google advises disabling first, a deleted provider can be restored for 30 days, and its ID is not reusable until then ([delete a provider](../web/google-cloud/manage-workload-identity-pools-and-providers.md#delete-a-provider), [undelete a provider](../web/google-cloud/manage-workload-identity-pools-and-providers.md#undelete-a-provider)).

  ```sh
  gcloud iam workload-identity-pools providers delete github --project="$PROJECT_ID" \
    --location=global --workload-identity-pool=codeman
  gcloud iam workload-identity-pools providers undelete github --project="$PROJECT_ID" \
    --location=global --workload-identity-pool=codeman
  ```

## The service account

In the console, the **Service accounts** page (`https://console.cloud.google.com/iam-admin/serviceaccounts`) lists the project's service accounts ([delete a service account](../web/google-cloud/delete-and-undelete-service-accounts.md#delete-a-service-account)).

```sh
gcloud iam service-accounts list --project="$PROJECT_ID"
gcloud iam service-accounts describe "$SA" --project="$PROJECT_ID"
```

`describe` prints the account's numeric ID as `uniqueId`; restoring a deleted account takes that ID, so note it ([undelete](../web/google-cloud/delete-and-undelete-service-accounts.md#undelete-a-service-account)).

### Who may act as it

The account's own IAM policy says which identities may act as it. It should hold one binding: `roles/iam.workloadIdentityUser` for `principalSet://iam.googleapis.com/projects/<project number>/locations/global/workloadIdentityPools/codeman/*`, every identity of the pool ([get-iam-policy](../web/google-cloud/gcloud-iam-service-accounts-get-iam-policy.md)).

```sh
gcloud iam service-accounts get-iam-policy "$SA" --project="$PROJECT_ID"
```

Removing that binding cuts every job off from the backend, whatever the pool and provider say: the federated token can no longer get the account's token ([remove-iam-policy-binding](../web/google-cloud/gcloud-iam-service-accounts-remove-iam-policy-binding.md)). Step 6 of the installation adds it back ([add-iam-policy-binding](../web/google-cloud/gcloud-iam-service-accounts-add-iam-policy-binding.md)).

```sh
gcloud iam service-accounts remove-iam-policy-binding "$SA" --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/codeman/*"
```

### Its role on the project

The account holds one role on the project, Cloud Datastore User (`roles/datastore.user`), and nothing else. The project's policy lists who holds each role; in the console, it is in the IAM & Admin section. This prints the members that hold `roles/datastore.user`, which should be the service account alone ([filters](../web/google-cloud/gcloud-topic-filters.md), [get-iam-policy](../web/google-cloud/gcloud-projects-get-iam-policy.md)):

```sh
gcloud projects get-iam-policy "$PROJECT_ID" --flatten=bindings \
  --filter=bindings.role:roles/datastore.user --format='value(bindings.members)'
```

`gcloud projects get-iam-policy "$PROJECT_ID"` prints the whole policy. Removing the role stops Codeman's reads and writes, and every run fails in `select`; step 4 of the installation grants it again ([remove-iam-policy-binding](../web/google-cloud/gcloud-projects-remove-iam-policy-binding.md), [add-iam-policy-binding](../web/google-cloud/gcloud-projects-add-iam-policy-binding.md)).

```sh
gcloud projects remove-iam-policy-binding "$PROJECT_ID" --role=roles/datastore.user \
  --member="serviceAccount:$SA"
```

### Delete and restore it

Deleting the account stops the backend for every repository. A deleted account can be restored for 30 days, by its numeric ID, with its roles: its bindings stay in the policies, shown as `deleted:serviceAccount:<email>?uid=<numeric ID>`, for up to 60 days. A new account with the same name is another identity: it holds none of the old one's roles until steps 4 and 6 of the installation grant them again, and while it exists the old one cannot be restored ([delete](../web/google-cloud/delete-and-undelete-service-accounts.md#delete-a-service-account), [undelete](../web/google-cloud/delete-and-undelete-service-accounts.md#undelete-a-service-account)).

```sh
gcloud iam service-accounts delete "$SA" --project="$PROJECT_ID"
gcloud iam service-accounts undelete <numeric ID> --project="$PROJECT_ID"
```

A deleted account's numeric ID is also in the bindings above, after `?uid=`, and in the audit log of its deletion ([find the numeric ID](../web/google-cloud/delete-and-undelete-service-accounts.md#find-a-deleted-service-accounts-numeric-id)).

## The APIs

```sh
gcloud services list --enabled --project="$PROJECT_ID"
```

The list includes `iam.googleapis.com`, `sts.googleapis.com` and `iamcredentials.googleapis.com`, which step 4 of the installation enabled and the token exchange uses ([services list](../web/google-cloud/gcloud-services-list.md)). Keep them enabled.

## Firestore

The Firebase console and `gcloud` cover it; the Firebase CLI is not needed.

- **Rules.** In the [Firebase console](https://console.firebase.google.com), the project's **Databases & Storage → Firestore → Rules** tab shows the published rules; edit them there and **Publish** ([security rules](../web/firebase/get-started-with-cloud-firestore-security-rules.md#use-the-firebase-console), [manage rules](../web/firebase/manage-and-deploy-firebase-security-rules.md#use-the-firebase-console)). They should be [`firebase/firestore.rules`](../../firebase/firestore.rules), which deny every client; Codeman's service account does not go through them, so Codeman never needs them changed.
- **Data.** The **Data** tab shows the documents; [data layout](../backend/data-layout.md) says what each is.
- **The database.** In the Google Cloud console, the **Databases** page (`https://console.cloud.google.com/firestore/databases`) lists it. `gcloud` prints its details, and turns on delete protection, which blocks deleting it until it is turned off ([manage databases](../web/firebase/manage-databases.md#view-database-details), [delete protection](../web/firebase/manage-databases.md#update-the-delete-protection-setting)):

  ```sh
  gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID"
  gcloud firestore databases update --database='(default)' --delete-protection --project="$PROJECT_ID"
  ```

- **Delete.** Deleting the database deletes Codeman's records: the ledger the budgets read, the pod registry and the board of a pool; every run fails in `select` until a new one exists. With delete protection, turn it off first (`--no-delete-protection`). In the Firebase console, **Databases & Storage → Firestore → Data**, the menu above the data table, **Delete database**; or the command below ([delete a database](../web/firebase/manage-databases.md#delete-a-database)). Google's page documents no way to restore a deleted database.

  ```sh
  gcloud firestore databases delete --database='(default)' --project="$PROJECT_ID"
  ```

## Who changed what

Cloud Audit Logs' **Admin Activity** logs record every change to the pool, the provider, the service account and the project's policy: they are always written and cannot be turned off, and they record the caller's email for every write ([Cloud Audit Logs](../web/google-cloud/cloud-audit-logs-overview.md#admin-activity-audit-logs), [caller identities](../web/google-cloud/cloud-audit-logs-overview.md#caller-identities-in-audit-logs)). Changes to pools and providers are long-running operations, which usually write two entries, at the start and at the end ([IAM audit logging](../web/google-cloud/identity-and-access-management-audit-logging.md)).

In the console, the **Logs Explorer** page (`https://console.cloud.google.com/logs/query`), with the project selected, runs a query; for the pool and the provider ([viewing audit logs](../web/google-cloud/cloud-audit-logs-overview.md#viewing-audit-logs)):

```
log_id("cloudaudit.googleapis.com/activity")
protoPayload.methodName:"WorkloadIdentityPools"
```

With `gcloud`, the last 30 days, with when, what and who ([logging read](../web/google-cloud/gcloud-logging-read.md)):

```sh
gcloud logging read 'log_id("cloudaudit.googleapis.com/activity") AND protoPayload.methodName:"WorkloadIdentityPools"' \
  --project="$PROJECT_ID" --freshness=30d \
  --format='table(timestamp, protoPayload.methodName, protoPayload.authenticationInfo.principalEmail)'
```

Other filters, in place of the second term:

| Changes to | Filter |
| --- | --- |
| The service account, its policy included | `resource.type="service_account" AND resource.labels.email_id="codeman@<project ID>.iam.gserviceaccount.com"` ([undelete](../web/google-cloud/delete-and-undelete-service-accounts.md#find-a-deleted-service-accounts-numeric-id)) |
| The project's policy, and the project | `protoPayload.serviceName="cloudresourcemanager.googleapis.com"` ([Resource Manager](../web/google-cloud/resource-manager-audit-logging.md#service-name)) |
| Everything of IAM | `protoPayload.serviceName="iam.googleapis.com"` ([IAM audit logging](../web/google-cloud/identity-and-access-management-audit-logging.md)) |
