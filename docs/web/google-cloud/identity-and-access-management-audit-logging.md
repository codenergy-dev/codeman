---
title: Identity and Access Management audit logging
url: https://docs.cloud.google.com/iam/docs/audit-logging
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
---

# Identity and Access Management audit logging

Google's page lists every audited method of IAM and is larger than this repository should hold. These are the facts Codeman's documentation relies on, in Codeman's words; each names the section of the page it comes from.

## Facts

- IAM's audit logs have the service name `iam.googleapis.com`; the Logs Explorer shows them with the query `protoPayload.serviceName="iam.googleapis.com"` (Service name).
- A method that needs a permission of type `ADMIN_WRITE` writes an Admin Activity audit log; `ADMIN_READ`, `DATA_READ` and `DATA_WRITE` write Data Access audit logs (Methods by permission type).
- `ADMIN_WRITE` methods include creating, updating, deleting and undeleting workload identity pools and providers (`google.iam.v1.WorkloadIdentityPools.CreateWorkloadIdentityPool`, `UpdateWorkloadIdentityPool`, `DeleteWorkloadIdentityPool`, `UndeleteWorkloadIdentityPool`, and the same with `Provider`), and deleting, undeleting and changing the IAM policy of service accounts (`google.iam.admin.v1.DeleteServiceAccount`, `UndeleteServiceAccount`, `SetIAMPolicy`) (Methods by permission type).
- Reading pools, providers and service accounts (`Get...`, `List...`, `GetIAMPolicy`) is `ADMIN_READ` (Methods by permission type).
- The methods on pools and providers are long-running operations, which usually write two entries: one when the operation starts and one when it ends (Methods by permission type).
- Each method's entry gives its filter, such as `protoPayload.methodName="google.iam.v1.WorkloadIdentityPools.UpdateWorkloadIdentityPoolProvider"` and `protoPayload.methodName="google.iam.admin.v1.SetIAMPolicy"` (API interface audit logs).
