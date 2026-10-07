---
title: Identity and Access Management (IAM)
url: https://firebase.google.com/docs/firestore/security/iam
created_at: 2026-10-07T15:14:09-03:00
updated_at: 2026-10-07T15:14:09-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Identity and Access Management (IAM)

When you use the server client libraries for Cloud Firestore, you can manage
access to your resources with Identity and Access Management (IAM).
IAM lets you give more granular access to specific Google Cloud resources and
prevents unwanted access to other resources. This page describes the IAM
permissions and roles for Cloud Firestore. For a detailed description of
IAM, read the [IAM documentation](https://cloud.google.com/iam/docs/).

IAM lets you adopt the
[security principle of least privilege](https://wikipedia.org/wiki/Principle_of_least_privilege),
so you grant only the necessary access to your resources.

IAM lets you control **who (user)** has **what (role)**
permission for **which** resources by setting IAM policies.
IAM policies grant one or more roles to a user, giving the
user certain permissions. For example, you can grant the `datastore.indexAdmin`
role to a user, which allows the user to create, modify, delete, list, or view
indexes.

## Permissions and roles

This section summarizes the permissions and roles that Cloud Firestore
supports.

> [!NOTE]
> **Note:** Some Cloud Firestore permissions differ from the standard IAM model permissions. For example, in the IAM model, the `datastore.databases.get` permission lets you return a database object while, in Cloud Firestore, `datastore.databases.get` lets you begin or roll back a transaction. To retrieve a database object's information, use the `datastore.databases.getMetadata` permission.
>
>
> The `datastore.schemas.*` permissions were previously named
> `datastore.indexes.*`. You can still use `datastore.indexes`
> as an alias for `datastore.schemas`.

### Required permissions for API methods

The following table lists the permissions that the caller must have to perform
each action:

| Method | Required permissions |
|---|---|
| `projects.databases.documents` ||
| [`batchGet`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/batchGet) | `datastore.entities.get` |
| [`batchWrite`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/batchWrite) update or transform with [exists precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) set to `false` | `datastore.entities.create` |
| [`batchWrite`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/batchWrite) update or transform with [exists precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) set to `true` | `datastore.entities.create` |
| [`batchWrite`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/batchWrite) update or transform with no [precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) | `datastore.entities.create datastore.entities.update` |
| [`beginTransaction`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/beginTransaction) | `datastore.databases.get` |
| [`commit`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/commit) update or transform with [exists precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) set to `false` | `datastore.entities.create` |
| [`commit`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/commit) update or transform with [exists precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) set to `true` | `datastore.entities.update` |
| [`commit`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/commit) update or transform with no [precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) | `datastore.entities.create datastore.entities.update` |
| [`commit`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/commit) delete | `datastore.entities.delete` |
| [`createDocument`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/createDocument) | `datastore.entities.create` |
| [`delete`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/delete) | `datastore.entities.delete` |
| [`get`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/get) | `datastore.entities.get` |
| [`list`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/list) | `datastore.entities.get` `datastore.entities.list` |
| [`listCollectionIds`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/listCollectionIds) | `datastore.entities.list` |
| [`partitionQuery`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/partitionQuery) | `datastore.entities.get datastore.entities.list` |
| [`patch`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/patch) | `datastore.entities.update` |
| [`rollback`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/rollback) | `datastore.databases.get` |
| [`runAggregationQuery`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/runAggregationQuery) | `datastore.entities.get datastore.entities.list` |
| [`runQuery`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/runQuery) | `datastore.entities.get datastore.entities.list` |
| [`executePipeline (RPC)`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/executePipeline) with any of the following stages: - `collection(...)` - `collection_group(...)` - `database()` | `datastore.entities.get datastore.entities.list` |
| [`executePipeline (RPC)`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/executePipeline) with any of the following stages: - `documents(...)` | `datastore.entities.get` |
| [`executePipeline (RPC)`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/executePipeline) with any of the following stages: - `update(...)` | `datastore.entities.update` |
| [`executePipeline (RPC)`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.documents/executePipeline) with any of the following stages: - `delete(...)` | `datastore.entities.delete` |
| [`write (RPC)`](https://firebase.google.com/docs/firestore/reference/rpc/google.firestore.v1#write) update or transform with [exists precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) set to `false` | `datastore.entities.create` |
| [`write (RPC)`](https://firebase.google.com/docs/firestore/reference/rpc/google.firestore.v1#write) update or transform with [exists precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) set to `true` | `datastore.entities.update` |
| [`write (RPC)`](https://firebase.google.com/docs/firestore/reference/rpc/google.firestore.v1#write) update or transform with no [precondition](https://firebase.google.com/docs/firestore/reference/rest/latest/Precondition) | `datastore.entities.create datastore.entities.update` |
| [`write (RPC)`](https://firebase.google.com/docs/firestore/reference/rpc/google.firestore.v1#write) delete | `datastore.entities.delete` |
| `projects.databases.indexes` ||
| [`create`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.indexes/create) | `datastore.schemas.create` |
| [`delete`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.indexes/delete) | `datastore.schemas.delete` |
| [`get`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.indexes/get) | `datastore.schemas.get` |
| [`list`](https://firebase.google.com/docs/firestore/reference/rest/latest/projects.databases.indexes/list) | `datastore.schemas.list` |
| `projects.databases` ||
| [`create`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/create) | `datastore.databases.create` If your `create` request contains a `tags` value, then the following additional permissions are required: - `datastore.databases.createTagBinding` If you would like to verify whether the tag bindings are set successfully by listing the bindings, then the following additional permissions are required: - `datastore.databases.listTagBindings` - `datastore.databases.listEffectiveTags` |
| [`delete`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/delete) | `datastore.databases.delete` |
| [`get`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/get) | `datastore.databases.getMetadata` |
| [`list`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/list) | `datastore.databases.list` |
| [`patch`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/patch) | `datastore.databases.update` |
| restore | `datastore.backups.restoreDatabase` |
| [`clone`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases/clone) | `datastore.databases.clone` If your `clone` request contains a `tags` value, then the following additional permissions are required: - `datastore.databases.createTagBinding` If you would like to verify whether the tag bindings are set successfully by listing the bindings, then the following additional permissions are required: - `datastore.databases.listTagBindings` - `datastore.databases.listEffectiveTags` |
| `projects.locations` ||
| [`get`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.locations/get) | `datastore.locations.get` |
| [`list`](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.locations/list) | `datastore.locations.list` |
| `projects.databases.backupschedules` ||
| get | `datastore.backupSchedules.get` |
| list | `datastore.backupSchedules.list` |
| create | `datastore.backupSchedules.create` |
| update | `datastore.backupSchedules.update` |
| delete | `datastore.backupSchedules.delete` |
| `projects.locations.backups` ||
| get | `datastore.backups.get` |
| list | `datastore.backups.list` |
| delete | `datastore.backups.delete` |

### Predefined roles

With IAM, every API method in Cloud Firestore
requires that the account making the API request has the appropriate permissions
to use the resource. Permissions are granted by setting policies that grant
roles to a user, group, or service account. In addition to the primitive roles,
[owner, editor, and viewer](https://cloud.google.com/iam/docs/understanding-roles#primitive_roles),
you can grant Cloud Firestore roles to the users of your project.

The following table lists the Cloud Firestore IAM
roles. You can grant multiple roles to a user, group, or service account.

| Role | Permissions | Description |
|---|---|---|
| `roles/datastore.owner` | `appengine.applications.get` `datastore.*` `resourcemanager.projects.get` `resourcemanager.projects.list` | Full access to Cloud Firestore. |
| `roles/datastore.user` | `appengine.applications.get` `datastore.databases.get` `datastore.databases.getMetadata` `datastore.databases.list` `datastore.entities.*` `datastore.schemas.list` `datastore.namespaces.get` `datastore.namespaces.list` `datastore.statistics.get` `datastore.statistics.list` `resourcemanager.projects.get` `resourcemanager.projects.list` | Read/write access to data in a Cloud Firestore database. Intended for application developers and service accounts. |
| `roles/datastore.viewer` | `appengine.applications.get` `datastore.databases.get` `datastore.databases.getMetadata` `datastore.databases.list` `datastore.entities.get` `datastore.entities.list` `datastore.schemas.get` `datastore.schemas.list` `datastore.namespaces.get` `datastore.namespaces.list` `datastore.statistics.get` `datastore.statistics.list` `resourcemanager.projects.get` `resourcemanager.projects.list` `datastore.insights.get` | Read access to all Cloud Firestore resources. |
| `roles/datastore.importExportAdmin` | `appengine.applications.get` `datastore.databases.export` `datastore.databases.getMetadata` `datastore.databases.import` `datastore.operations.cancel` `datastore.operations.get` `datastore.operations.list` `resourcemanager.projects.get` `resourcemanager.projects.list` | Full access to manage imports and exports. |
| `roles/datastore.bulkAdmin` | `resourcemanager.projects.get` `resourcemanager.projects.list` `datastore.databases.getMetadata` `datastore.databases.bulkDelete` `datastore.operations.cancel` `datastore.operations.get` `datastore.operations.list` | Full access to manage bulk operations. |
| `roles/datastore.indexAdmin` | `appengine.applications.get` `datastore.databases.getMetadata` `datastore.schemas.*` `datastore.operations.list` `datastore.operations.get` `resourcemanager.projects.get` `resourcemanager.projects.list` | Full access to manage index definitions. |
| `roles/datastore.keyVisualizerViewer` | `datastore.databases.getMetadata` `datastore.keyVisualizerScans.get` `datastore.keyVisualizerScans.list` `resourcemanager.projects.get` `resourcemanager.projects.list` | Full access to Key Visualizer scans. |
| `roles/datastore.backupSchedulesViewer` | `datastore.backupSchedules.get` `datastore.backupSchedules.list` | Read access to backup schedules in a Cloud Firestore database. |
| `roles/datastore.backupSchedulesAdmin` | `datastore.backupSchedules.get` `datastore.backupSchedules.list` `datastore.backupSchedules.create` `datastore.backupSchedules.update` `datastore.backupSchedules.delete` `datastore.databases.list` `datastore.databases.getMetadata` | Full access to backup schedules in a Cloud Firestore database. |
| `roles/datastore.backupsViewer` | `datastore.backups.get` `datastore.backups.list` | Read access to backup information in a Cloud Firestore location. |
| `roles/datastore.backupsAdmin` | `datastore.backups.get` `datastore.backups.list` `datastore.backups.delete` | Full access to backups in a Cloud Firestore location. |
| `roles/datastore.restoreAdmin` | `datastore.backups.get` `datastore.backups.list` `datastore.backups.restoreDatabase` `datastore.databases.list` `datastore.databases.create` `datastore.databases.getMetadata` `datastore.operations.list` `datastore.operations.get` | Ability to restore a Cloud Firestore backup into a new database. This role also gives the ability to create new databases, not necessarily by restoring from a backup. |
| `roles/datastore.cloneAdmin` | `datastore.databases.clone` `datastore.databases.list` `datastore.databases.create` `datastore.databases.getMetadata` `datastore.operations.list` `datastore.operations.get` | Ability to clone a Cloud Firestore database into a new database. This role also gives the ability to create new databases, not necessarily by cloning. |
| `roles/datastore.statisticsViewer` | `resourcemanager.projects.get` `resourcemanager.projects.list` `datastore.databases.getMetadata` `datastore.insights.get` `datastore.keyVisualizerScans.get` `datastore.keyVisualizerScans.list` `datastore.statistics.list` `datastore.statistics.get` | Read access to Insights, Stats, and Key Visualizer scans. |

### Custom roles

If the predefined roles don't address your business requirements,
you can define your own custom roles with permissions that
you specify:

- [Learn about custom roles.](https://firebase.google.com/iam/docs/understanding-custom-roles)
- [Create and manage custom roles.](https://cloud.google.com/iam/docs/creating-custom-roles)

#### Required roles to create and manage tags

If any tag is represented in create or restore actions, some roles are required. See [Creating and managing tags](https://firebase.google.com/resource-manager/docs/tags/tags-creating-and-managing) for more details on creating tag key-value pairs before associate them to the database resources.

The following listed permissions are required.

##### View tags

- `datastore.databases.listTagBindings`
- `datastore.databases.listEffectiveTags`

##### Manage tags on resources

The following permission is required for the database resource you're attaching the tag value.

- `datastore.databases.createTagBinding`

### Permissions

The following table lists the permissions that Cloud Firestore supports.

| Database permission name | Description |   |
|---|---|---|
| `datastore.databases.get` | Begin or rollback a transaction. |   |
| `datastore.databases.import` | Import entities into a database. |   |
| `datastore.databases.export` | Export entities from a database. |   |
| `datastore.databases.bulkDelete` | Bulk delete entities from a database. |   |
| `datastore.databases.getMetadata` | Read metadata from a database. |   |
| `datastore.databases.list` | List databases in a project. |   |
| `datastore.databases.create` | Create a database. |   |
| `datastore.databases.update` | Update a database. |   |
| `datastore.databases.delete` | Delete a database. |   |
| `datastore.databases.clone` | Clone a database. |   |
| `datastore.databases.createTagBinding` | Create a tag binding for a database. |   |
| `datastore.databases.deleteTagBinding` | Delete a tag binding for a database. |   |
| `datastore.databases.listTagBindings` | List all tag bindings for a database. |   |
| `datastore.databases.listEffectiveTagBindings` | List effective tag bindings for a database. |   |
| `datastore.entities.create` | Create a document. |   |
| `datastore.entities.delete` | Delete a document. |   |
| `datastore.entities.get` | Read a document. |   |
| `datastore.entities.list` | List the names of documents in a project. (`datastore.entities.get` is required to access the document data.) |   |
| `datastore.entities.update` | Update a document. |   |
| `datastore.schemas.create` | Create an index. |   |
| `datastore.schemas.delete` | Delete an index. |   |
| `datastore.schemas.get` | Read metadata from an index. |   |
| `datastore.schemas.list` | List the indexes in a project. |   |
| `datastore.schemas.update` | Update an index. |   |
| `datastore.operations.cancel` | Cancel a long-running operation. |   |
| `datastore.operations.delete` | Delete a long-running operation. |   |
| `datastore.operations.get` | Gets the latest state of a long-running operation. |   |
| `datastore.operations.list` | List long-running operations. |   |
| `resourcemanager.projects.get` | Browse resources in the project. |   |
| `resourcemanager.projects.list` | List owned projects. |   |
| `datastore.locations.get` | Get details about a database location. Required to create a new database. |   |
| `datastore.locations.list` | List available database locations. Required to create a new database. |   |
| `datastore.keyVisualizerScans.get` | Get details about Key Visualizer scans. |   |
| `datastore.keyVisualizerScans.list` | List available Key Visualizer scans. |   |
| `datastore.backupSchedules.get` | Get details about a backup schedule. |   |
| `datastore.backupSchedules.list` | List available backup schedules. |   |
| `datastore.backupSchedules.create` | Create a backup schedule. |   |
| `datastore.backupSchedules.update` | Update a backup schedule. |   |
| `datastore.backupSchedules.delete` | Delete a backup schedule. |   |
| `datastore.backups.get` | Get details about a backup. |   |
| `datastore.backups.list` | List available backups. |   |
| `datastore.backups.delete` | Delete a backup. |   |
| `datastore.backups.restoreDatabase` | Restore a database from a backup. |   |
| `datastore.insights.get` | Get insights of a resource |   |

## Role change latency

Cloud Firestore caches IAM permissions for 5 minutes,
so it takes up to 5 minutes for a role change to become effective.

## Manage Cloud Firestore IAM

You can get and set IAM policies using the Google Cloud console,
the IAM API, or the
`gcloud` command-line tool. See
[Granting, Changing, and Revoking Access to Project Members](https://cloud.google.com/iam/docs/granting-changing-revoking-access)
for details.

## Configure conditional access permissions

You can use [IAM Conditions](https://cloud.google.com/iam/docs/conditions-overview) to
define and enforce conditional access control.

For example, the following condition assigns a principal the `datastore.user`
role up until a specified date:

    {
      "role": "roles/datastore.user",
      "members": [
        "user:travis@example.com"
      ],
      "condition": {
        "title": "Expires_December_1_2023",
        "description": "Expires on December 1, 2023",
        "expression":
          "request.time < timestamp('2023-12-01T00:00:00.000Z')"
      }
    }

To learn how to define IAM Conditions for temporary access,
see [Configure temporary access](https://cloud.google.com/iam/docs/configuring-temporary-access).

To learn how to configure IAM Conditions for access to one or more
databases, see
[Configure database access conditions](https://firebase.google.com/docs/firestore/enterprise/manage-databases#configure_database_access_conditions).

## Security rule dependency on IAM

[Cloud Firestore Security Rules](https://firebase.google.com/firestore/docs/security/get-started) for
mobile/web clients depend on the following service account
and IAM binding:

| Service account | IAM role |
|---|---|
| `service-project_number@firebase-rules.iam.gserviceaccount.com` | `roles/firebaserules.system` |

Firebase automatically sets up this service account for you. If you
remove the `firebaserules.system` role from this service account, your security
rules will deny all requests. To restore this IAM binding,
use the following [gcloud CLI](https://cloud.google.com/sdk) command:

```
gcloud projects add-iam-policy-binding project_id \
--member=serviceAccount:service-project_number@firebase-rules.iam.gserviceaccount.com \
--role=roles/firebaserules.system
```

To determine your <var translate="no">project_id</var> and <var translate="no">project_number</var>, see
[Identifying projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects#identifying_projects).

Use the Google Cloud CLI instead of the Google Cloud console,
because the`firebaserules.system` role is hidden in the console by default.

## What's next

- Learn more about [IAM](https://cloud.google.com/iam/docs/).
- [Grant IAM roles](https://cloud.google.com/iam/docs/granting-changing-revoking-access).
- Learn about [authentication](https://cloud.google.com/firestore/docs/authentication).
