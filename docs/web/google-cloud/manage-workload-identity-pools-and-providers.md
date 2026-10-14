---
title: Manage workload identity pools and providers
url: https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Manage workload identity pools and providers

This page explains how to manage your existing
[workload identity pools](https://docs.cloud.google.com/iam/docs/workload-identity-federation) and their identity
providers (IdPs) for Workload Identity Federation.

You can manage pools and providers using the Google Cloud console, the
[Google Cloud CLI](https://docs.cloud.google.com/sdk/gcloud), or the [REST API](https://docs.cloud.google.com/iam/docs/reference/rest).

## Before you begin

Create a workload identity pool. For instructions, see the [Workload Identity Federation configuration guides](https://docs.cloud.google.com/iam/docs/workload-identity-federation#providers).

### Required roles


To get the permissions that
you need to manage workload identity pools and providers,

ask your administrator to grant you the
following IAM roles on the project:

- To view pools and providers: [IAM Workload Identity Pool Viewer](https://docs.cloud.google.com/iam/docs/roles-permissions/iam#iam.workloadIdentityPoolViewer) (`roles/iam.workloadIdentityPoolViewer`)
- To view, create, update, and delete pools and providers: [IAM Workload Identity Pool Admin](https://docs.cloud.google.com/iam/docs/roles-permissions/iam#iam.workloadIdentityPoolAdmin) (`roles/iam.workloadIdentityPoolAdmin`)


For more information about granting roles, see [Manage access to projects, folders, and organizations](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access).


These predefined roles contain

the permissions required to manage workload identity pools and providers. To see the exact permissions that are
required, expand the **Required permissions** section:


#### Required permissions

The following permissions are required to manage workload identity pools and providers:

- To view workload identity pools and providers:
  - `iam.googleapis.com/workloadIdentityPoolProviders.get`
  - `iam.googleapis.com/workloadIdentityPoolProviders.list`
  - `iam.googleapis.com/workloadIdentityPools.get`
  - `iam.googleapis.com/workloadIdentityPools.list`
- To create, update, and delete pools and providers:
  - `iam.googleapis.com/workloadIdentityPoolProviders.create`
  - `iam.googleapis.com/workloadIdentityPoolProviders.delete`
  - `iam.googleapis.com/workloadIdentityPoolProviders.undelete`
  - `iam.googleapis.com/workloadIdentityPoolProviders.update`
  - `iam.googleapis.com/workloadIdentityPools.create`
  - `iam.googleapis.com/workloadIdentityPools.delete`
  - `iam.googleapis.com/workloadIdentityPools.undelete`
  - `iam.googleapis.com/workloadIdentityPools.update`


You might also be able to get
these permissions
with [custom roles](https://docs.cloud.google.com/iam/docs/creating-custom-roles) or
other [predefined roles](https://docs.cloud.google.com/iam/docs/roles-overview#predefined).

## Manage workload identity pools

This section shows you how to manage workload identity pools.

### Create pools

To create workload identity pools in a project, do the following:

> [!NOTE]
> **Note:** The prefix `gcp-` is reserved and can't be used in a pool or provider ID.

### Console

1.
   In the Google Cloud console, go to the **New workload provider and
   pool** page.


   [Go to New workload provider and pool](https://console.cloud.google.com/iam-admin/workload-identity-pools/create)
2.
   In the **Create an identity pool** section, enter a name for the pool.


   The Google Cloud console uses the name to create a pool ID. To change
   the pool ID, click **Edit**. You can't change the pool ID later.
3. Optional: In the **Description** field, enter a description for the pool.
4. Optional: To create the pool in a disabled state, click the **Enabled
   pool** toggle.
5. Click **Continue**.
6. In the **Add a provider to pool** and **Configure provider
   attributes** sections, configure an identity provider for the pool. For instructions, see [Create a provider](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers#create-provider).
7. Click **Save**.

### gcloud

Execute the [`gcloud iam workload-identity-pools create`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/create)
command.

### REST

Call [`projects.locations.workloadIdentityPools.create()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools/create).

### List pools

To list all the workload identity pools in a project, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. In the table, view the list of workload identity pools.
3. Optional: To include deleted pools and providers in the list, click the **Show deleted pools and providers** toggle.

### gcloud

Execute the [`gcloud iam workload-identity-pools list`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/list)
command.

### REST

Call [`projects.locations.workloadIdentityPools.list()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools/list).

### Get a pool

To get details for a specific workload identity pool, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that you want to view, and then click its display name. The Google Cloud console shows details about the workload identity pool.

### gcloud

Execute the
[`gcloud iam workload-identity-pools describe`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/describe) command.

### REST

Call [`projects.locations.workloadIdentityPools.get()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools/get).

### Update a pool

You can enable or disable a workload identity pool. You can also change its
display name or description.

To update an existing workload identity pool, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that you want to edit.
3. Click the workload identity pool's display name.
4.
   To edit the workload identity pool's display name, do the following:

   1. In the **Pool details** page, next to the display name, click the **Edit** icon.
   2. In the **Edit pool display name** dialog that appears, update the display name.
   3. Click **Save**.
5. To disable or enable the workload identity pool, click the **Status** toggle, then click **Disable** or **Enable**.
6. To edit the description, do the following:

   1. In **Description** , next to your description text, click **Edit**.
   2. Update the description.
   3. Click **Save**.

### gcloud

Execute the [`gcloud iam workload-identity-pools update`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/update)
command.

### REST

Call [`projects.locations.workloadIdentityPools.patch()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools/patch).

### Delete a pool

When you delete a workload identity pool, you also delete its workload identity
pool providers. As a result, the identities in the pool lose access to
Google Cloud resources.

> [!CAUTION]
> **Caution:** Before you delete a workload identity pool, consider [disabling the pool](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers#update-pool) or [disabling its IdPs](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers#update-provider). If one of your workloads loses access to Google Cloud resources as a result, you can re-enable the pool and its providers at any time. If your workloads don't lose access, then it is safe to delete the pool.

You can [undelete a pool](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers#undelete-pool) for up to
30 days after you delete it. After
30 days, the deletion is permanent. Until a
pool is permanently deleted, you cannot reuse its name when creating a new
workload identity pool.

To delete a workload identity pool and its IdPs, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that you want to delete, and then click its display name.
3. Click **Delete pool** , then click **Delete**. The workload identity pool and its IdPs are deleted.

### gcloud

Execute the [`gcloud iam workload-identity-pools delete`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/delete)
command.

### REST

Call [`projects.locations.workloadIdentityPools.delete()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools/delete).

### Undelete a pool

You can recover a deleted workload identity pool for up to 30 days after
deletion.

To undelete a pool, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Click the **Show deleted pools and providers** toggle.
3. Find the workload identity pool that you want to undelete, then click its **Restore** icon.
4. Click **Restore**. The pool and its providers are restored.

### gcloud

Execute the
[`gcloud iam workload-identity-pools undelete`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/undelete) command.

### REST

Call [`projects.locations.workloadIdentityPools.undelete()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools/undelete).

## Manage workload identity pool providers

This section shows you how to manage workload identity pool providers.

### Create a provider

To create a workload identity pool provider in an existing workload identity
pool, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that you want to add a provider to, and then click its **Display name**.
3. Click **Add provider**.
4. Select the type of provider to create:

   - **AWS**: An Amazon Web Services (AWS) IdP.
   - **OpenID Connect (OIDC)**: An OIDC-compatible IdP. This includes Microsoft Azure.
5. Enter a name for the provider.


   The Google Cloud console uses the name to create a provider ID. To
   change the provider ID, click **Edit**. You can't change the provider
   ID later.
6. Complete the remaining fields for your provider:

   - **AWS**: Enter your AWS account ID.
   - **OIDC** : Enter the issuer URL. For Azure, the issuer URL uses the format `https://sts.windows.net/AZURE_TENANT_ID`. For other providers, consult the provider's documentation.

   When you are done, click **Continue**.
7.
   To configure the attribute mapping, click **Edit mapping**. Attribute
   mapping lets you use information about external identities to grant access
   to a subset of those identities.

   - **AWS**: This step is optional. You can use the default mapping.


     For details, see
     [Identity provider settings for AWS and Azure](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds#mappings-and-conditions).
   -
     **OIDC** : We recommend mapping `google.subject` to
     `assertion.sub`. Other mappings are optional.


     For details, see IdP settings for
     [Azure](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds#mappings-and-conditions)
     or
     [other OIDC providers](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers#mappings-and-conditions).
8. Optional: To provide an attribute condition, which specifies the identities that can authenticate, click **Add condition** and enter a valid Common Expression Language (CEL) expression. For details, see [Attribute conditions](https://docs.cloud.google.com/iam/docs/workload-identity-federation#conditions).
9. Click **Save**. The workload identity pool provider is created.

### gcloud

Execute the
[`gcloud iam workload-identity-pools providers create-aws`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/create-aws)
command to create an AWS provider.

Execute the
[`gcloud iam workload-identity-pools providers create-oidc`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/create-oidc)
command to create an OIDC provider. This includes Microsoft Azure.

### REST

Call [`projects.locations.workloadIdentityPools.providers.create()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/create).

### List providers

To list the workload identity pool providers in a project, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. To view the providers for a workload identity pool, click the **Expand node** icon for the pool.

### gcloud

Execute the
[`gcloud iam workload-identity-pools providers list`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/list)
command.

### REST

Call [`projects.locations.workloadIdentityPools.providers.list()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/list).

### Get a provider

To get details for a specific workload identity pool provider, do the following:

### Console

1.
   In the Google Cloud console, go to the **Workload Identity Pools**
   page.


   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that contains the provider, then click the **Expand node** icon for the pool.
3. Find the workload identity pool provider that you want to view, then click its **Edit** icon. The Google Cloud console shows detailed information about the provider.

### gcloud

Execute the
[`gcloud iam workload-identity-pools providers describe`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/describe)
command.

### REST

Call [`projects.locations.workloadIdentityPools.providers.get()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/get).

### Update a provider

You can enable or disable a workload identity pool provider. You can also update
its account information and its attribute mapping, as well as its display name
and description.

To update an existing workload identity pool provider, do the following:

### Console

1. In the Google Cloud console, go to the **Workload Identity Pools** page.

   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that contains the provider, then click the
   **Expand node** icon for the
   pool.

3. Find the workload identity pool provider that you want to edit, then click
   its **Edit** icon.

4. Edit the provider's information, then click **Save**.

### gcloud

Execute the
[`gcloud iam workload-identity-pools providers update-aws`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/update-aws)
command to update an AWS provider.

Execute the
[`gcloud iam workload-identity-pools providers update-oidc`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/update-oidc)
command to update an OIDC provider. This includes Microsoft Azure.

### REST

Call [`projects.locations.workloadIdentityPools.providers.patch()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/patch).

### Delete a provider

When you delete a workload identity pool provider, the provider's identities
lose access to Google Cloud resources.

> [!CAUTION]
> **Caution:** Before you delete a workload identity pool provider, consider [disabling the provider](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers#update-provider). If one of your workloads loses access to Google Cloud resources as a result, you can re-enable the provider at any time. If your workloads don't lose access, then it is safe to delete the provider.

You can [undelete a provider](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers#undelete-provider) for up to
30 days after you delete it. After
30 days, the deletion is permanent.
Until a provider is permanently deleted, you cannot reuse its name when creating
a new provider.

To delete a workload identity pool provider, do the following:

### Console

1. In the Google Cloud console, go to the **Workload Identity Pools** page.

   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that contains the provider, and then click
   its **Display name**.

3. In the **Providers** pane, find the provider that you want to delete, then
   click its **Delete** icon.

4. Click **Delete** to delete the provider.

### gcloud

Execute the
[`gcloud iam workload-identity-pools providers delete`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/delete)
command.

### REST

Call [`projects.locations.workloadIdentityPools.providers.delete()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/delete).

### Undelete a provider

You can recover a deleted workload identity pool provider for up to
30 days after you delete it. To undelete a provider, follow these steps:

### Console

1. In the Google Cloud console, go to the **Workload Identity Pools** page.

   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Click the **Show deleted pools and providers** toggle.

3. Find the workload identity pool that contains the provider, then click the
   **Expand node** icon for the
   pool.

4. Find the provider that you want to undelete, then click its
   **Restore** icon.

5. Click **Restore**. The provider is restored.

### gcloud

Execute the
[`gcloud iam workload-identity-pools providers undelete`](https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/providers/undelete)
command.

### REST

Call [`projects.locations.workloadIdentityPools.providers.undelete()`](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/undelete).

## Manage constraints for Workload Identity Federation

You can use [organization policy constraints](https://docs.cloud.google.com/resource-manager/docs/organization-policy/overview#constraints) to
restrict how resources in your Google Cloud organization can be used.

This section describes constraints that are recommended when you use
Workload Identity Federation.

### Manage allowed IdPs

As an organization administrator, you can decide which IdPs your
organization is allowed to federate with.

To manage which IdPs are allowed, enable the
`constraints/iam.workloadIdentityPoolProviders` list constraint in the
organization policy for your organization. This constraint specifies the issuer
URIs of the allowed providers. You can use the
[Google Cloud console](https://docs.cloud.google.com/resource-manager/docs/organization-policy/creating-managing-policies#list_constraints) or the
[Google Cloud CLI](https://docs.cloud.google.com/resource-manager/docs/organization-policy/using-constraints#list-constraint) to enable this constraint.

> [!NOTE]
> **Note:** This constraint only limits creating and updating IdPs. If an IdP was configured before you enabled the constraint, that provider can still be used.

To only allow federation from AWS, create a single constraint with the URI
`https://sts.amazonaws.com`. The following example shows how to create this
constraint using the gcloud CLI:

```bash
gcloud resource-manager org-policies allow constraints/iam.workloadIdentityPoolProviders \
     https://sts.amazonaws.com --organization=ORGANIZATION_NUMBER
```

You can also specify which AWS account IDs have access to your
Google Cloud resources. To specify the account IDs, use the
`constraints/iam.workloadIdentityPoolAwsAccounts` list constraint:

```bash
gcloud resource-manager org-policies allow constraints/iam.workloadIdentityPoolAwsAccounts \
    ACCOUNT_ID --organization=ORGANIZATION_NUMBER
```

To only allow federation from one OIDC provider, create a single constraint with
the `issuer_uri` of the allowed provider. For example, the following only allows
federation from a specific Azure tenant:

```bash
gcloud resource-manager org-policies allow constraints/iam.workloadIdentityPoolProviders \
     https://sts.windows.net/AZURE_TENANT_ID --organization=ORGANIZATION_NUMBER
```

Federation from a SAML IdP is special because the public keys that
are used to validate the assertion are provided when the SAML IdP
is configured. As a result, it's possible that a malicious user might try to
upload a SAML metadata document with the entity ID of your organization's
IdP using a public key. Restricting federation using an entity ID
in this scenario gives only an illusion of security.

To mitigate this risk, we strongly advise that you only allow a workload
identity pool to be created with SAML federation in a Google Cloud project
that your organization centrally manages. Then, as needed, grant external
identities in that workload identity pool access to resources across your
organization.

To allow federation from SAML IdPs, create a constraint
allowing the special keyword `KEY_UPLOAD`.

```bash
gcloud resource-manager org-policies allow constraints/iam.workloadIdentityPoolProviders \
     KEY_UPLOAD --organization=ORGANIZATION_NUMBER
```

You can repeat these commands to allow federation from additional providers.

To block federation from all providers:

1. Create a YAML file containing the following:

   ```yaml
   constraint: constraints/iam.workloadIdentityPoolProviders
   listPolicy:
     allValues: DENY
   ```
2. Pass the file to the [`gcloud resource-manager org-policies set-policy`](https://docs.cloud.google.com/sdk/gcloud/reference/resource-manager/org-policies/set-policy)
   command:

   ```bash
   gcloud resource-manager org-policies set-policy FILE_NAME.yaml \
       --organization=ORGANIZATION_NUMBER
   ```

### Restrict service account key creation

Workload Identity Federation lets you access Google Cloud resources from
outside of Google Cloud without using a service account key. If you never
use service account keys to authenticate, you can help reduce risk by disabling
key creation.

To disable the creation of service account keys, enforce the
`iam.disableServiceAccountKeyCreation` boolean constraint in the organization
policy for your organization. You can also enforce the
`iam.disableServiceAccountKeyUpload` boolean constraint, which disables
uploading of public keys for service accounts.


> [!NOTE]
> **Note**: If your organization was created on or after May 3, 2024, these constraints are enforced by default.

<br />

You can use the
[Google Cloud console](https://docs.cloud.google.com/resource-manager/docs/organization-policy/creating-managing-policies#boolean_constraints) or the
[gcloud CLI](https://docs.cloud.google.com/resource-manager/docs/organization-policy/using-constraints#boolean-constraint) to enable these
constraints. For example, the following gcloud CLI commands enable
both constraints:

```bash
gcloud resource-manager org-policies enable-enforce \
    constraints/iam.disableServiceAccountKeyCreation \
    --organization=ORGANIZATION_NUMBER
gcloud resource-manager org-policies enable-enforce \
    constraints/iam.disableServiceAccountKeyUpload \
    --organization=ORGANIZATION_NUMBER
```

## Monitor Workload Identity Federation

You can use [Cloud Monitoring](https://docs.cloud.google.com/monitoring/docs) metrics to monitor authentication
events for your workload identity pools and providers. For a list of available
metrics, see [IAM metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_i_o#gcp-iam).

## What's next

Learn more about [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation).