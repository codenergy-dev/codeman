---
title: Example logs for Workload Identity Federation
url: https://docs.cloud.google.com/iam/docs/audit-logging/examples-workload-identity
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Example logs for Workload Identity Federation

This page shows examples of the audit logs that are generated when you use
[Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation). With
Workload Identity Federation, you can allow an on-premises or multicloud
workload to access Google Cloud resources, without using a service account key.

> [!NOTE]
> **Note:** Each example shows only the most relevant fields in the log entries.

For more information about enabling and viewing audit logs, see
[IAM audit logging](https://docs.cloud.google.com/iam/docs/audit-logging).

## Logs for exchanging an IdP token for a federated token

After you [set up your workload identity pools](https://docs.cloud.google.com/iam/docs/manage-workload-identity-pools-providers) and
identity provider (IdP), you can create a token for your IdP and
exchange it for a federated token.

IAM can generate audit logs when principals exchange a token.
To receive audit logs for all steps of the token-exchange process, you must
[enable audit logs for Data Access activity](https://docs.cloud.google.com/iam/docs/audit-logging#enabling_audit_logging) for the
following APIs:

- Identity and Access Management (IAM) API (enable log type "Admin Read")
- Security Token Service API (enable log type "Admin Read")

After you enable audit logs for Data Access activity, IAM
generates an audit log entry each time a principal exchanges a token. The log
entry includes the following fields:

- `protoPayload.authenticationInfo.principalSubject`: The subject of the IdP token.
  - On Amazon Web Services (AWS), this field contains the Amazon Resource Name (ARN) of the principal that you authenticated.
  - On Microsoft Azure, this field contains the object ID of the managed identity that you specified as the Azure token subject.
  - For other OIDC IdPs, this field contains the value of the `sub`, or subject, claim from the OIDC token.
- `protoPayload.metadata.mapped_principal`: The subject of the token, using
  IAM syntax to identify the principal:

  ```
  principal://iam.googleapis.com/projects/project-number/locations/global/workloadIdentityPools/pool-id/subject/identifier
  ```
- `protoPayload.resourceName`: The workload identity pool provider that the
  token is associated with.

- `protoPayload.status`: The status of the token exchange request. For a
  successful token exchange, this field is empty (`{}`) or omitted. If the
  token exchange fails due to a server error, this field contains an error
  code and message. Failures caused by client errors, such as invalid
  credentials or arguments, are not logged.

- `protoPayload.authorizationInfo`: Information about the permissions
  evaluated during the request. For token exchange requests, this field
  always contains an entry for the `sts.identityProviders.checkLogging`
  permission with `granted` set to `false`. The Security Token Service
  checks this permission to determine whether Data Access audit logging is
  enabled for the provider. Because calling workloads don't have this
  permission, `granted` is always `false`. This check doesn't cause the
  token exchange to fail.

The following example shows an audit log entry for a request to exchange a
token. In this example, a Microsoft Azure token was exchanged for a federated
token:

```json
{
  "logName": "projects/my-project/logs/cloudaudit.googleapis.com%2Fdata_access",
  "protoPayload": {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    "status": {},
    "authenticationInfo": {
      "principalSubject": "b6112abb-5791-4507-adb5-7e8cc306eb2e"
    },
    "metadata": {
      "mapped_principal": "principal://iam.googleapis.com/projects/1234567890123/locations/global/workloadIdentityPools/azure-pool/subject/a1234bcd-5678-9012-efa3-4b5cd678ef9a"
    },
    "methodName": "google.identity.sts.v1.SecurityTokenService.ExchangeToken",
    "resourceName": "projects/1234567890123/locations/global/workloadIdentityPools/azure-pool/providers/azure",
    "request": {
      "@type": "type.googleapis.com/google.identity.sts.v1.ExchangeTokenRequest",
      "grantType": "urn:ietf:params:oauth:grant-type:token-exchange"
    },
    "authorizationInfo": [
      {
        "permission": "sts.identityProviders.checkLogging",
        "granted": false,
        "permissionType": "ADMIN_READ"
      }
    ]
  },
  "resource": {
    "type": "audited_resource"
  }
}
```

## Logs for signed and encrypted SAML assertions

This section describes the Cloud Audit Logs log entries that Security Token Service
creates when it attempts to verify signed SAML assertions or decrypt encrypted
assertions that are sent from your IdP.

For Workload Identity Federation, the pertinent log
entry looks similar to the following:

```
"keyInfo": [
  {
    "use": "verify"
    "fingerprint": "3C:B2:47:F8:A5:9A:8A:52:BD:1C:BC:96:B5:45:C1:8D:A7:F1:73:2D"
  },
  {
    "use": "decrypt"
    "resourceName": "//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/WORKLOAD_POOL_NAME/providers/PROVIDER_NAME/keys/KEY_NAME"
  }
]
```

This output includes the following values:

- `fingerprint`: the hexadecimal representation of the SHA-256 hash of the X.509 certificate that was used to verify the signature on the SAML credential. The X.509 certificate is extracted from the SAML XML metadata that is attached to the workload identity pool provider.
- `resourceName`: the resource name of the workload identity pool provider key that was used to decrypt the encrypted SAML assertion. This field is present only if identity federation receives an encrypted SAML response from your IdP.

## Logs for X.509 federation

> [!WARNING]
>
> **Preview
> --- X.509 certificate-based federation**
>
>
> This feature is
>
> subject to the "Pre-GA Offerings Terms" in the General Service Terms section of the
> [Service Specific
> Terms](https://docs.cloud.google.com/terms/service-terms#1).
>
> Pre-GA features are available "as is" and might have limited support.
>
> For more information, see the
> [launch stage descriptions](https://cloud.google.com/products/#product-launch-stages).

This section describes the Cloud Audit Logs log entries that Security Token Service
creates when it attempts to verify mTLS client certificate with a pre-configured trust store.

For Workload Identity Federation, the pertinent log
entry looks similar to the following:

```
"keyInfo": [
  {
    "certificateType": "trust_anchor"
    "timeUntilExpiration": 3333405600s
    "fingerprintSha256": "e33f612a0e426692f29db2c7b17b9e3810ce13f09ad117c67e7227a84fd25ea5"
    "use": "verify"
  }
```

This output includes the following values:

- `certificateType`: the type of certificate involved in the client certificate verification, which can be either `trust_anchor` or `intermediate_ca`
- `timeUntilExpiration`: the remaining time in seconds until certificate expiration when it's used in the certificate chain verification
- `fingerprintSha256`: the hexadecimal representation of the SHA-256 hash of the X.509 certificate

## Logs for creating short-lived credentials for a service account

After you exchange the IdP token for a federated token, you can
use the federated token to create short-lived credentials for a service account.
All Google services allow you to authenticate with these short-lived
credentials.

After you enable IAM audit logs for Data Access activity,
IAM generates an audit log entry each time a principal
generates short-lived credentials for a service account. The log entry includes
the following fields:

- `protoPayload.authenticationInfo.principalSubject`: The subject of the federated token.
- `resource.labels.email_id`: The service account for which short-lived credentials were generated.

The following example shows an audit log entry for a request to generate a
short-lived OAuth 2.0 access token for a service account. In this example, the
request was authenticated with federated credentials, and the short-lived
credentials were created for the service account
`my-service-account@my-project.iam.gserviceaccount.com`:

```json
{
  "logName": "projects/my-project/logs/cloudaudit.googleapis.com%2Fdata_access",
  "protoPayload": {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    "authenticationInfo": {
      "principalSubject": "principal://iam.googleapis.com/projects/1234567890123/locations/global/workloadIdentityPools/aws-pool/subject/012345678901"
    },
    "methodName": "GenerateAccessToken",
    "request": {
      "@type": "type.googleapis.com/google.iam.credentials.v1.GenerateAccessTokenRequest",
      "name": "projects/-/serviceAccounts/my-service-account@my-project.iam.gserviceaccount.com"
    },
    "resourceName": "projects/-/serviceAccounts/123456789012345678901"
  },
  "resource": {
    "labels": {
      "email_id": "my-service-account@my-project.iam.gserviceaccount.com",
      "project_id": "my-project",
      "unique_id": "123456789012345678901"
    },
    "type": "service_account"
  }
}
```

## Logs for authenticating with credentials for the impersonated service account

After you create short-lived credentials for a service account, you can use the
credentials to impersonate the service account when you call Google Cloud
APIs.

Some of the methods you call might generate audit logs. In general, these
log entries show the following identities:


- The service account that the short-lived credentials are impersonating
- The identity that created the short-lived credentials

<br />


> [!NOTE]
> **Note:** Some Google Cloud services, including App Engine and Google Kubernetes Engine, do not log the identity that created the short-lived credentials.

<br />

For example, suppose that the user `jamie@example.com` creates a federated token
for the subject `principal://iam.googleapis.com/projects/1234567890123/locations/global/workloadIdentityPools/aws-pool/subject/arn:aws:iam::123456789012:role/my-role`,
then uses the federated token to create short-lived credentials for the service
account `my-service-account@my-project.iam.gserviceaccount.com`.

The user then creates a new Pub/Sub topic, using the short-lived
credentials to impersonate the service account. Pub/Sub generates
a log entry that identifies the service account, as well as the subject of the
token from the IdP:

    {
      "logName": "projects/my-project/logs/cloudaudit.googleapis.com%2Factivity",
      "protoPayload": {
        "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
        "authenticationInfo": {
          "principalEmail": "my-service-account@my-project.iam.gserviceaccount.com",
          "serviceAccountDelegationInfo": [
            {
              "principalSubject": "principal://iam.googleapis.com/projects/1234567890123/locations/global/workloadIdentityPools/aws-pool/subject/arn:aws:iam::123456789012:role/my-role"
            }
          ]
        },
        "methodName": "google.pubsub.v1.Publisher.CreateTopic",
        "request": {
          "@type": "type.googleapis.com/google.pubsub.v1.Topic",
          "name": "projects/my-project/topics/my-topic"
        },
        "resourceName": "projects/my-project/topics/my-topic"
      },
      "resource": {
        "type": "pubsub_topic"
      }
    }

## What's next

- [Configure and view the audit logs](https://docs.cloud.google.com/iam/docs/audit-logging) for IAM.
- Get more information about [Cloud Audit Logs](https://docs.cloud.google.com/logging/docs/audit).
- Set up [identity federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation) using workload identity pools.
- Learn about [service accounts](https://docs.cloud.google.com/iam/docs/service-accounts).