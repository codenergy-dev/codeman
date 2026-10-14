---
title: Manage databases
url: https://firebase.google.com/docs/firestore/manage-databases
created_at: 2026-10-14T18:04:35-03:00
updated_at: 2026-10-14T18:04:35-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Manage databases

[Video](https://www.youtube.com/watch?v=Lx6pf2Bq5Hw)

This page describes how to create, update, and delete Cloud Firestore
databases. You can create multiple Cloud Firestore databases per project. You
can use multiple databases to set up production and testing environments, to
isolate customer data, and for data regionalization.

## Required roles and permissions

To create and manage databases, you'll need the following Identity and Access Management role:

- [Cloud Datastore Owner](https://firebase.google.com/iam/docs/roles-permissions/firestore#datastore.owner) (`roles/datastore.owner`)

That role grants the following permissions that you need to create and manage
databases:

- Create a database: `datastore.databases.create`
- Read database configuration: `datastore.databases.getMetadata`
- Configure a database: `datastore.databases.update`
- Delete a database: `datastore.databases.delete`
- Clone a database: `datastore.databases.clone`

## Create a database

To create a database, use one of the following methods:

##### Console

##### Firebase console

1. In the Firebase console, go to
   **Databases \& Storage** \> **Firestore**.

   [Go to Firestore](https://console.firebase.google.com/project/_/firestore/databases)
2. Click **Add database**.
3. Select **Standard edition** . Click **Next**.
4. Enter a Database ID.
5. Select a location for your database. Click **Next**.
6. Select a starting mode for your Cloud Firestore Security Rules:

   Test mode
   :   Good for getting started with the mobile and web client libraries, but
       allows anyone to read and overwrite your data. After testing, **make
       sure to review the [Secure your data](https://firebase.google.com/docs/firestore/enterprise/security/overview)
       section.**

   Production mode
   :   Denies all reads and writes from mobile and web clients. Your
       authenticated application servers (Node.js, Python, Java) can still
       access your database
7. Click **Create**.

##### gcloud

Use the
[`gcloud firestore databases create`](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/create)
command.

- To create a Cloud Firestore Standard edition database:

  ```
  gcloud firestore databases create \
  --database=DATABASE_ID \
  --location=LOCATION \
  --edition=standard
  --type=DATABASE_TYPE
  ```

  Replace the following:
  - <var translate="no">DATABASE_ID</var>: a [valid database ID](https://firebase.google.com/docs/firestore/manage-databases#database_id).
  - <var translate="no">LOCATION</var>: the name of a [Cloud Firestore multi-region or
    region](https://firebase.google.com/docs/firestore/locations#types).
  - <var translate="no">DATABASE_TYPE</var>: either `firestore-native` for Native mode or `datastore-mode` for Datastore mode.

`--delete-protection` is an optional flag to enable deletion protection.
You cannot delete a database with deletion protection enabled until you
disable this setting. This setting is disabled by default.

To add [tags](https://cloud.google.com/firestore/docs/tags)
to the database, use the
[`--tags`](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/create#--tags)
flag. For example:

- `--tags=123/environment=production,123/costCenter=marketing`
- `--tags=tagKeys/333=tagValues/444`

##### Firebase CLI

```
firebase firestore:databases:create DATABASE_ID \n--location=LOCATION \n[--edition EDITION] \n[--firestore-data-access FIRESTORE_ACCESS] \n[--realtime-updates REALTIME_UPDATES] \n[--delete-protection DELETE_PROTECTION_ENABLEMENT]
```

Replace the following:

- <var translate="no">DATABASE_ID</var>: a [valid database ID](https://firebase.google.com/docs/firestore/manage-databases#database_id).
- <var translate="no">LOCATION</var>: the name of a [Cloud Firestore multi-region or region](https://firebase.google.com/docs/firestore/locations#types).
- <var translate="no">EDITION</var>: For Enterprise features, set to `enterprise`.
- <var translate="no">FIRESTORE_ACCESS</var>: (Enterprise only) `ENABLED` or `DISABLED`.
- <var translate="no">REALTIME_UPDATES</var>: (Enterprise only) `ENABLED` or `DISABLED`.
- <var translate="no">DELETE_PROTECTION_ENABLEMENT</var>: Either `ENABLED` or `DISABLED`.

##### Terraform

```terraform
resource "google_firestore_database" "database" {
  project     = "project-id"
  name        = DATABASE_ID
  location_id = LOCATION
  type        = DATABASE_TYPE

  // Optional
  delete_protection_state = DELETE_PROTECTION_STATE
}
```

Replace the following:

- <var translate="no">DATABASE_ID</var>: a [valid database ID](https://firebase.google.com/docs/firestore/manage-databases#database_id).
- <var translate="no">LOCATION</var>: the name of a [Cloud Firestore multi-region or region](https://firebase.google.com/docs/firestore/locations#types).
- <var translate="no">DATABASE_TYPE</var>: either `FIRESTORE_NATIVE` for Native mode or `DATASTORE_MODE` for Datastore mode.
- <var translate="no">DELETE_PROTECTION_ENABLEMENT</var>: Either `DELETE_PROTECTION_ENABLED` or `DELETE_PROTECTION_DISABLED`.


`delete_protection_state` is an optional argument to enable deletion
protection. You cannot delete a database with deletion protection enabled
until you disable this setting. This setting is disabled by default.

### Database ID

A valid database Id must conform to these rules:

- Only include letters, numbers, and hyphen (`-`) characters.
- Letters must be lowercase.
- The first character must be a letter.
- The last character must be a letter or number.
- Minimum of 4 characters.
- Maximum of 63 characters.
- Must not be a UUID or resemble a UUID. For example, don't use an ID like `f47ac10b-58cc-0372-8567-0e02b2c3d479`.

There is one exception to these rules: Standard edition will create
a database named `(default)` if you don't enter an ID yourself.

Note that after you delete a database, you can't re-use its ID for about 5
minutes.

### Delete protection

Use delete protection to prevent accidental deletion of a database. You cannot
delete a database with delete protection enabled until you disable delete
protection. Delete protection is disabled by default. You can update the
database configuration to [enable or disable delete protection](https://firebase.google.com/docs/firestore/manage-databases#update-dp).

## Set up Cloud Firestore Security Rules for your databases

Use the Firebase CLI to deploy Cloud Firestore Security Rules to each of your
databases. Refer to the [guide for managing and deploying Cloud Firestore Security Rules](https://firebase.google.com/docs/rules/manage-deploy).


## Access a named database with a client library

A named database includes any database not named `(default)`. By default, the
Firebase SDKs and Google API Client Libraries connect to the `(default)`
Cloud Firestore database in a project. To create a client connected to
a named database, set the database ID when you instantiate a client.

> [!NOTE]
> **Note:** To work with multiple databases, be sure to update to the latest [Firebase Client SDKs](https://firebase.google.com/docs/firestore/client/libraries#mobile-web-sdks) and [Google API Client Libraries](https://firebase.google.com/docs/firestore/client/libraries#google-cloud-client-libraries) .

## List databases

Use one of the following methods to list your databases:

##### Console

In the Google Cloud console, go to the **Databases** page.

[Go to Databases](https://console.cloud.google.com/firestore/databases)
**Note:** You can view and list your databases in the Google Cloud console. You can create the `(default)` database using the Google Cloud console, but you must use the [Google Cloud CLI or another method](https://firebase.google.com/docs/firestore/manage-databases#create_a_database) to create a named database. To delete a database [use the Google Cloud CLI](https://firebase.google.com/docs/firestore/manage-databases#delete-database).

##### gcloud


Use the
[`gcloud firestore databases list`](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/list)
command to list all the databases in your project.

```
gcloud firestore databases list
```

##### Firebase CLI

Use the `firebase firestore:databases:list` command to list all the databases in your project.

```
firebase firestore:databases:list
```

### View database details

To view details about a single database, use one of the following methods:

##### gcloud


Use the [`gcloud firestore databases describe`](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/describe) command:

```
gcloud firestore databases describe --database=DATABASE_ID
```

##### Firebase CLI

Use the `firebase firestore:databases:get` command:

```
firebase firestore:databases:get DATABASE_ID
```

The output for an Enterprise database includes the following fields:

- `Edition`: `ENTERPRISE`
- `Firestore Data Access`: `DATA_ACCESS_MODE_ENABLED` or `DATA_ACCESS_MODE_DISABLED`
- `MongoDB Compatible Data Access`: `DATA_ACCESS_MODE_ENABLED` or `DATA_ACCESS_MODE_DISABLED`
- `Realtime Updates`: `REALTIME_UPDATES_ENABLED` or `REALTIME_UPDATES_DISABLED`

Replace <var translate="no">DATABASE_ID</var> with a database ID.

## Update database configuration

To update the configurations settings of a database, use the [`gcloud firestore
databases
update`](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/update)
command.

Use this command to change to enable or disable delete protection.


### Update the delete protection setting

To enable delete protection on a database, use the `gcloud firestore databases
update` command with the `--delete-protection` flag. For example:

##### gcloud

```
gcloud firestore databases update --database=DATABASE_ID --delete-protection
```

Replace <var translate="no">DATABASE_ID</var> with a database ID.

To disable delete protection on a database, use the `gcloud firestore databases
update` command with the `--no-delete-protection` flag. For example:

##### gcloud

```
gcloud firestore databases update --database=DATABASE_ID --no-delete-protection
```

Replace <var translate="no">DATABASE_ID</var> with a database ID.

## Delete a database

To delete a database, use the console or command-line tool.

If the database has the delete protection setting enabled, you must first
[disable delete protection](https://firebase.google.com/docs/firestore/manage-databases#update-dp).

If the database contains [App Engine search
data](https://cloud.google.com/appengine/docs/legacy/standard/python/search) or
[blob
entities](https://cloud.google.com/appengine/docs/legacy/standard/python/blobstore),
you must delete that data first.

Deleting a database does not automatically delete any [Eventarc
triggers](https://firebase.google.com/docs/firestore/eventarc) for that database. The trigger stops delivering
events but continues to exist until you [delete the
trigger](https://cloud.google.com/eventarc/docs/managing-triggers#trigger-delete).

Deleting a database does not incur charges for delete operations.

##### Console

1.
   In the Firebase console, go to
   **Databases \& Storage** \> **Firestore**.


   [Go to Firestore](https://console.firebase.google.com/project/_/firestore/databases/-default-/data/)
2. In the **Data** tab, above the data table view for the database, click , then select **Delete database**.
3. Follow the instructions to delete the database.

##### gcloud

Use the
[\`gcloud firestore databases delete\`](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/delete) command.

```
gcloud firestore databases delete --database=DATABASE_ID
```

Replace <var translate="no">DATABASE_ID</var> with the ID of the database to delete. To delete the default database use the ID `'(default)'`

## Clone a database

You can clone an existing database at a selected timestamp into a new database:

- The cloned database is a new database that will be created in the same
  location as the source database.

  To make a clone, Cloud Firestore uses [point-in-time recovery (PITR)
  data](https://firebase.google.com/docs/firestore/pitr) of the source database. The cloned database includes
  all data and indexes.
- By default, the cloned database will be encrypted in the same way as the
  source database, using either Google's default encryption or [CMEK
  encryption](https://firebase.google.com/docs/firestore/use-cmek). You can specify a different encryption
  type or use a different key for CMEK encryption.

- The timestamp has a granularity of one minute and specifies a point of time
  in the past, in the period defined by the [PITR
  window](https://firebase.google.com/docs/firestore/pitr#pitr_window):

  - If PITR is enabled for your database, you select any minute in the last 7 days (or less if PITR was enabled less than 7 days ago).
  - If PITR isn't enabled, you can select any minute in the past hour.
  - You can check the earliest timestamp that you can pick [in your
    database's description](https://firebase.google.com/docs/firestore/use-pitr#get-period).

> [!NOTE]
> **Note:** To clone databases, your Google Account must have the [`datastore.databases.clone` IAM permission](https://firebase.google.com/docs/firestore/manage-databases#permissions).

### Console

1. Open the **Databases \& Storage \>** [**Firestore**](https://console.firebase.google.com/project/_/firestore/databases?useAutoProject=true)
   page in the Firebase console.

2. Next to your database name, click
   , then click
   **Clone database** . The **Clone database** pane appears.

3. In the **Clone database** pane, provide parameters for cloning the
   database:

   1. In the **Database ID** field, enter a database ID for the new cloned
      database. The database ID must not already be used by an existing
      database.

   2. In the **Clone from** field, select a point in time to use for
      cloning. The selected time corresponds to a PITR timestamp, at the
      minute granularity.

4. Click **Clone**.

### gcloud

Use the [`gcloud firestore databases
clone`](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/clone)
command to clone a database:

    gcloud firestore databases clone \
    --source-database='SOURCE_DATABASE' \
    --snapshot-time='PITR_TIMESTAMP' \
    --destination-database='DESTINATION_DATABASE_ID'

Replace the following:

- <var translate="no">SOURCE_DATABASE</var>: the database name of an existing database
  that you want to clone. The name uses the format
  `projects/PROJECT_ID/databases/SOURCE_DATABASE_ID`.

- <var translate="no">PITR_TIMESTAMP</var>: a [PITR timestamp](https://firebase.google.com/docs/firestore/use-pitr#get-period) in
  the [RFC 3339 format](https://tools.ietf.org/html/rfc3339), at minute
  granularity. For example: `2025-06-01T10:20:00.00Z` or
  `2025-06-01T10:30:00.00-07:00`.

- <var translate="no">DESTINATION_DATABASE_ID</var>: a [database ID](https://firebase.google.com/docs/firestore/manage-databases#database_id)
  for a new cloned database. This database ID must not be associated with an
  existing database.

Example:

    gcloud firestore databases clone \
    --source-database='projects/example-project/databases/(default)' \
    --snapshot-time='2025-06-01T10:20:00.00Z' \
    --destination-database='example-dest-db'

If you want to bind to some tags while cloning a database, use the previous
command with the `--tags` flag, which is an optional list of tags KEY=VALUE
pairs to bind.

Example:

    gcloud firestore databases clone \
    --source-database='projects/example-project/databases/(default)' \
    --snapshot-time='2025-06-01T10:20:00.00Z' \
    --destination-database='example-dest-db'

By default, the cloned database will have the same encryption configuration
as the source database. To change the encryption configuration, use the
`--encryption-type` argument:

- (Default) `use-source-encryption`: use the same encryption configuration as the source database.
- `google-default-encryption`: use Google's default encryption.
- `customer-managed-encryption`: use CMEK encryption. Specify a [key ID](https://cloud.google.com/kms/docs/getting-resource-ids#getting_the_id_for_a_key_and_version) in the `--kms-key-name` argument.

The following example shows how to configure CMEK encryption for the cloned
database:

    gcloud firestore databases clone \
    --source-database='projects/example-project/databases/(default)' \
    --snapshot-time='2025-06-01T10:20:00.00Z' \
    --destination-database='example-dest-db' \
    --encryption-type='customer-managed-encryption' \
    --kms-key-name='projects/example-project/locations/us-central1/keyRings/example-key-ring/cryptoKeys/example-key'

### Firebase CLI

Use the `firebase firestore:databases:clone` command to clone a database:

    firebase firestore:databases:clone \
    'SOURCE_DATABASE' \
    'DESTINATION_DATABASE' \
    --snapshot-time 'PITR_TIMESTAMP'

Replace the following:

- <var translate="no">SOURCE_DATABASE</var>: the database name of an existing database
  that you want to clone. The name uses the format
  `projects/PROJECT_ID/databases/SOURCE_DATABASE_ID`.

- <var translate="no">DESTINATION_DATABASE</var>: a database name for a new cloned
  database. The name uses the format
  `projects/PROJECT_ID/databases/DESTINATION_DATABASE_ID`.
  This database name must not be associated with an existing database.

- <var translate="no">PITR_TIMESTAMP</var>: a [PITR timestamp](https://firebase.google.com/docs/firestore/use-pitr#get-period) in
  the [RFC 3339 format](https://tools.ietf.org/html/rfc3339), at minute
  granularity. For example: `2025-06-01T10:20:00.00Z` or
  `2025-06-01T10:30:00.00-07:00`. If unspecified, the chosen snapshot will
  be the current time, rounded down to the minute.

By default, the cloned database will have the same encryption configuration
as the source database. To change the encryption configuration, use the
`--encryption-type` argument:

- (Default) `USE_SOURCE_ENCRYPTION`: use the same encryption configuration as the source database.
- `GOOGLE_DEFAULT_ENCRYPTION`: use Google's default encryption.
- `CUSTOMER_MANAGED_ENCRYPTION`: use CMEK encryption. Specify a [key ID](https://cloud.google.com/kms/docs/getting-resource-ids#getting_the_id_for_a_key_and_version) in the `--kms-key-name` argument.

## Configure per-database access permissions

You can use [Identity and Access Management
Conditions](https://cloud.google.com/iam/docs/conditions-overview) to configure
access permissions on a per-database level. The following examples use the
Google Cloud CLI to assign conditional access for one or more databases. You can
also [define IAM conditions in the
Google Cloud console](https://cloud.google.com/iam/docs/managing-conditional-role-bindings).

> [!WARNING]
> **Warning:** The Google Cloud console does not allow or deny access to databases based on IAM conditions configured at the database level. This only applies to accessing databases with the Google Cloud console. IAM conditions are enforced when accessing databases outside of the Google Cloud console such as with the REST API or the client libraries.

### View existing IAM policies

    gcloud projects get-iam-policy PROJECT_ID

Set `PROJECT_ID` to your project ID.

### Grant access to a database

    gcloud projects add-iam-policy-binding PROJECT_ID \
    --member='user:EMAIL' \
    --role='roles/datastore.user' \
    --condition='expression=resource.name=="projects/PROJECT_ID/databases/DATABASE_ID",title=TITLE,description=DESCRIPTION'

Set the following:

- `PROJECT_ID`: your project ID
- `EMAIL`: an email address that represents a specific Google Account. For example, `alice@example.com`.
- `DATABASE_ID`: a database ID.
- `TITLE`: an optional title for the expression.
- `DESCRIPTION`: an optional description of the expression.

### Grant access to all except one database

    gcloud projects add-iam-policy-binding PROJECT_ID \
    --member='user:EMAIL' \
    --role='roles/datastore.user' \
    --condition='expression=resource.name!="projects/PROJECT_ID/databases/DATABASE_ID",title=TITLE,description=DESCRIPTION'

Set the following:

- `PROJECT_ID`: your project ID
- `EMAIL`: an email address that represents a specific Google Account. For example, `alice@example.com`.
- `DATABASE_ID`: a database ID.
- `TITLE`: an optional title for the expression.
- `DESCRIPTION`: an optional description of the expression.

### Remove policies for a given member and role

    gcloud projects remove-iam-policy-binding PROJECT_ID \
    --member='user:EMAIL' \
    --role='roles/datastore.user' --all

Set the following:

- `PROJECT_ID`: your project ID
- `EMAIL`: an email address that represents a specific Google Account. For example, `alice@example.com`.

## Cloud Monitoring

Cloud Firestore metrics are reported under two monitored resources.

- [firestore.googleapis.com/Database](https://cloud.google.com/monitoring/api/resources#tag_firestore.googleapis.com/Database)
- [firestore_instance](https://cloud.google.com/monitoring/api/resources#tag_firestore_instance)(Legacy)

You can inspect aggregate metrics at the database level by looking at
`firestore.googleapis.com/Database`. The metrics reported under
`firestore_instance` are aggregated at the project level.

## Limitations

- You can have a maximum of 100 databases per project. You can [contact support](https://firebase.google.com/support) to request an increase to this limit.
- You cannot delete your `(default)` database if it contains any [GAE search
  data](https://cloud.google.com/appengine/docs/legacy/standard/python/search). Use the [index delete
  api](https://cloud.google.com/appengine/docs/legacy/standard/python/search#deleting_an_index) to delete GAE search data. If you recently deleted GAE Search data, there may be a waiting period before you are able to delete the database.
- You cannot delete your `(default)` database if it contains any [blob
  entities](https://cloud.google.com/appengine/docs/legacy/standard/python/blobstore). Use the [Blobstore delete
  api](https://cloud.google.com/appengine/docs/legacy/standard/python/refdocs/google.appengine.ext.blobstore.blobstore#google.appengine.ext.blobstore.blobstore.delete) to delete Blobstore data. You can check if your `(default)` database has Blobstore data by running the following GQL query in the Google Cloud console: `SELECT * FROM __BlobInfo__`.
- You cannot reuse a database ID until 5 minutes after the delete happens.
- Cloud Function v1 does not support Firestore Named databases. Use [Cloud
  Firestore Triggers (2nd
  Gen)](https://cloud.google.com/functions/docs/calling/cloud-firestore) to configure events for named databases.
- [Firestore function triggers
  v1](https://cloud.google.com/firestore/docs/extend-with-functions) and [Firestore event triggers](https://cloud.google.com/firestore/docs/eventarc) may stop working after the database is deleted, even if a new database is created with the same name.

## What's next

- [Add data](https://firebase.google.com/docs/firestore/manage-data/add-data)
- [Get data](https://firebase.google.com/docs/firestore/query-data/get-data)
- [Delete data](https://firebase.google.com/docs/firestore/manage-data/delete-data)