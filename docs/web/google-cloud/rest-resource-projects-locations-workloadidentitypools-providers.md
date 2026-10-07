---
title: "REST Resource: projects.locations.workloadIdentityPools.providers"
url: https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers
created_at: 2026-10-07T15:14:01-03:00
updated_at: 2026-10-07T15:14:01-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# REST Resource: projects.locations.workloadIdentityPools.providers

- [Resource: WorkloadIdentityPoolProvider](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider)
  - [JSON representation](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider.SCHEMA_REPRESENTATION)
- [State](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#State)
- [Aws](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Aws)
  - [JSON representation](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Aws.SCHEMA_REPRESENTATION)
- [Oidc](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Oidc)
  - [JSON representation](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Oidc.SCHEMA_REPRESENTATION)
- [Saml](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Saml)
  - [JSON representation](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Saml.SCHEMA_REPRESENTATION)
- [X509](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#X509)
  - [JSON representation](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#X509.SCHEMA_REPRESENTATION)
- [Methods](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#METHODS_SUMMARY)

## Resource: WorkloadIdentityPoolProvider

A configuration for an external identity provider.

| JSON representation |
|---|
| ``` { "name": string, "displayName": string, "description": string, "state": enum (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#State`), "disabled": boolean, "attributeMapping": { string: string, ... }, "attributeCondition": string, "expireTime": string, // Union field `provider_config` can be only one of the following: "aws": { object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Aws`) }, "oidc": { object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Oidc`) }, "saml": { object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Saml`) }, "x509": { object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#X509`) } // End of list of possible types for union field `provider_config`. } ``` |

| Fields ||
|---|---|
| `name` | `string` Output only. The resource name of the provider. |
| `displayName` | `string` Optional. A display name for the provider. Cannot exceed 32 characters. |
| `description` | `string` Optional. A description for the provider. Cannot exceed 256 characters. |
| `state` | ``enum (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#State`)`` Output only. The state of the provider. |
| `disabled` | `boolean` Optional. Whether the provider is disabled. You cannot use a disabled provider to exchange tokens. However, existing tokens still grant access. |
| `attributeMapping` | `map (key: string, value: string)` Optional. Maps attributes from authentication credentials issued by an external identity provider to Google Cloud attributes, such as `subject` and `segment`. Each key must be a string specifying the Google Cloud IAM attribute to map to. The following keys are supported: - `google.subject`: The principal IAM is authenticating. You can reference this value in IAM bindings. This is also the subject that appears in Cloud Logging logs. Cannot exceed 127 bytes. - `google.groups`: Groups the external identity belongs to. You can grant groups access to resources using an IAM `principalSet` binding; access applies to all members of the group. You can also provide custom attributes by specifying `attribute.{custom_attribute}`, where `{custom_attribute}` is the name of the custom attribute to be mapped. You can define a maximum of 50 custom attributes. The maximum length of a mapped attribute key is 100 characters, and the key may only contain the characters \[a-z0-9_\]. You can reference these attributes in IAM policies to define fine-grained access for a workload to Google Cloud resources. For example: - `google.subject`: `principal://iam.googleapis.com/projects/{project}/locations/{location}/workloadIdentityPools/{pool}/subject/{value}` - `google.groups`: `principalSet://iam.googleapis.com/projects/{project}/locations/{location}/workloadIdentityPools/{pool}/group/{value}` - `attribute.{custom_attribute}`: `principalSet://iam.googleapis.com/projects/{project}/locations/{location}/workloadIdentityPools/{pool}/attribute.{custom_attribute}/{value}` Each value must be a [Common Expression Language](https://opensource.google/projects/cel) function that maps an identity provider credential to the normalized attribute specified by the corresponding map key. You can use the `assertion` keyword in the expression to access a JSON representation of the authentication credential issued by the provider. The maximum length of an attribute mapping expression is 2048 characters. When evaluated, the total size of all mapped attributes must not exceed 8KB. For AWS providers, if no attribute mapping is defined, the following default mapping applies: { "google.subject":"assertion.arn", "attribute.aws_role": "assertion.arn.contains('assumed-role')" " ? assertion.arn.extract('{account_arn}assumed-role/')" "   + 'assumed-role/'" "   + assertion.arn.extract('assumed-role/{role_name}/')" " : assertion.arn", } If any custom attribute mappings are defined, they must include a mapping to the `google.subject` attribute. For OIDC providers, you must supply a custom mapping, which must include the `google.subject` attribute. For example, the following maps the `sub` claim of the incoming credential to the `subject` attribute on a Google token: {"google.subject": "assertion.sub"} An object containing a list of `"key": value` pairs. Example: `{ "name": "wrench", "mass": "1.3kg", "count": "3" }`. |
| `attributeCondition` | `string` Optional. [A Common Expression Language](https://opensource.google/projects/cel) expression, in plain text, to restrict what otherwise valid authentication credentials issued by the provider should not be accepted. The expression must output a boolean representing whether to allow the federation. The following keywords may be referenced in the expressions: - `assertion`: JSON representing the authentication credential issued by the provider. - `google`: The Google attributes mapped from the assertion in the `attribute_mappings`. - `attribute`: The custom attributes mapped from the assertion in the `attribute_mappings`. The maximum length of the `attributeCondition` expression is 4,096 characters. If unspecified, all valid authentication credentials are accepted. However, multi-tenant identity providers (such as GitHub or Terraform Cloud) require an `attributeCondition` to prevent token spoofing. The following example shows how to only allow credentials with a mapped `google.groups` value of `admins`: "'admins' in google.groups" |
| `expireTime` | ``string (`https://protobuf.dev/reference/protobuf/google.protobuf#timestamp` format)`` Output only. Time after which the workload identity pool provider will be permanently purged and cannot be recovered. Uses RFC 3339, where generated output will always be Z-normalized and use 0, 3, 6 or 9 fractional digits. Offsets other than "Z" are also accepted. Examples: `"2014-10-02T15:01:23Z"`, `"2014-10-02T15:01:23.045123456Z"` or `"2014-10-02T15:01:23+05:30"`. |
| Union field `provider_config`. Identity provider configuration types. `provider_config` can be only one of the following: ||
| `aws` | ``object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Aws`)`` An Amazon Web Services identity provider. |
| `oidc` | ``object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Oidc`)`` An OpenId Connect 1.0 identity provider. |
| `saml` | ``object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#Saml`)`` An SAML 2.0 identity provider. |
| `x509` | ``object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#X509`)`` An X.509-type identity provider. |

## State

The current state of the provider.

| Enums ||
|---|---|
| `STATE_UNSPECIFIED` | State unspecified. |
| `ACTIVE` | The provider is active, and may be used to validate authentication credentials. |
| `DELETED` | The provider is soft-deleted. Soft-deleted providers are permanently deleted after approximately 30 days. You can restore a soft-deleted provider using `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/undelete#google.iam.v1.WorkloadIdentityPools.UndeleteWorkloadIdentityPoolProvider`. You cannot reuse the ID of a soft-deleted provider until it is permanently deleted. |

## Aws

Represents an Amazon Web Services identity provider.

| JSON representation |
|---|
| ``` { "accountId": string } ``` |

| Fields ||
|---|---|
| `accountId` | `string` Required. The AWS account ID. |

## Oidc

Represents an OpenId Connect 1.0 identity provider.

| JSON representation |
|---|
| ``` { "issuerUri": string, "allowedAudiences": [ string ], "jwksJson": string } ``` |

| Fields ||
|---|---|
| `issuerUri` | `string` Required. The OIDC issuer URL. Must be an HTTPS endpoint. Per OpenID Connect Discovery 1.0 spec, the OIDC issuer URL is used to locate the provider's public keys (via `jwksUri`) for verifying tokens like the OIDC ID token. These public key types must be 'EC' or 'RSA'. |
| `allowedAudiences[]` | `string` Optional. Acceptable values for the `aud` field (audience) in the OIDC token. Token exchange requests are rejected if the token audience does not match one of the configured values. Each audience may be at most 256 characters. A maximum of 10 audiences may be configured. If this list is empty, the OIDC token audience must be equal to the full canonical resource name of the WorkloadIdentityPoolProvider, with or without the HTTPS prefix. For example: //iam.googleapis.com/projects/<project-number>/locations/<location>/workloadIdentityPools/<pool-id>/providers/<provider-id> https://iam.googleapis.com/projects/<project-number>/locations/<location>/workloadIdentityPools/<pool-id>/providers/<provider-id> |
| `jwksJson` | `string` Optional. OIDC JWKs in JSON String format. For details on the definition of a JWK, see <https://tools.ietf.org/html/rfc7517>. If not set, the `jwksUri` from the discovery document(fetched from the .well-known path of the `issuerUri`) will be used. Currently, RSA and EC asymmetric keys are supported. The JWK must use following format and include only the following fields: { "keys": \[ { "kty": "RSA/EC", "alg": "", "use": "sig", "kid": "", "n": "", "e": "", "x": "", "y": "", "crv": "" } \] } |

## Saml

Represents an SAML 2.0 identity provider.

| JSON representation |
|---|
| ``` { // Union field `identity_provider` can be only one of the following: "idpMetadataXml": string // End of list of possible types for union field `identity_provider`. } ``` |

| Fields ||
|---|---|
| Union field `identity_provider`. `identity_provider` can be only one of the following: ||
| `idpMetadataXml` | `string` Required. SAML identity provider (IdP) configuration metadata XML doc. The XML document must comply with the [SAML 2.0 specification](https://docs.oasis-open.org/security/saml/v2.0/saml-metadata-2.0-os.pdf). The maximum size of an acceptable XML document is 128K characters. The SAML metadata XML document must satisfy the following constraints: - Must contain an IdP Entity ID. - Must contain at least one non-expired signing certificate. - For each signing certificate, the expiration must be: - From no more than 7 days in the future. - To no more than 25 years in the future. - Up to three IdP signing keys are allowed. When updating the provider's metadata XML, at least one non-expired signing key must overlap with the existing metadata. This requirement is skipped if there are no non-expired signing keys present in the existing metadata. |

## X509

An X.509-type identity provider represents a CA. It is trusted to assert a client identity if the client has a certificate that chains up to this CA.

| JSON representation |
|---|
| ``` { "trustStore": { object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/TrustStore`) } } ``` |

| Fields ||
|---|---|
| `trustStore` | ``object (`https://docs.cloud.google.com/iam/docs/reference/rest/v1/TrustStore`)`` Required. A `https://docs.cloud.google.com/iam/docs/reference/rest/v1/TrustStore`. Use this trust store as a wrapper to config the trust anchor and optional intermediate cas to help build the trust chain for the incoming end entity certificate. Follow the X.509 guidelines to define those PEM encoded certs. Only one trust store is currently supported. |

| ## Methods ||
|---|---|
| ### `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/create` | Creates a new `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider` in a `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools#WorkloadIdentityPool`. |
| ### `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/delete` | Deletes a `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider`. |
| ### `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/get` | Gets an individual `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider`. |
| ### `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/list` | Lists all non-deleted `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider`s in a `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools#WorkloadIdentityPool`. |
| ### `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/patch` | Updates an existing `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider`. |
| ### `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers/undelete` | Undeletes a `https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers#WorkloadIdentityPoolProvider`, as long as it was deleted fewer than 30 days ago. |
