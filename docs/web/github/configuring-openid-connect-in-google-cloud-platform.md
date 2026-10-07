---
title: Configuring OpenID Connect in Google Cloud Platform
url: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform
created_at: 2026-10-07T15:14:24-03:00
updated_at: 2026-10-07T15:14:24-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Configuring OpenID Connect in Google Cloud Platform

Use OpenID Connect within your workflows to authenticate with Google Cloud Platform.

## Overview

OpenID Connect (OIDC) allows your GitHub Actions workflows to access resources in Google Cloud Platform (GCP), without needing to store the GCP credentials as long-lived GitHub secrets.

This guide gives an overview of how to configure GCP to trust GitHub's OIDC as a federated identity, and includes a workflow example for the [`google-github-actions/auth`](https://github.com/google-github-actions/auth) action that uses tokens to authenticate to GCP and access resources.

## Prerequisites

* To learn the basic concepts of how GitHub uses OpenID Connect (OIDC), and its architecture and benefits, see [OpenID Connect](/en/actions/concepts/security/openid-connect).

* Before proceeding, you must plan your security strategy to ensure that access tokens are only allocated in a predictable way. To control how your cloud provider issues access tokens, you **must** define at least one condition, so that untrusted repositories can’t request access tokens for your cloud resources. For more information, see [OpenID Connect reference](/en/actions/reference/security/oidc#oidc-claims-used-to-define-trust-conditions-on-cloud-roles).

* OIDC tokens requested for Dependabot update jobs have an `event_name` claim of `dynamic`. If your trust policy is intended to authorize only GitHub Actions workflows and your cloud provider supports conditions on `event_name`, allow only the event names expected by your workflows. For more information, see [OpenID Connect reference](/en/actions/reference/security/oidc#oidc-claims-used-to-define-trust-conditions-on-cloud-roles).

For repositories created after July 15, 2026, and repository renames or transfers after that date, use an immutable default OIDC `sub` claim that includes owner and repository IDs (not available on GitHub Enterprise Server). Existing repositories keep the previous format unless they opt in. For more information, see [OpenID Connect reference](/en/actions/reference/security/oidc#immutable-subject-claims).

## Adding a Google Cloud Workload Identity Provider

To configure the OIDC identity provider in GCP, you will need to perform the following configuration. For instructions on making these changes, refer to [the GCP documentation](https://github.com/google-github-actions/auth).

1. Create a new identity pool.
2. Configure the mapping and add conditions.
3. Connect the new pool to a service account.

Additional guidance for configuring the identity provider:

* For security hardening, make sure you've reviewed [OpenID Connect reference](/en/actions/reference/security/oidc#oidc-claims-used-to-define-trust-conditions-on-cloud-roles). For an example, see [OpenID Connect reference](/en/actions/reference/security/oidc#configuring-the-subject-in-your-cloud-provider).
* For the service account to be available for configuration, it needs to be assigned to the `roles/iam.workloadIdentityUser` role. For more information, see [the GCP documentation](https://cloud.google.com/iam/docs/workload-identity-federation?_ga=2.114275588.-285296507.1634918453#conditions).
* The Issuer URL to use: `https://token.actions.githubusercontent.com`

## Updating your GitHub Actions workflow

To update your workflows for OIDC, you will need to make two changes to your YAML:

1. Add permissions settings for the token.
2. Use the [`google-github-actions/auth`](https://github.com/google-github-actions/auth) action to exchange the OIDC token (JWT) for a cloud access token.

> \[!NOTE]
> When environments are used in workflows or in OIDC policies, we recommend adding protection rules to the environment for additional security. For example, you can configure deployment rules on an environment to restrict which branches and tags can deploy to the environment or access environment secrets. For more information, see [Managing environments for deployment](/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

### Adding permissions settings

The job or workflow run requires a `permissions` setting with [`id-token: write`](/en/actions/tutorials/authenticate-with-github_token#modifying-the-permissions-for-the-github_token) to allow GitHub's OIDC provider to create a JSON Web Token for every run.

> \[!NOTE] Setting `id-token: write` in the workflow’s permissions does not give the workflow permission to modify or write to any resources. Instead, it only allows the workflow to request (fetch) and use (set) an OIDC token for an action or step. This token is then used to authenticate with external services using a short-lived access token.

For detailed information on required permissions, configuration examples, and advanced scenarios, see [OpenID Connect reference](/en/actions/reference/security/oidc#workflow-permissions-for-the-requesting-the-oidc-token).

### Requesting the access token

The `google-github-actions/auth` action receives a JWT from the GitHub OIDC provider, and then requests an access token from GCP. For more information, see the GCP [documentation](https://github.com/google-github-actions/auth).

This example has a job called `Get_OIDC_ID_token` that uses actions to request a list of services from GCP.

* `WORKLOAD-IDENTITY-PROVIDER`: Replace this with the path to your identity provider in GCP. For example, `projects/example-project-id/locations/global/workloadIdentityPools/name-of-pool/providers/name-of-provider`
* `SERVICE-ACCOUNT`: Replace this with the name of your service account in GCP.

This action exchanges a GitHub OIDC token for a Google Cloud access token, using [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation).

```yaml copy
# This workflow uses actions that are not certified by GitHub.
# They are provided by a third-party and are governed by
# separate terms of service, privacy policy, and support
# documentation.
name: List services in GCP
on:
  pull_request:
    branches:
      - main

permissions:
  id-token: write

jobs:
  Get_OIDC_ID_token:
    runs-on: ubuntu-latest
    steps:
    - id: 'auth'
      name: 'Authenticate to GCP'
      uses: 'google-github-actions/auth@f1e2d3c4b5a6f7e8d9c0b1a2c3d4e5f6a7b8c9d0'
      with:
          create_credentials_file: 'true'
          workload_identity_provider: 'WORKLOAD-IDENTITY-PROVIDER'
          service_account: 'SERVICE-ACCOUNT'
    - id: 'gcloud'
      name: 'gcloud'
      run: |-
        gcloud auth login --brief --cred-file="${{ steps.auth.outputs.credentials_file_path }}"
        gcloud services list
```

## Further reading

* [Using OpenID Connect with reusable workflows](/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-with-reusable-workflows)
* [Self-hosted runners reference](/en/actions/reference/runners/self-hosted-runners)
