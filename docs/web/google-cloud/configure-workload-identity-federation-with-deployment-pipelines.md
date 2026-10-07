---
title: Configure Workload Identity Federation with deployment pipelines
url: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
created_at: 2026-10-07T15:14:00-03:00
updated_at: 2026-10-07T15:14:00-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Configure Workload Identity Federation with deployment pipelines

This guide describes how to use Workload Identity Federation to let deployment
pipelines authenticate to Google Cloud.

Depending on the CI/CD system you're using, your deployment pipelines might have
access to ambient, environment-specific credentials. For example:

- Azure DevOps pipelines can use a [Microsoft Entra workload identity federation service connection](https://learn.microsoft.com/en-au/azure/devops/pipelines/library/connect-to-azure?view=azure-devops#create-an-azure-resource-manager-service-connection-that-uses-workload-identity-federation) to obtain an ID token that uniquely identifies the Azure DevOps project.
- GitHub Actions workflows can obtain a [GitHub OIDC token](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) that uniquely identifies the workflow and its repository.
- GitLab SaaS lets CI/CD jobs access an [ID token](https://docs.gitlab.com/ee/ci/secrets/id_token_authentication.html) that uniquely identifies the job and its project, environment, and repository.
- HCP Terraform can provide an [OIDC token](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/workload-identity-tokens) to your Terraform configuration that uniquely identifies the workspace and environment.

You can configure your deployment pipelines to use these credentials to authenticate to
Google Cloud by using Workload Identity Federation. This approach
eliminates the maintenance and security burden associated with
[service account keys](https://docs.cloud.google.com/iam/docs/service-account-creds#key-types).

## Before you begin

### Set up authentication


Select the tab for how you plan to use the samples on this page:

### Console


When you use the Google Cloud console to access Google Cloud services and
APIs, you don't need to set up authentication.

### gcloud

In the Google Cloud console, activate Cloud Shell.

[Activate Cloud Shell](https://console.cloud.google.com/?cloudshell=true)


At the bottom of the Google Cloud console, a
[Cloud Shell](https://docs.cloud.google.com/shell/docs/how-cloud-shell-works)
session starts and displays a command-line prompt. Cloud Shell is a shell environment
with the Google Cloud CLI
already installed and with values already set for
your current project. It can take a few seconds for the session to initialize.

### Python


To use the Python samples on this page in a local development environment, install and
initialize the gcloud CLI, and then set up Application Default Credentials with
your user credentials.

1.
   [Install](https://docs.cloud.google.com/sdk/docs/install) the Google Cloud CLI.

2. If you're using an external identity provider (IdP), you must first
   [sign in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).

3.

   If you're using a local shell, then create local authentication credentials for your user
   account:

   ```bash
   gcloud auth application-default login
   ```

   You don't need to do this if you're using Cloud Shell.


   If an authentication error is returned, and you are using an external identity provider
   (IdP), confirm that you have
   [signed in to the gcloud CLI with your federated identity](https://docs.cloud.google.com/iam/docs/workforce-log-in-gcloud).


For more information, see
[Set up ADC for a local development environment](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
in the Google Cloud authentication documentation.

<br />

### Required roles

<br />


To get the permissions that
you need to configure Workload Identity Federation,

ask your administrator to grant you the
[Workload Identity Pool Admin](https://docs.cloud.google.com/iam/docs/roles-permissions/iam#iam.workloadIdentityPoolAdmin) (`roles/iam.workloadIdentityPoolAdmin`) IAM role on the project.


For more information about granting roles, see [Manage access to projects, folders, and organizations](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access).


You might also be able to get
the required permissions through [custom
roles](https://docs.cloud.google.com/iam/docs/creating-custom-roles) or other [predefined
roles](https://docs.cloud.google.com/iam/docs/roles-overview#predefined).

Alternatively, the IAM Owner (`roles/owner`) basic role also
includes permissions to configure identity federation.

You should not grant basic roles in a production environment, but you can grant them in a
development or test environment.

<br />

## Prepare your external IdP

### Azure DevOps

To let an Azure DevOps pipeline authenticate to Google Cloud, you first
configure a service connection for Azure Resource Manager. This connection
lets the pipeline obtain an ID token, which it can then exchange for
Google Cloud credentials.

To create a service connection for Azure Resource Manager, do the following:

1. In Azure DevOps, open your project and go to **Project Settings**.
2. Go to **Pipelines \> Service connections**.
3. Click **Create service connection**.
4. Select **Azure Resource Manager**.
5. Click **Next**.
6. Configure the following settings:

   - **Identity type** : **App registration (automatic)**
   - **Credential** : **Workload identity federation**
   - **Scope level** : **Subscription**.

     You must select a subscription even if you're not planning to use
     the service connection to access Azure resources.
   - **Service connection name** : Enter a name such as `google-cloud`.

7. Click **Save**.

8. In **Workload Identity federation details**, find the following identifiers:

   - **Issuer**: uniquely identifies your Azure DevOps organization
   - **Subject identifier**: uniquely identifies the service connection

   Save these identifiers for one of the next steps.

Azure DevOps automatically grants the service connection's service principal
access to the Azure subscription that you selected. We recommend that you
reduce this access by doing the following:

1. Click **Manage service connection roles**.
2. Click **Role assignments**.
3. Find the role assignment for the service connection and remove it or replace it with a role assignment that uses a less-privileged role.

### GitHub Actions

You don't need to make any configuration changes in your GitHub account.

After you [configure](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#configure) a workload identity pool to trust your
GitHub repository, you can let workflows in that repository use their
GitHub OIDC token to obtain short-lived Google Cloud credentials.

### GitLab SaaS

You don't need to make any configuration changes in your GitLab account.

After you [configure](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#configure) a workload identity pool to trust
your GitLab group, you can enable Workload Identity Federation for individual
CI/CD jobs.

### HCP Terraform

You don't need to make any configuration changes in your HCP Terraform
account.

After you [configure](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#configure) a workload identity pool to trust HCP
Terraform, you can enable Workload Identity Federation for individual
workspaces.

## Configure Workload Identity Federation

Perform these steps for each Azure DevOps project, GitHub organization,
GitLab group, or HCP Terraform organization.

To start configuring Workload Identity Federation, do the following:

1. In the Google Cloud console, on the project selector page,
   select or create a Google Cloud project.

   **Roles required to select or create a project**
   - **Select a project**: Selecting a project doesn't require a specific IAM role---you can select any project that you've been granted a role on.
   - **Create a project** : To create a project, you need the Project Creator role (`roles/resourcemanager.projectCreator`), which contains the `resourcemanager.projects.create` permission. [Learn how to grant
     roles](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access).

   [Go to project selector](https://console.cloud.google.com/projectselector2/home/dashboard)
It's best to [use a dedicated project to manage workload identity pools and providers](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation#dedicated-project).
2.
   [Verify that billing is enabled for your Google Cloud project](https://docs.cloud.google.com/billing/docs/how-to/verify-billing-enabled#confirm_billing_is_enabled_on_a_project).

3. Enable the IAM, Resource Manager, Service Account Credentials, and Security Token Service APIs, if any are not already enabled.
**Roles required to enable APIs**


To enable APIs, you need the `serviceusage.services.enable` permission. If you
created the project, then you likely already have this permission through the
Owner role (`roles/owner`). Otherwise, you can get this permission through the
Service Usage Admin role (`roles/serviceusage.serviceUsageAdmin`).
[Learn how to grant roles](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access).
4. [Enable the APIs](https://console.cloud.google.com/apis/enableflow?apiid=iam.googleapis.com,cloudresourcemanager.googleapis.com,iamcredentials.googleapis.com,sts.googleapis.com&redirect=https://console.cloud.google.com)

### Define an attribute mapping

The environment-specific credentials of your deployment pipeline can contain multiple attributes,
and you must decide which attribute you want to use as subject identifier
(`google.subject`) in Google Cloud.

Optionally, you can [map additional attributes](https://docs.cloud.google.com/iam/docs/workload-identity-federation#mapping).
You can then refer to these additional attributes when you grant access to
resources.

### Azure DevOps

The Azure DevOps ID token includes a `sub` claim that contains the subject
identifier of your service connection. The subject identifier follows this format:

```
PREFIX/sc/SERVICE_CONNECTION
```

The length of this subject identifier exceeds 127 characters, which is the
maximum permitted length for `google.subject`. To work around this limitation,
use the following attribute mapping:

```
google.subject=assertion.sub.split('/sc/')[1]
```

This mapping uses the part of the `sub` claim following `/sc/`
as the subject, which uniquely identifies the service connection. When you grant
roles to the external identity, use the part of the **Subject identifier** that follows
`/sc/` (as shown in your service connection details) as the subject.

### GitHub Actions

Your attribute mappings can use any of the [claims in the GitHub Actions
OIDC token](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#understanding-the-oidc-token). These token claim keys and their values are controlled by
GitHub. At minimum, you should map `google.subject` to `assertion.sub`,
which corresponds to the GitHub Actions OIDC token subject:

```
google.subject=assertion.sub
```

The value for the GitHub Actions OIDC token subject [can vary depending on the
source
event](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#example-subject-claims). Other claim attributes can include:

- `repository`: Contains the owner and repository name--for example
  `"google/guava"`.

- `repository_id`: Contains the unique repository ID--for example
  `"20300177"`.

- `repository_owner`: Contains the owner, which can be a username or the
  name of a GitHub organization--for example `"google"`.

- `repository_owner_id`: Contains the unique owner ID--for example
  `"1342004"`.

This list is a subset of the possible claims--see the GitHub
documentation on [example
claims](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect#understanding-the-oidc-token) for a complete list. Be sure to map any claims that you
plan to use as attribute conditions or as part of a future `principalSet`
condition.

> [!IMPORTANT]
> **Important:** Using "name" fields like `repository` and `repository_owner` increases the chances of [cybersquatting](https://en.wikipedia.org/wiki/Cybersquatting) and [typosquatting](https://en.wikipedia.org/wiki/Typosquatting) attacks. If you delete your GitHub repository or GitHub organization, someone may be able to claim that same *name* and establish an identity. To protect against this situation, use the numeric `*_id` fields instead, which are unique and can't be reused.

### GitLab SaaS

Your attribute mappings can use the [claims embedded in the GitLab ID token](https://docs.gitlab.com/ee/ci/secrets/id_token_authentication.html#token-payload)
as source attributes, including the following:

- `sub`: the project name and Git reference---for example, `project_path:groupname/projectname:ref_type:branch:ref:main`.
- `namespace_id`: the unique group ID.
- `project_id`: the unique project ID.
- `user_id`: the unique user ID.
- `environment`: the environment that the job applies to.
- `ref_path`: the Git reference---for example `refs/heads/main`.

The following attribute mapping sets `google.subject` to the `sub` claim
from the GitLab ID token. Because the `sub` claim contains
both the project name and Git reference, this mapping lets you control access
by repository and branch:

```
google.subject=assertion.sub
```

Controlling access by repository and branch can be useful if certain branches
(for example, `main`) need different access to resources than other
branches (for example, feature branches).

In some cases, it might be sufficient to only differentiate access by project
or group. The following mapping therefore includes two additional attributes
that contain the GitLab `project_id` and `namespace_id`:

```
google.subject=assertion.sub
attribute.project_id=assertion.project_id
attribute.namespace_id=assertion.namespace_id
```

### HCP Terraform

Your attribute mappings can use the claims embedded in the HCP Terraform
OIDC token, including the following

- `terraform_organization_id`: Contains the unique ID of the organization---for example `org-xxxxxxxxxxxxxxxx`.
- `terraform_workspace_id`: Contains the [unique ID of the workspace](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/settings#id)---for example `ws-xxxxxxxxxxxxxxxx`.
- `terraform_workspace_name`: Contains the [display name of the workspace](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/settings#name).
- `sub`: Contains the display name of the organization, workspace, and phase---for example `organization:example-org:workspace:example-workspace:run_phase:apply`.

The following attribute mapping sets `google.subject` to the
`terraform_workspace_id` claim from the HCP Terraform OIDC token:

```
google.subject=assertion.terraform_workspace_id
```

This mapping lets you control access to Google Cloud resources by workspace.

### Define an attribute condition

[Attribute conditions](https://docs.cloud.google.com/iam/docs/workload-identity-federation#conditions) are
CEL expressions that can check assertion attributes and target attributes. If
the attribute condition evaluates to `true` for a given credential, the
credential is accepted. Otherwise, the credential is rejected. You must have an
attribute mapping for all attribute condition fields.

> [!WARNING]
> **Warning:** GitHub, GitLab SaaS, and HCP Terraform use a single issuer URL across all organizations and some of the claims embedded in OIDC tokens might not be unique to your organization. To help protect against [spoofing threats](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation#protecting_against_spoofing_threats), you must use an attribute condition that restricts access to tokens issued by your GitHub organization, GitLab group, or HCP Terraform organization.

### Azure DevOps

To restrict access to your Azure DevOps application (service principal), use
the following attribute condition:

```
assertion.oid=='APPLICATION_OBJECT_ID'
```

Replace `APPLICATION_OBJECT_ID` with the Entra object ID of
the Azure DevOps application.

### GitHub Actions

Use the following attribute condition to restrict access to tokens issued by your
GitHub organization:

```
assertion.repository_owner=='ORGANIZATION'
```

Replace `ORGANIZATION` with the name of your GitHub
organization.

Optionally, extend the attribute condition to restrict access to a subset of workflows
or branches. For example, the following condition limits access
to workflows that use the Git branch `main`:

```
assertion.repository_owner=='ORGANIZATION' && assertion.ref=='refs/heads/main'
```

### GitLab SaaS

Use the following attribute condition to restrict access to tokens issued by your
GitLab [group](https://docs.gitlab.com/ee/user/namespace/)

```
assertion.namespace_id=='GROUP_ID'
```

Replace `GROUP_ID` with the group ID that's shown on
your GitLab group's home page.

Optionally, extend the attribute condition to restrict access to a subset of
projects, branches, or environments. For example, the following condition limits access
to jobs that use the environment `production`:

```
assertion.namespace_id=='GROUP_ID' && assertion.environment=='production'
```

### HCP Terraform

Use the following attribute condition to restrict access to tokens issued by
your HCP Terraform organization:

```
assertion.terraform_organization_id=='ORGANIZATION_ID'
```

Replace `ORGANIZATION_ID` with the unique ID of your
organization---for example `org-xxxxxxxxxxxxxxxx`.
Optionally, extend the attribute condition to restrict access to a subset of workflows
or branches. For example, the following attribute condition limits access
to a specific workspace:

```
assertion.terraform_organization_id=='ORGANIZATION_ID' && assertion.terraform_workspace_id=='WORKSPACE_ID'
```

### Create the workload identity pool and provider

You've now collected all the information you need to create a workload identity
pool and provider:

### Console

1. In the Google Cloud console, go to the **New workload provider and pool**
   page.

   [Go to New workload provider and pool](https://console.cloud.google.com/iam-admin/workload-identity-pools/create)
2. Under **Create an identity pool**, enter the following:

   - **Name**: Name for the pool. The name is also used as the pool ID. You can't change the pool ID later.
   - **Description**: Text that describes the purpose of the pool.
3. Click **Continue**.

4. Configure provider settings:

   ### Azure DevOps

   - **Select a provider** : **OpenID Connect (OIDC)**.
   - **Provider name**: the name of the Azure DevOps project, or a custom name.
   - **Provider ID**: the name of the Azure DevOps project, or a custom ID. You cannot change the provider ID later.
   - **Issuer URL** : the service connection issuer that [you've looked up previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#prepare).
   - **Audiences** : Select **Allowed audiences** and enter the following value:

     ```
     fb60f99c-7a34-4190-8149-302f77469936
     ```

     This ID is the application ID of the Azure Token Exchange Endpoint.

   ### GitHub Actions

   - **Select a provider** : **OpenID Connect (OIDC)**.
   - **Provider name**: Name for the provider.
   - **Provider ID**: ID for the provider. You cannot change the provider ID later.
   - **Issuer URL** : `https://token.actions.githubusercontent.com/`
   - **Audiences** : **Default audience**

   ### GitLab SaaS

   - **Select a provider** : **OpenID Connect (OIDC)**.
   - **Provider name**: Name for the provider.
   - **Provider ID**: ID for the provider. You cannot change the provider ID later.
   - **Issuer URL** : `https://gitlab.com`
   - **Audiences** : **Default audience**

   ### HCP Terraform

   - **Select a provider** : **OpenID Connect (OIDC)**.
   - **Provider name**: Name for the provider.
   - **Provider ID**: ID for the provider. You cannot change the provider ID later.
   - **Issuer URL** : `https://app.terraform.io`
   - **Audiences** : **Default audience**
5. Click **Continue**.

6. Under **Configure provider attributes** , add
   the [attribute mappings that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions).

7. Under **Attribute conditions** , enter the [attribute condition that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions).

8. Click **Save** to create the workload identity pool and provider.

### gcloud

1. Create a new workload identity pool:

   ```
   gcloud iam workload-identity-pools create POOL_ID \
       --location="global" \
       --description="DESCRIPTION" \
       --display-name="DISPLAY_NAME"
   ```

   Replace the following values:
   - `POOL_ID`: the unique ID for the pool
   - `DISPLAY_NAME`: the name of the pool
   - `DESCRIPTION`: the description of the pool. This description appears when granting access to pool identities
2. Add a workload identity pool provider:

   ### Azure DevOps

   ```
   gcloud iam workload-identity-pools providers create-oidc PROVIDER_ID \
       --location="global" \
       --workload-identity-pool="POOL_ID" \
       --issuer-uri="ISSUER" \
       --allowed-audiences="AUDIENCE" \
       --attribute-mapping="MAPPINGS" \
       --attribute-condition="CONDITIONS"
   ```

   Replace the following values:
   - `PROVIDER_ID`: the name of the Azure DevOps project, or a custom ID for the provider.
   - `POOL_ID`: the ID of the pool
   - `ISSUER`: the service connection issuer that [you've looked up previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#prepare).
   - `AUDIENCE`: the allowed audience. For new connections, enter the fixed application ID: `fb60f99c-7a34-4190-8149-302f77469936`.
   - `MAPPINGS`: a comma-separated list of [attribute mappings that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)
   - `CONDITIONS`: the [attribute condition that you identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)

   ### GitHub Actions

   ```
   gcloud iam workload-identity-pools providers create-oidc PROVIDER_ID \
       --location="global" \
       --workload-identity-pool="POOL_ID" \
       --issuer-uri="https://token.actions.githubusercontent.com/" \
       --attribute-mapping="MAPPINGS" \
       --attribute-condition="CONDITIONS"
   ```

   Replace the following values:
   - `PROVIDER_ID`: the unique ID for the provider
   - `POOL_ID`: the ID of the pool
   - `MAPPINGS`: a comma-separated list of [attribute mappings that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)
   - `CONDITIONS`: the [attribute condition that you identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)

   ### GitLab SaaS

   ```
   gcloud iam workload-identity-pools providers create-oidc PROVIDER_ID \
       --location="global" \
       --workload-identity-pool="POOL_ID" \
       --issuer-uri="https://gitlab.com" \
       --attribute-mapping="MAPPINGS" \
       --attribute-condition="CONDITIONS"
   ```

   Replace the following values:
   - `PROVIDER_ID`: the unique ID for the provider
   - `POOL_ID`: the ID of the pool
   - `MAPPINGS`: a comma-separated list of [attribute mappings that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)
   - `CONDITIONS`: the [attribute condition that you identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)

   ### HCP Terraform

   ```
   gcloud iam workload-identity-pools providers create-oidc PROVIDER_ID \
       --location="global" \
       --workload-identity-pool="POOL_ID" \
       --issuer-uri="https://app.terraform.io" \
       --attribute-mapping="MAPPINGS" \
       --attribute-condition="CONDITIONS"
   ```

   Replace the following values:
   - `PROVIDER_ID`: the unique ID for the provider.
   - `POOL_ID`: the ID of the pool.
   - `MAPPINGS`: a comma-separated list of [attribute mappings that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions).
   - `CONDITIONS`: the [attribute condition that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions).

> [!NOTE]
> **Note:** The prefix `gcp-` is reserved and can't be used in a pool or provider ID.

### Update attribute condition on a workload identity provider

This section describes how you can update the attribute condition on an existing
workload identity pool provider to restrict access to tokens issued by your
GitHub organization, GitLab group, or HCP Terraform organization.

To find the recommended attribute condition for your pipeline, see [Define an attribute condition](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#conditions).

### Console

1. In the Google Cloud console, go to the **Workload Identity Pools**
   page.

   [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
2. Find the workload identity pool that contains the provider, and then click the
   **Expand node** icon for the
   pool.

3. Find the workload identity pool provider that you want to edit and click
   **Edit**.

4. In **Attribute conditions** , enter the [attribute condition that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions).

5. To update the workload identity pool and provider, click **Save**.

### gcloud

To update the workload identity pool provider, run the following command:

```
gcloud iam workload-identity-pools providers update-oidc PROVIDER_ID \
    --location="global" \
    --workload-identity-pool="POOL_ID" \
    --attribute-condition="CONDITIONS"
```

Replace the following values:

- `PROVIDER_ID`: the unique ID for the provider
- `POOL_ID`: the ID of the pool
- `CONDITIONS`: the [attribute condition that you've identified previously](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)

## Authenticate a deployment pipeline

You must perform these steps for each GitHub Actions workflow or Terraform
Cloud workspace.

### Allow your external workload to access Google Cloud resources

To provide your workload with access to Google Cloud resources, we
recommend that you grant direct resource access to the principal. In this case,
the principal is the federated user. Some Google Cloud products have
[Google Cloud API limitations](https://docs.cloud.google.com/iam/docs/federated-identity-supported-services).
If your workload calls an API endpoint that has a limitation, you can instead
use service account impersonation. In this case, the principal is the
Google Cloud service account, which acts as the identity. You grant access
to the service account on the resource.

### Direct resource access

You can grant access to a federated identity directly on resources by using
the Google Cloud console or the gcloud CLI.

### Console

To use the Google Cloud console to grant IAM roles
directly on a resource, you must go to the resource's page, and then
grant the role. The following example shows you how to go
to the Cloud Storage page and grant the role Storage Object Viewer
(`roles/storage.objectViewer`) to a federated identity directly on a
Cloud Storage bucket.

1. In the Google Cloud console, go to the Cloud Storage **Buckets** page.  

   [Go to Buckets](https://console.cloud.google.com/storage/browser)
2. In the list of buckets, click the name of the bucket for which you
   want to grant the role.

3. Select the **Permissions** tab near the top of the page.

4. Click the
   **Grant access** button.

   The **Add principals** dialog appears.
5. In the **New principals** field, enter one or more identities
   that need access to your bucket.

   ### By subject

       principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/SUBJECT

   Replace the following:
   - `PROJECT_NUMBER`: the project number
   - `POOL_ID`: the workload pool ID
   - `SUBJECT`: the individual subject mapped from your IdP---for example, `administrator@example.com`

   ### By group

       principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/group/GROUP

   Replace the following:
   - `PROJECT_NUMBER`: the project number
   - `WORKLOAD_POOL_ID`: the workload pool ID
   - `GROUP`: the group mapped from your IdP---for example: `administrator-group@example.com`

   ### By attribute

       principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.ATTRIBUTE_NAME/ATTRIBUTE_VALUE

   Replace the following:
   - `PROJECT_NUMBER`: the project number
   - `WORKLOAD_POOL_ID`: the workload pool ID
   - `ATTRIBUTE_NAME`: one of the attributes that was mapped from your IdP
   - `ATTRIBUTE_VALUE`: the value of the attribute
6. Select a role (or roles) from the **Select a role** drop-down menu.
   The roles you select appear in the pane with a short description of
   the permissions they grant.

7. Click **Save**.

### gcloud

To use the gcloud CLI to grant IAM roles on a
resource in a project, do the following:

1. Obtain the project number of the project in which the resource
   is defined.

   ```
   gcloud projects describe $(gcloud config get-value core/project) --format=value\(projectNumber\)
   ```
2. Grant access to the resource.


   To use the gcloud CLI to grant the role Storage Object Viewer
   (`roles/storage.objectViewer`) to external identities that meet certain criteria,
   run the following command.

   ### By subject

   ```
   gcloud storage buckets add-iam-policy-binding BUCKET_ID \
       --role=roles/storage.objectViewer \
       --member="principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/SUBJECT"
   ```

   ### By group

   ```
   gcloud storage buckets add-iam-policy-binding BUCKET_ID \
       --role=roles/storage.objectViewer \
       --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/group/GROUP"
   ```

   ### By attribute

   ```
   gcloud storage buckets add-iam-policy-binding BUCKET_ID \
       --role=roles/storage.objectViewer \
       --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.ATTRIBUTE_NAME/ATTRIBUTE_VALUE"
   ```

   Replace the following:
   - `BUCKET_ID`: the bucket on which to grant access
   - `PROJECT_NUMBER`: the [project number](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects). of the project that contains the workload identity pool
   - `POOL_ID`: the pool ID of the workload identity pool
   - `SUBJECT`: the expected value for the attribute that [you've mapped](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions) to `google.subject`
   - `GROUP`: the expected value for the attribute that [you've mapped](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions) to `google.groups`
   - `ATTRIBUTE_NAME`: the name of a custom attribute in [your attribute mapping](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)
   - `ATTRIBUTE_VALUE`: the value of the custom attribute in [your attribute mapping](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)

   <br />

   You can grant roles on any Google Cloud resource that supports
   IAM allow policies.

   > [!NOTE]
   > **Note:** You must use the project number, not the project ID, in the member identifier.

### Service account impersonation

1. To create a service account for the external workload, do the following:

   1.


      Enable the IAM, Security Token Service, and Service Account Credentials APIs, if any are not already enabled.


      **Roles required to enable APIs**


      To enable APIs, you need the `serviceusage.services.enable` permission. If you
      created the project, then you likely already have this permission through the
      Owner role (`roles/owner`). Otherwise, you can get this permission through the
      Service Usage Admin role (`roles/serviceusage.serviceUsageAdmin`).
      [Learn how to grant roles](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access).

      [Enable the APIs](https://console.cloud.google.com/apis/enableflow?apiid=iam.googleapis.com,sts.googleapis.com,iamcredentials.googleapis.com&redirect=https://console.cloud.google.com)

      <br />

   2. [Create a service account](https://docs.cloud.google.com/iam/docs/creating-managing-service-accounts#creating)
      that represents the workload. We recommend that you [use a dedicated service account for each workload](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation#use-dedicated-service-accounts).
      The service account doesn't need to be in the same project as the
      workload identity pool, but you must refer to the project that
      contains the service account.

   3. [Grant the service account access](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access)
      to resources that you want external identities to access.

2. To let the federated identity impersonate the service account, do the
   following:

### Console

To use the Google Cloud console to grant IAM roles
to a federated identity with service account, do the following:

<br />

### Service Account in the same project

1. To grant access using service account impersonation for a
   service account in the same project, do the following:

   1. Go to the **Workload Identity Pools** page.

      [Go to Workload Identity Pools](https://console.cloud.google.com/iam-admin/workload-identity-pools)
   2. Select **Grant access**.

   3. In the **Grant access to service account** dialog, select
      **Grant access using Service Account impersonation**.

   4. In the **Service accounts** list, select the
      service account for the external identities to impersonate,
      and do the following:

   5. To choose which identities in the pool can impersonate the
      service account, perform one of the following actions:

      - To allow only specific identities of the workload
        identity pool to impersonate the service account, select
        **Only identities matching the filter**.

      - In the **Attribute name** list, select the attribute
        that you want to filter on.

      - In the **Attribute value** field, enter the expected
        value of the attribute; for example, if you use an
        attribute mapping `google.subject=assertion.sub`, set
        **Attribute** name to `subject` and **Attribute value**
        to the value of the `sub` claim in tokens that are
        issued by your external identity provider.

   6. To save the configuration, click **Save** and then
      **Dismiss**.

### Service account in a different project

> [!NOTE]
> **Note:** Service accounts from different projects won't appear in the "CONNECTED SERVICE ACCOUNTS" section of your **Workload Identity Pool**.

1. To grant access using service account impersonation for a
   service account in a different project, do the following:

   1. Go to the **Service Accounts** page.

      [Go to Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   2. Select the service account that you want to impersonate.

   3. Click **Manage access**.

   4. Click **Add principal**.

   5. In the **New principal** field, enter one of the following
      [principal identifiers](https://docs.cloud.google.com/iam/docs/workload-identity-federation#principal-types)
      for the identities in your pool that will impersonate the
      service account.

      ### By subject

          principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/SUBJECT

      Replace the following:
      - `PROJECT_NUMBER`: the project number
      - `POOL_ID`: the workload pool ID
      - `SUBJECT`: the individual subject mapped from your IdP---for example, `administrator@example.com`

      ### By group

          principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/group/GROUP

      Replace the following:
      - `PROJECT_NUMBER`: the project number
      - `WORKLOAD_POOL_ID`: the workload pool ID
      - `GROUP`: the group mapped from your IdP---for example: `administrator-group@example.com`

      ### By attribute

          principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.ATTRIBUTE_NAME/ATTRIBUTE_VALUE

      Replace the following:
      - `PROJECT_NUMBER`: the project number
      - `WORKLOAD_POOL_ID`: the workload pool ID
      - `ATTRIBUTE_NAME`: one of the attributes that was mapped from your IdP
      - `ATTRIBUTE_VALUE`: the value of the attribute

      ### By pool

          principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/*

      Replace the following:
      - `PROJECT_NUMBER`: the project number
      - `WORKLOAD_POOL_ID`: the workload pool ID
   6. In **Select a role** , select the Workload Identity User
      role (`roles/iam.workloadIdentityUser`).

   7. To save the configuration, click **Save**.

### gcloud


To grant the Workload Identity User role (`roles/iam.workloadIdentityUser`)
to a federated principal or principal set, run the following
command. To learn more about Workload Identity Federation principal
identifiers, see [Principal types](https://docs.cloud.google.com/iam/docs/workload-identity-federation#principal-types).

### By subject

```
gcloud iam service-accounts add-iam-policy-binding SERVICE_ACCOUNT_EMAIL \
    --role=roles/iam.workloadIdentityUser \
    --member="principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/SUBJECT"
```

### By group

```
gcloud iam service-accounts add-iam-policy-binding SERVICE_ACCOUNT_EMAIL \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/group/GROUP"
```

### By attribute

```
gcloud iam service-accounts add-iam-policy-binding SERVICE_ACCOUNT_EMAIL \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.ATTRIBUTE_NAME/ATTRIBUTE_VALUE"
```

Replace the following:

- `SERVICE_ACCOUNT_EMAIL`: the email address of the service account
- `PROJECT_NUMBER`: the [project number](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects). of the project that contains the workload identity pool
- `POOL_ID`: the pool ID of the workload identity pool
- `SUBJECT`: the expected value for the attribute that [you've mapped](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions) to `google.subject`
- `GROUP`: the expected value for the attribute that [you've mapped](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions) to `google.groups`
- `ATTRIBUTE_NAME`: the name of a custom attribute in [your attribute mapping](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)
- `ATTRIBUTE_VALUE`: the value of the custom attribute in [your attribute mapping](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#mappings-and-conditions)

<br />

> [!NOTE]
> **Note:** You must use the project number, not the project ID, in the member identifier.

> [!NOTE]
> **Note:** Direct resource access isn't supported for HCP Terraform. If you use HCP Terraform, you must use service account impersonation.

### Configure the deployment pipeline

This section describes how to use Workload Identity Federation in your
deployment pipeline. The instructions in this section assume that your workloads
use [service account impersonation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#access) to access Google Cloud
resources.

### Azure DevOps

Edit your `azure-pipelines.yml` file and add the following to your
job configuration:

```yaml
variables:
- name: Azure.WorkloadIdentity.Connection
  value: CONNECTION
- name: GoogleCloud.WorkloadIdentity.ProjectNumber
  value: PROJECT_NUMBER
- name: GoogleCloud.WorkloadIdentity.Pool
  value: POOL_ID
- name: GoogleCloud.WorkloadIdentity.Provider
  value: PROVIDER_ID
- name: GoogleCloud.WorkloadIdentity.ServiceAccount
  value: SERVICE_ACCOUNT_EMAIL
- name: GOOGLE_APPLICATION_CREDENTIALS
  value: $(Pipeline.Workspace)/.workload_identity.wlconfig

steps:
  - task: AzureCLI@2
    inputs:
      connectedServiceNameARM: $(Azure.WorkloadIdentity.Connection)
      addSpnToEnvironment: true
      scriptType: 'bash'
      scriptLocation: 'inlineScript'
      inlineScript: |
        echo $idToken > $(Pipeline.Workspace)/.workload_identity.jwt
        cat << EOF > $GOOGLE_APPLICATION_CREDENTIALS
        {
          "type": "external_account",
          "audience": "//iam.googleapis.com/projects/$(GoogleCloud.WorkloadIdentity.ProjectNumber)/locations/global/workloadIdentityPools/$(GoogleCloud.WorkloadIdentity.Pool)/providers/$(GoogleCloud.WorkloadIdentity.Provider)",
          "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
          "token_url": "https://sts.REGION.rep.googleapis.com/v1/token",
          "credential_source": {
            "file": "$(Pipeline.Workspace)/.workload_identity.jwt"
          },
          "service_account_impersonation_url": "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/$(GoogleCloud.WorkloadIdentity.ServiceAccount):generateAccessToken"
        }
        EOF

  - task: Bash@3
    displayName: 'Verify Google Cloud authentication'
    inputs:
      targetType: 'inline'
      script: |
        gcloud auth login --cred-file="$(GOOGLE_APPLICATION_CREDENTIALS)"
        gcloud auth print-access-token
```

Replace the following values:

- `CONNECTION`: The name of your service connection.
- `PROJECT_NUMBER`: The project number of the project that contains the workload identity pool.
- `POOL_ID`: The ID of the workload identity pool.
- `PROVIDER_ID`: The ID of the workload identity pool provider.
- `SERVICE_ACCOUNT_EMAIL`: The email address of the service account, if you use service account impersonation. If you use direct resource access, omit `GoogleCloud.WorkloadIdentity.ServiceAccount` and `service_account_impersonation_url`.
- `REGION`: A region for [regional STS endpoints](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation#sts-regional-endpoints), if they are available. If regional endpoints aren't available, you can use https://sts.googleapis.com/v1/token.

The configuration does the following:

1. Uses the [`AzureCLI` task](https://learn.microsoft.com/en-us/azure/devops/pipelines/tasks/reference/azure-cli-v2?view=azure-pipelines) to obtain an ID token for the service connection, and makes it available in a variable named `idToken`.
2. Saves the ID token to a temporary file named `.workload_identity.jwt`.
3. Creates a credential configuration file that instructs client libraries to read the ID token from `.workload_identity.jwt` and uses it to impersonate a service account.
4. Sets the environment variable `GOOGLE_APPLICATION_CREDENTIALS` to point to the credential configuration file.
5. Verifies the configuration by authenticating to Google Cloud and printing an access token.

### GitHub Actions

The [`google-github-actions/auth`](https://github.com/google-github-actions/auth)
action lets you automatically generate a credential configuration file
during workflow execution. Client libraries and tools such as `terraform`
can then use this credential configuration file to automatically obtain
Google credentials.

Edit your GitHub Actions YAML file and add the following:

- Allow the job to fetch a GitHub ID token by adding the following
  configuration:

  ```yaml
  permissions:
    id-token: write
    contents: read
  ```
- Add a step to create a credentials configuration file:

  ```yaml
  - id: 'auth'
    name: 'Authenticate to Google Cloud'
    uses: 'google-github-actions/auth@v1'
    with:
      create_credentials_file: true
      workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID'
      service_account: 'SERVICE_ACCOUNT_EMAIL'
  ```

Replace the following:

- `PROJECT_NUMBER`: The project number of the project that contains the workload identity pool.
- `POOL_ID`: The ID of the workload identity pool.
- `PROVIDER_ID`: The ID of the workload identity pool provider.
- `SERVICE_ACCOUNT_EMAIL`: The email address of the service account, if you use service account impersonation. If you use direct resource access, omit `service_account`.

The following example configures the GitHub Action:

```yaml
jobs:
  build:
    # Allow the job to fetch a GitHub ID token
    permissions:
      id-token: write
      contents: read

    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - id: 'auth'
        name: 'Authenticate to Google Cloud'
        uses: 'google-github-actions/auth@v1'
        with:
          create_credentials_file: true
          workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID'
          service_account: 'SERVICE_ACCOUNT_EMAIL'
```

For further details on using the `google-github-actions/auth` action,
see [Setting up Workload Identity Federation](https://github.com/google-github-actions/auth#setup).

### GitLab SaaS

Edit your `.gitlab-ci.yml` file and add the following to the job
configuration:

```yaml
job:
  variables:
    WORKLOAD_IDENTITY_PROJECT_NUMBER: PROJECT_NUMBER
    WORKLOAD_IDENTITY_POOL: POOL_ID
    WORKLOAD_IDENTITY_PROVIDER: PROVIDER_ID
    SERVICE_ACCOUNT: SERVICE_ACCOUNT_EMAIL
    GOOGLE_APPLICATION_CREDENTIALS: $CI_BUILDS_DIR/.workload_identity.wlconfig

  id_tokens:
    WORKLOAD_IDENTITY_TOKEN:
      aud: https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID

  script:
    - |-
      echo $WORKLOAD_IDENTITY_TOKEN > $CI_BUILDS_DIR/.workload_identity.jwt
      cat << EOF > $GOOGLE_APPLICATION_CREDENTIALS
      {
        "type": "external_account",
        "audience": "//iam.googleapis.com/projects/$WORKLOAD_IDENTITY_PROJECT_NUMBER/locations/global/workloadIdentityPools/$WORKLOAD_IDENTITY_POOL/providers/$WORKLOAD_IDENTITY_PROVIDER",
        "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
        "token_url": "https://sts.REGION.rep.googleapis.com/v1/token",
        "credential_source": {
          "file": "$CI_BUILDS_DIR/.workload_identity.jwt"
        },
        "service_account_impersonation_url": "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/$SERVICE_ACCOUNT:generateAccessToken"
      }
      EOF
```

Replace the following values:

- `PROJECT_NUMBER`: The project number of the project that contains the workload identity pool.
- `POOL_ID`: The ID of the workload identity pool.
- `PROVIDER_ID`: The ID of the workload identity pool provider.
- `SERVICE_ACCOUNT_EMAIL`: The email address of the service account, if you use service account impersonation. If you use direct resource access, omit `SERVICE_ACCOUNT` and `service_account_impersonation_url`.
- `REGION`: A region for [regional STS endpoints](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation#sts-regional-endpoints), if they are available. If regional endpoints aren't available, you can use https://sts.googleapis.com/v1/token.

The configuration does the following:

1. Instructs GitLab to issue an ID token, and makes it available in the environment variable named `WORKLOAD_IDENTITY_TOKEN`. The ID token uses your workload identity pool provider as audience.
2. Saves the ID token to a temporary file named `.workload_identity.jwt`.
3. Creates a credential configuration file that instructs client libraries to read the ID token from `.workload_identity.jwt` and uses it to impersonate a service account.
4. Sets the environment variable `GOOGLE_APPLICATION_CREDENTIALS` to point to the credential configuration file.

### HCP Terraform

Configure your HCP Terraform workspace so that it uses
Workload Identity Federation to authenticate to Google Cloud using
service account impersonation:

1. In HCP Terraform, open your workspace and go to **Variables**.

2. Add the following variables:

   | Variable category | Key | Value |
   |---|---|---|
   | Environment variable | `TFC_GCP_PROVIDER_AUTH` | `true` |
   | Environment variable | `TFC_GCP_RUN_SERVICE_ACCOUNT_EMAIL` | The email address of the service account, if you use service account impersonation---for example, `terraform@my-project-123.iam.gserviceaccount.com`. |
   | Environment variable | `TFC_GCP_PROJECT_NUMBER` | The project number of the project that contains the workload identity pool |
   | Environment variable | `TFC_GCP_WORKLOAD_POOL_ID` | The ID of the workload identity pool |
   | Environment variable | `TFC_GCP_WORKLOAD_PROVIDER_ID ` | The ID of the workload identity pool provider |

   Optionally, you can add additional environment variables to let HCP
   Terraform use different service accounts for the `plan` and `apply`
   phases. For more information about using environment variables in
   Terraform configurations, see
   [Optional Environment Variables](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/dynamic-provider-credentials/gcp-configuration#optional-environment-variables).
3. In the list of variables, verify that **Category** is set to `env` for
   the five variables that you added in the previous step.

4. Verify that your Terraform configuration uses version `4.48.0` or newer
   of the Google Cloud provider, and update it if necessary, as follows:

   ```
   terraform {
     required_providers {
       google = {
         source  = "hashicorp/google"
         version = "~> 4.48.0"
       }
     }
   }
   ```
5. Submit the changes to your source code repository.

## What's next

- Read more about [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation).
- Learn about [best practices for using Workload Identity Federation in deployment pipelines](https://docs.cloud.google.com/iam/docs/best-practices-for-using-service-accounts-in-deployment-pipelines).
- See how you can [manage workload identity pools and providers](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers).
