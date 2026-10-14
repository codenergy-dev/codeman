---
title: Cloud Audit Logs overview
url: https://docs.cloud.google.com/logging/docs/audit
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Cloud Audit Logs overview

[Video](https://www.youtube.com/watch?v=dVBBKR3SgDQ)

Google Cloud services write audit logs that record administrative activities
and resource access. You can use Cloud Audit Logs to answer
"who did what, where, and when?" within your Google Cloud resources
with the same level of transparency as in on-premises environments. These
audit logs help your security, auditing, and compliance teams monitor
Google Cloud data and systems for vulnerabilities or data misuse.

## Google Cloud services producing audit logs

For a list of Google Cloud services that provide audit logs, see
[Google Cloud services with audit logs](https://docs.cloud.google.com/logging/docs/audit/services). All
Google Cloud services will eventually provide audit logs.

Google Cloud MCP servers write Data Access audit logs. Data Access audit logs
written by Google Cloud MCP servers API calls are service-specific and use the format
`SERVICE_NAME.googleapis.com/mcp`. You can enable these Data Access logs
by turning on audit logging for `mcp.googleapis.com` in
the [IAM `AuditConfig` object](https://docs.cloud.google.com/logging/docs/audit/configure-data-access#auditconfig_objects).
For more information about audit logging for Google Cloud MCP servers, see
[Google Cloud MCP servers audit logging](https://docs.cloud.google.com/mcp/audit-logging).

For an overview of Google Workspace audit logs, see
[Audit logs for Google Workspace](https://docs.cloud.google.com/logging/docs/audit/gsuite-audit-logging).

## Required roles

To view audit logs, you must have the appropriate
[Identity and Access Management (IAM)](https://docs.cloud.google.com/iam/docs) permissions and roles:


-

  To get the permissions that
  you need to get read-only access to Admin Activity, Policy Denied, and
  System Event audit logs,

  ask your administrator to grant you the
  [Logs Viewer](https://docs.cloud.google.com/iam/docs/roles-permissions/logging#logging.viewer) (`roles/logging.viewer`) IAM role on your project.


  If you have only the Logs Viewer role `(roles/logging.viewer)`, then you
  cannot view Data Access audit logs that are in the `_Default` bucket.


-

  To get the permissions that
  you need to get access to all logs in the `_Required` and `_Default`
  buckets, including Data Access logs,

  ask your administrator to grant you the
  [Private Logs Viewer](https://docs.cloud.google.com/iam/docs/roles-permissions/logging#logging.privateLogViewer) (`roles/logging.privateLogViewer`) IAM role on your project.


  The Private Logs Viewer role `(roles/logging.privateLogViewer)` includes the
  permissions contained in the Logs Viewer role (`roles/logging.viewer`),
  and those necessary to read Data Access audit logs in the `_Default` bucket.

For more information about the IAM permissions and roles that
apply to audit logs data, see
[Access control with IAM](https://docs.cloud.google.com/logging/docs/access-control).

## Types of audit logs

Cloud Audit Logs provides the following audit logs for each
Google Cloud project, folder, and organization:

- [Admin Activity audit logs](https://docs.cloud.google.com/logging/docs/audit#admin-activity)
- [Data Access audit logs](https://docs.cloud.google.com/logging/docs/audit#data-access)
- [System Event audit logs](https://docs.cloud.google.com/logging/docs/audit#system-event)
- [Policy Denied audit logs](https://docs.cloud.google.com/logging/docs/audit#policy_denied)

> [!NOTE]
> **Note:** Log entries written by Cloud Audit Logs are immutable.

### Admin Activity audit logs

Admin Activity audit logs are log entries written by user-driven API calls
or other actions that modify the configuration or metadata of resources. For
example, these logs record when users create VM instances or change Identity and Access Management
permissions.

Admin Activity audit logs are always written; you can't configure, exclude, or
disable them. Even if you disable the Cloud Logging API, Admin Activity audit
logs are still generated.

For a list of services that write Admin Activity audit logs and detailed
information about which activities generate those logs, see
[Google Cloud services with audit logs](https://docs.cloud.google.com/logging/docs/audit/services).

### Data Access audit logs

> [!NOTE]
> **Note:** Data Access audit logs help the Cloud Customer Care team troubleshoot issues with your account. Therefore, we recommend keeping them enabled. For more Cloud Audit Logs best practices, see [Cloud Audit Logs best practices](https://docs.cloud.google.com/logging/docs/audit/best-practices).

Data Access audit logs are log entries written by API calls that read the
configuration or metadata of resources. They are also written by user-driven
API calls that create, modify, or read user-provided resource data.

Publicly available resources that have the Identity and Access Management policies
[`allAuthenticatedUsers`](https://docs.cloud.google.com/iam/docs/principals-overview#allauthenticatedusers) or
[`allUsers`](https://docs.cloud.google.com/iam/docs/principals-overview#allusers) don't generate audit logs. Resources
that can be accessed without logging into a Google Cloud account,
Google Workspace, Cloud Identity, or Drive Enterprise account don't
generate audit logs. This helps protect end-user identities and information.

Except for BigQuery, Data Access audit logs are disabled by default
because they can generate large volumes of data. To record Data Access
audit logs for Google Cloud services other than
BigQuery, you must explicitly enable them. Data Access audit logs
are written to the Google Cloud project whose data is accessed.
Enabling these logs might result in your Google Cloud project being
charged for additional log usage. For instructions on enabling and
configuring Data Access audit logs, see
[Enable Data Access audit logs](https://docs.cloud.google.com/logging/docs/audit/configure-data-access).

For a list of services that write Data Access audit logs and detailed
information about which activities generate those logs, see
[Google Cloud services with audit logs](https://docs.cloud.google.com/logging/docs/audit/services).

Data Access audit logs are stored in the
[`_Default`](https://docs.cloud.google.com/logging/docs/store-log-entries#default-bucket) log bucket unless
you've routed them elsewhere. For more information, see the
[Storing and routing audit logs](https://docs.cloud.google.com/logging/docs/audit#storing_and_routing_audit_logs)
section of this page.

### System Event audit logs

System Event audit logs are log entries written by Google Cloud systems
and managed service agents
that modify the configuration of resources. System Event audit logs aren't
driven by direct user action. For example, a System Event audit log is written
when VMs are automatically added to or removed from managed instance groups
(MIGs) due to autoscaling.

System Event audit logs are always written; you can't configure, exclude, or
disable them.

For a list of services that write System Event audit logs and detailed
information about which activities generate those logs, see
[Google Cloud services with audit logs](https://docs.cloud.google.com/logging/docs/audit/services).

### Policy Denied audit logs

Policy Denied audit logs are log entries written when a Google Cloud service
denies access to a user or [service account](https://docs.cloud.google.com/iam/docs/service-accounts) because of a
security policy violation.

Policy Denied audit logs are generated by default and your
Google Cloud project is charged for log storage. You can't disable Policy
Denied audit logs, but you can use
[exclusion filters](https://docs.cloud.google.com/logging/docs/routing/overview#exclusions) to prevent Policy
Denied audit logs from being stored in Cloud Logging.

For a list of services that write Policy Denied audit logs and detailed
information about which activities generate those logs, see
[Google Cloud services with audit logs](https://docs.cloud.google.com/logging/docs/audit/services).

## Audit log entry structure

Every audit log entry in Cloud Logging is an object of type
[`LogEntry`](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry). What distinguishes an audit log entry from other log
entries is the `protoPayload` field; this field contains an
[`AuditLog`](https://docs.cloud.google.com/logging/docs/audit/api/ref/rest/Shared.Types/AuditLog) object that stores the audit logging data.

To understand how to read and interpret audit log entries, and to view a sample
entry, see [Understanding audit logs](https://docs.cloud.google.com/logging/docs/audit/understanding-audit-logs).

### Log name

Cloud Audit Logs log names include the following:

- Resource identifiers indicating the Google Cloud project or
  other Google Cloud entity that owns the audit logs.

- The string `cloudaudit.googleapis.com`.

- A string that indicates whether the log contains Admin Activity, Data Access,
  Policy Denied, or System Event audit logging data.

The following are the audit log names, including variables for the resource
identifiers:

```sql
   projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Factivity
   projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Fdata_access
   projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Fsystem_event
   projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Fpolicy

   folders/FOLDER_ID/logs/cloudaudit.googleapis.com%2Factivity
   folders/FOLDER_ID/logs/cloudaudit.googleapis.com%2Fdata_access
   folders/FOLDER_ID/logs/cloudaudit.googleapis.com%2Fsystem_event
   folders/FOLDER_ID/logs/cloudaudit.googleapis.com%2Fpolicy

   billingAccounts/BILLING_ACCOUNT_ID/logs/cloudaudit.googleapis.com%2Factivity
   billingAccounts/BILLING_ACCOUNT_ID/logs/cloudaudit.googleapis.com%2Fdata_access
   billingAccounts/BILLING_ACCOUNT_ID/logs/cloudaudit.googleapis.com%2Fsystem_event
   billingAccounts/BILLING_ACCOUNT_ID/logs/cloudaudit.googleapis.com%2Fpolicy

   organizations/ORGANIZATION_ID/logs/cloudaudit.googleapis.com%2Factivity
   organizations/ORGANIZATION_ID/logs/cloudaudit.googleapis.com%2Fdata_access
   organizations/ORGANIZATION_ID/logs/cloudaudit.googleapis.com%2Fsystem_event
   organizations/ORGANIZATION_ID/logs/cloudaudit.googleapis.com%2Fpolicy
```

## Caller identities in audit logs

Audit logs record the identity that performed the logged operations on the
Google Cloud resource. The caller's identity is held in the
`AuthenticationInfo` field of [`AuditLog`](https://docs.cloud.google.com/logging/docs/audit/api/ref/rest/Shared.Types/AuditLog) objects.

Audit logging doesn't redact the caller's principal email address for any
access that succeeds or for any write operation.

For read-only operations that fail with a "permission denied" error,
Audit logging might redact the caller's principal email address unless the
caller is a service account.

In addition to the conditions listed above, the following applies to certain
Google Cloud services:

- [Legacy App Engine API](https://docs.cloud.google.com/appengine/docs): Identities aren't collected.

<!-- -->

- [BigQuery](https://docs.cloud.google.com/bigquery/docs/reference/auditlogs#ids): Caller
  identities and IP addresses, as well as some resource names, are redacted
  from the audit logs, unless certain conditions are met.

- [Cloud Storage](https://docs.cloud.google.com/storage/docs/access-logs): When Cloud Storage
  usage logs are enabled, Cloud Storage writes usage data to the
  Cloud Storage bucket, which generates Data Access audit logs for the
  bucket. The generated Data Access audit log has its caller identity
  redacted.

<!-- -->

- [Firestore](https://docs.cloud.google.com/firestore/docs/audit-logging): If a JSON Web Token (JWT) was used for third-party authentication, then the `thirdPartyPrincipal` field includes the token's header and payload. For example, audit logs for requests authenticated with [Firebase Authentication](https://firebase.google.com/docs/auth) include that request's [auth token](https://firebase.google.com/docs/auth/users#auth_tokens).

<!-- -->

- [VPC Service Controls](https://docs.cloud.google.com/vpc-service-controls/docs/audit-logging): For
  Policy Denied audit logs, the following redaction occurs:

  - Parts of the caller email addresses might be redacted and replaced by
    three period characters `...`.

  - Some caller email addresses belonging to the domain `google.com` are
    redacted and replaced by `google-internal`.

<!-- -->

- [Organization Policy](https://docs.cloud.google.com/resource-manager/docs/organization-policy/audit-logging): Parts of the caller email addresses might be redacted and replaced by three period characters `...`.

## IP address of the caller in audit logs

The IP address of the caller is held in the `RequestMetadata.callerIp` field of
the [`AuditLog`](https://docs.cloud.google.com/logging/docs/audit/api/ref/rest/Shared.Types/AuditLog) object:

- For a caller from the internet, the address is a public IPv4 or IPv6 address.
- For calls made from inside the internal production network from one Google Cloud service to another, the `callerIp` is redacted to "private". This includes calls made by Google-owned service accounts (service agents) even when initiated by a user, or calls initiated by Google's internal infrastructure.
- For a caller from a Compute Engine VM with an external IP address, the `callerIp` is the external address of the VM. This applies to both standard VMs and Google-managed VMs, such as Google Kubernetes Engine nodes. In multi-service flows, such as Cloud Logging calling Cloud KMS, the service propagates the immediate caller's origin unless explicit identity delegation is configured. As a result, an external address might appear instead of "private".
- For a caller from a Compute Engine VM without an external IP address, if the VM is in the same organization or project as the accessed resource, then `callerIp` is the VM's internal IPv4 address. Otherwise, the `callerIp` is redacted to "gce-internal-ip". For more information, see [VPC network overview](https://docs.cloud.google.com/compute/docs/vpc).

## Viewing audit logs

You can query for all audit logs or you can query for logs by their
audit log name. The audit log name includes the
[resource identifier](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifying_projects)
of the Google Cloud project, folder, billing account, or
organization for which you want to view audit logging information.
Your queries can specify indexed [`LogEntry`](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry) fields.
For more information about querying your logs, see
[Build queries in the Logs Explorer](https://docs.cloud.google.com/logging/docs/view/building-queries)

The Logs Explorer lets you view filter individual log entries. If you want
to use SQL to analyze groups of log entries, then use the **Log Analytics**
page. For more information, see:

- [Query and view logs in Observability Analytics](https://docs.cloud.google.com/logging/docs/analyze/query-and-view).
- [Sample queries for security insights](https://docs.cloud.google.com/logging/docs/analyze/analyze-audit-logs).
- [Chart query results](https://docs.cloud.google.com/logging/docs/analyze/charts).

Most audit logs can be viewed in Cloud Logging by using the
Google Cloud console, the Google Cloud CLI, or the Logging API.
However, for audit logs related to billing, you can only use the
Google Cloud CLI or the Logging API.

### Console

In the Google Cloud console, you can use the Logs Explorer
to retrieve your audit log entries for your Google Cloud project, folder,
or organization:

1. In the Google Cloud console, go to the

   **Logs Explorer** page:

   [Go to **Logs Explorer**](https://console.cloud.google.com/logs/query)

   <br />

   If you use the search bar to find this page, then select the result whose subheading is
   **Logging**.
2. Select an existing Google Cloud project, folder, or organization.

3. To display all audit logs, enter either of the following queries
   into the query-editor field, and then click **Run query**:

   ```
   logName:"cloudaudit.googleapis.com"
   ```

   ```
   protoPayload."@type"="type.googleapis.com/google.cloud.audit.AuditLog"
   ```
4. To display the audit logs for a specific resource and audit log type,
   in the **Query builder** pane, do the following:

   - In **Resource type**, select the Google Cloud resource whose
     audit logs you want to see.

   - In **Log name**, select the audit log type that you want to see:

     - For Admin Activity audit logs, select **activity**.
     - For Data Access audit logs, select **data_access**.
     - For System Event audit logs, select **system_event**.
     - For Policy Denied audit logs, select **policy**.
   - Click **Run query**.

   If you don't see these options, then there aren't any audit logs of
   that type available in the Google Cloud project, folder, or
   organization.

   If you're experiencing issues when trying to view logs in the
   Logs Explorer, see the
   [troubleshooting](https://docs.cloud.google.com/logging/docs/view/logs-explorer-interface#troubleshooting)
   information.

   For more information about querying by using the Logs Explorer, see
   [Build queries in the Logs Explorer](https://docs.cloud.google.com/logging/docs/view/building-queries).

### gcloud

The Google Cloud CLI provides a command-line interface to the
Logging API. Supply a valid resource identifier in each of the log
names. For example, if your query includes a <var translate="no">PROJECT_ID</var>, then the
project identifier you supply must refer to the currently selected
Google Cloud project.

To read your Google Cloud project-level audit log entries, run
the following command:

```
gcloud logging read "logName : projects/PROJECT_ID/logs/cloudaudit.googleapis.com" \
    --project=PROJECT_ID
```

To read your folder-level audit log entries, run the following command:

```
gcloud logging read "logName : folders/FOLDER_ID/logs/cloudaudit.googleapis.com" \
    --folder=FOLDER_ID
```

To read your organization-level audit log entries, run the following
command:

```
gcloud logging read "logName : organizations/ORGANIZATION_ID/logs/cloudaudit.googleapis.com" \
    --organization=ORGANIZATION_ID
```

To read your Cloud Billing account-level audit log entries, run the following command:

```
gcloud logging read "logName : billingAccounts/BILLING_ACCOUNT_ID/logs/cloudaudit.googleapis.com" \
    --billing-account=BILLING_ACCOUNT_ID
```

Add the [`--freshness` flag](https://docs.cloud.google.com/sdk/gcloud/reference/logging/read#--freshness)
to your command to read logs that are more than 1 day old.

For more information about using the gcloud CLI, see
[`gcloud logging read`](https://docs.cloud.google.com/sdk/gcloud/reference/logging/read).

### REST

When building your queries, supply a valid resource identifier in each of
the log names. For example, if your query includes a <var translate="no">PROJECT_ID</var>,
then the project identifier you supply must refer to the currently selected
Google Cloud project.

For example, to use the Logging API to view your project-level
audit log entries, do the following:

1. Go to the **Try this API** section in the documentation for the
   [`entries.list`](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list) method.

2. Put the following into the **Request body** part of the **Try this
   API** form. Clicking this [prepopulated form](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list?apix_params=%7B%22resource%22:%7B%22resourceNames%22:%5B%22projects/%5BPROJECT_ID%5D%22%5D,%22pageSize%22:5,%22filter%22:%22logName%3D(projects/%5BPROJECT_ID%5D/logs/cloudaudit.googleapis.com%252Factivity+OR+projects/%5BPROJECT_ID%5D/logs/cloudaudit.googleapis.com%252Fsystem_events+OR+projects/%5BPROJECT_ID%5D/logs/cloudaudit.googleapis.com%252Fdata_access)%22%7D%7D)
   automatically fills the request body, but you need to supply a valid
   <var translate="no">PROJECT_ID</var> in each of the log names.

   ```
   {
     "resourceNames": [
       "projects/PROJECT_ID"
     ],
     "pageSize": 5,
     "filter": "logName : projects/PROJECT_ID/logs/cloudaudit.googleapis.com"
   }
   ```
3. Click **Execute**.

## Storing and routing audit logs

Cloud Logging uses [log buckets](https://docs.cloud.google.com/logging/docs/store-log-entries) as
containers that store and organize your logs data. For each billing account,
Google Cloud project, folder, and organization, Logging
automatically creates two log buckets, `_Required` and `_Default`, and
correspondingly named [sinks](https://docs.cloud.google.com/logging/docs/routing/overview#sinks).

Cloud Logging `_Required` buckets store Admin Activity audit logs
and System Event audit logs. You can't prevent Admin Activity or System Event
audit logs from being stored. You also can't configure the sink that routes
log entries to the `_Required` buckets.

Admin Activity audit logs and System Event audit logs are always stored in the
`_Required` bucket in the project where the logs were generated.

If you route Admin Activity audit logs and System Event audit logs to a
different project, then those logs don't pass through the destination
project's `_Default` or `_Required` sink. Consequently, the logs aren't stored
in the destination project.
To store these logs, create a log sink in the destination project.
For more information, see [Route logs to supported destinations](https://docs.cloud.google.com/logging/docs/export/configure_export_v2).

The `_Default` buckets, by default, store any enabled Data Access
audit logs as well as Policy Denied audit logs. To prevent Data Access audit
logs from being stored in the `_Default` buckets, you can disable them. To
prevent any Policy Denied audit logs from being stored in the `_Default`
buckets, you can exclude them by modifying their sinks' filters.

You can also route your audit log entries to user-defined
Cloud Logging buckets at the Google Cloud project level or to supported
destinations outside of Logging using sinks. For instructions
on routing logs, see
[Route logs to supported destinations](https://docs.cloud.google.com/logging/docs/export/configure_export_v2).

When configuring your log sinks' filters, you need to specify the audit log
types you want to route; for filtering examples, see
[Security logging queries](https://docs.cloud.google.com/logging/docs/view/query-library#security-filters).

For information about routing audit log entries for a Google Cloud
organization, folder, or billing account, and for their children, see
[Aggregated sinks overview](https://docs.cloud.google.com/logging/docs/export/aggregated_sinks_overview).

## Audit log retention

For details on how long log entries are retained by Logging,
see the retention information in
[Quotas and limits: Logs retention periods](https://docs.cloud.google.com/logging/quotas#logs_retention_periods).

## Access control

IAM permissions and roles determine your ability to access audit
logs data in the [Logging API](https://docs.cloud.google.com/logging/docs/reference/v2/rest), the
[Logs Explorer](https://docs.cloud.google.com/logging/docs/view/logs-explorer-interface), and the
[Google Cloud CLI](https://docs.cloud.google.com/logging/docs/reference/tools/gcloud-logging).

For detailed information about the IAM permissions and roles you
might need, see [Access control with IAM](https://docs.cloud.google.com/logging/docs/access-control).

## Quotas and limits

For details on logging usage limits, including the maximum sizes of audit logs,
see [Quotas and limits](https://docs.cloud.google.com/logging/quotas).

## Pricing

For pricing information, see [Google Cloud Observability pricing](https://cloud.google.com/products/observability/pricing) page. If you route log data to
other Google Cloud services, then see the following documents:

- [Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [BigQuery pricing](https://cloud.google.com/bigquery/pricing#data_ingestion_pricing)
- [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing)

## What's next

- Learn how to [read and understand audit logs](https://docs.cloud.google.com/logging/docs/audit/understanding-audit-logs).
- Learn how to [enable Data Access audit logs](https://docs.cloud.google.com/logging/docs/audit/configure-data-access).
- Review [best practices](https://docs.cloud.google.com/logging/docs/audit/best-practices) for Cloud Audit Logs.

<!-- -->

- Learn about [Access Transparency](https://docs.cloud.google.com/assured-workloads/access-transparency/docs/overview), which provides logs of actions taken by Google Cloud staff when accessing your Google Cloud content.