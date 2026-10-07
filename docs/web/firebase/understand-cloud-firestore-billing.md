---
title: Understand Cloud Firestore billing
url: https://firebase.google.com/docs/firestore/pricing
created_at: 2026-10-07T15:14:13-03:00
updated_at: 2026-10-07T15:14:13-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Understand Cloud Firestore billing

[Video](https://www.youtube.com/watch?v=6NegFl9p_sE)

This document explains Cloud Firestore pricing details.


If you pay in a currency other than USD, the prices listed in your currency on
[Cloud Platform SKUs](https://cloud.google.com/skus) apply.

## Pricing overview

When you use Cloud Firestore, you are charged for the following:

- **The number of documents you read, write, and delete**.
- **The number of index entries read to satisfy a query** . [See more details about index reads](https://firebase.google.com/docs/firestore/pricing#index-reads).
- **The amount of storage that your database uses**, including overhead for metadata and indexes.
- **The amount of network bandwidth that you use**.

Storage and bandwidth usage are calculated in gibibytes (GiB), where 1 GiB =
2^30^ bytes. All charges accrue daily.

The following sections provide details about how you are charged for your
Cloud Firestore usage.

### Free quota

Cloud Firestore offers free quota that lets you get started at no cost.
If you need more quota, you must
[enable billing for your Google Cloud project](https://cloud.google.com/billing/docs/how-to/modify-project).

Quotas are applied daily and reset around midnight Pacific time.

> [!IMPORTANT]
> **Important:** Cloud Firestore allows **exactly one free database** per project.

The following table summarizes free quota amounts:


| Free tier | Quota |
|---|---|
| Stored data | 1 GiB |
| Document reads | 50,000 per day |
| Document writes | 20,000 per day |
| Document deletes | 20,000 per day |
| Outbound data transfer | 10 GiB per month |

<br />

The following operations and features don't include free usage. You must enable
billing to use these features:

- TTL deletes
- PITR data
- Backup data
- Restore operations
- Clone operations

For more information about how these features are billed, see
[Storage pricing](https://firebase.google.com/docs/firestore/storage-size).

### Pricing by location

To view pricing for reads, writes, deletes, and storage for
each Cloud Firestore location, see [Google Cloud pricing](https://cloud.google.com/firestore/pricing#tg0-t1).

If you pay in a currency other than USD, the prices listed in your currency on [Cloud Platform SKUs](https://cloud.google.com/skus) apply.

### Free quota applies only to one database per project

Projects can have only one database that qualifies for the free quota.

To create additional databases, you must upgrade your project's billing
plan.

The first database you create (regardless of its ID) qualifies for the free
quota. If you delete that database, the next database you create becomes the new
database eligible for the free quota.

There's no additional cost to you for creating or deleting databases.
All subsequent database will be charged on usage incurred on those databases.

### Reads, writes, and deletes

You are charged for documents and index entries read to satisfy a query. You are
charged for each document write and delete that you perform.

Charges for writes and deletes are straightforward. For writes, each `set` or
`update` operation counts as a single write.

Charges for read operations have some
nuances that you should keep in mind. The following sections explain these
nuances in detail.

#### Index entry reads

You are charged one read operation for each batch of up to 1000 index entries
read by a query except in the following:

> [!NOTE]
> **Note:** You can use [Firestore Query Explain](https://firebase.google.com/docs/firestore/query-explain) to confirm if a query charges index entries read.

- For [K-nearest neighbor vector search queries](https://firebase.google.com/docs/firestore/vector-search), you are charged one
  read operation for each batch of up to 100 kNN vector index entries read by the query.

  For example, if the following vector search query with `limit: 5`
  returns 5 documents and reads 1550 kNN vector index entries,
  you are billed 5 read operations for the documents returned and 16 read
  operations for the index entries:

      // Requires single-field vector index
      const vectorQuery: VectorQuery = db.collection('cities').findNearest('embedding_field', FieldValue.vector([3.0, 1.0, 2.0]), {
        limit: 5,
        distanceMeasure: 'EUCLIDEAN'
      });

- Queries that have up to one range field are not charged for index entries
  read.

  For example, the following query contains one equality field (`age`) and one
  range field (`start_date`) and is not charged for index entries read:

      db.collection("employees").whereEqualTo("age", 35)
                                .whereGreaterThanOrEqualTo("start_date", new Date(2020, 1, 1))

  The following query contains two range fields (`age` and `start_date`) and is
  charged for index entries reads:

      db.collection("employees").whereGreaterThanOrEqualTo("age", 35)
                                .whereGreaterThanOrEqualTo("start_date", new Date(2020, 1, 1))

  A field that appears in the order by clause is considered a range field when
  there is at least one other range field in the query.
  Therefore the following query contains two range fields
  (`age` and `start_date`) and is charged for index entries reads:

      db.collection("employees").whereGreaterThanOrEqualTo("age", 35)
                                .orderBy("start_date")

  The `__name__` field is always considered a range field, even if it is only
  used in an equality filter. Therefore the following query contains two range
  fields (`age` and `__name__`) and is charged for index entries reads:

      db.collection("employees").whereIn("__name__", Arrays.asList("/employees/Alice", "/employees/Bob"))
                                .orderBy("age")

#### Aggregation queries

For [aggregation queries](https://firebase.google.com/docs/firestore/query-data/aggregation-queries)
such as `count()`, `sum()`, and `avg()`,
you are charged for index entries read by the query as
[described above](https://firebase.google.com/docs/firestore/pricing#index-reads). For aggregation queries that read 0 index
entries, there is a minimum charge of one document read.

For example, `count()` operations that read between 0 and 1000 index entries
are billed for one document read. For a `count()` operation that reads 1500
index entries, you are billed 2 document reads.

To learn more about the indexes used and the index entries read, use
[Query Explain](https://firebase.google.com/docs/firestore/query-explain).

#### Listening to query results

Cloud Firestore allows you to [listen to the results of a
query](https://firebase.google.com/docs/firestore/query-data/listen) and get realtime updates when the query results change.

When you listen to the results of a query, you are charged for a read each time
a document in the result set is added or updated. You are also charged for a
read when a document is removed from the result set because the document has
changed. (In contrast, when a document is deleted, you are not charged for a
read.)

Billing of listeners in the mobile and web SDKS also depends on whether
[offline persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline) is enabled or not:

- If offline persistence is enabled and the listener is disconnected for
  more than 30 minutes (for example, if the user goes offline), you will be
  charged for documents and index entries read as if you had issued a brand-new
  query.

- If offline persistence is disabled, you will be charged for documents and
  index entries read as if you had issued a brand-new query whenever the
  listener disconnects and reconnects.

> [!NOTE]
> **Note:** Queries with up to one range field are exempted from charging for index entries read. See [here](https://firebase.google.com/docs/firestore/pricing#index-reads) for details.

#### Managing large result sets

Cloud Firestore has several features to help you manage queries that
return a large number of results:

- **Cursors**, which allow you to resume a long-running query.
- **Page tokens**, which help you paginate the query results.
- **Limits**, which specify how many results to retrieve.
- **Offsets**, which allow you to skip a fixed number of documents.

There are no additional costs for using cursors, page tokens, and limits. In
fact, these features can help you save money by reading only the documents that
you actually need.

However, when you send a query that includes an offset, you are charged a read
for each skipped document. For example, if your query uses an offset of 10, and
the query returns 1 document, you are charged for 11 reads. Because of this
additional cost, you should use cursors instead of offsets whenever possible.

#### Queries other than document reads

For queries other than document reads, such as a request for a list of
collection IDs, you are billed for one document read. If fetching the complete
set of results requires more than one request (for example, if you are using
pagination), you are billed once per request.

#### Minimum charge for queries

There is a minimum charge of one document read for each query that you perform,
even if the query returns no results.

#### Cloud Firestore Security Rules

For mobile and web client libraries, if your
[Cloud Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started) use `exists()`, `get()`, or `getAfter()` to read
one or more documents from your database, you are charged for additional reads
as follows:

- You are charged for reads that are necessary to evaluate your
  Cloud Firestore Security Rules.

  For example, if your rules refer to three documents, but
  Cloud Firestore only has to read two of those documents to evaluate
  your rules, you will be charged for two additional reads for the dependent
  documents.

  You are only charged one read per dependent document even if your rules
  refer to that document more than once.
- You are charged for rule evaluation only once per request.

  As a result, it can cost less to read multiple documents than to read
  documents one at a time, because reading multiple documents requires fewer
  requests.
- When you listen to the results of a query, you are charged for rule evaluation
  in all of the following cases:

  - When you issue the query.
  - Each time the query results are updated.
  - Any time the user's device goes offline, then comes back online.
  - Any time you update your rules.
  - Any time you update the dependent documents in your rules.

### Database storage size

You are charged for the amount of data that you store in Cloud Firestore,
including storage overhead. The amount of overhead includes metadata, automatic
indexes, and composite indexes.

Each document stored in Cloud Firestore requires the following metadata:

- The document ID, including the collection ID and the document name.
- The name and value of each field. Because Cloud Firestore is schemaless, the name of each field in a document must be stored with the field value.
- Any single-field and composite indexes that refer to the document. Each index entry contains the collection ID; any number of field values, depending on the index definition; and the document name.

Storage costs are in GiB/month and calculated daily. Cloud Firestore
measures the database size daily. Over the period of a month,
these sample points are averaged to calculate the database storage size.
This average value is multiplied by the unit price of storage (GiB-month)

Learn how Cloud Firestore storage is calculated at [Storage Size
Calculations](https://firebase.google.com/docs/firestore/storage-size).

### PITR data

If you enable [PITR](https://firebase.google.com/docs/firestore/pitr), you are charged for the storage of PITR
data. Most customers will find that the overall cost of PiTR data storage is
similar to the storage cost of the database.

> [!NOTE]
> **Note:** PITR data is billed separately from the database storage size billing. PITR data doesn't affect your [data storage size costs](https://firebase.google.com/docs/firestore/pricing#storage-size).

Storage costs for PITR are in GiB/month and
calculated daily. Cloud Firestore measures the database size daily. Over
the period of a month, these sample points are averaged to calculate the
database storage size. This average value is multiplied by the unit price of
PITR (GiB-month).

For example, if the average size of your database during a
month is 1 GiB and PITR is enabled for the whole month, then the billable PITR
data size is 1 GiB as well.

Minimum billing: You may be charged up to 1 day of PITR storage cost even if you
disable PITR within a day after enablement.

### Backup data and restore operations

If you enable [backups](https://firebase.google.com/docs/firestore/backups), you are charged for the storage of
your database backups. The storage size for a backup is equal to the storage
size of the database when the backup was taken.

Storage costs for backups are in GiB/month. Over the period of a month, the
number of days for which each backup is retained, averaged over the month is also
calculated. The cost of each backup is calculated using the storage size of the
backup multiplied by the proportion of the month the backup is retained,
multiplied by the unit price. Day boundaries are defined by the America/Los_Angeles time zone for
billing purposes.

When you perform a restore operation, Cloud Firestore measures the
size of the backup for the restore operation. The size of the backup is
multiplied by the unit price of restore operations (GiB).

### Query Explain

Use of [Firestore Query Explain](https://firebase.google.com/docs/firestore/query-explain) incurs costs.

When a query is explained with the default option, no index read operations are
performed. Regardless of query complexity, one read operation is charged.

When a query is explained with the analyze option, index and read
operations are performed, so you are charged for the query as usual. There is no
additional charge for the explain and analyze activity, only the usual charge
for the query being executed.

### Network bandwidth

You are charged for the network bandwidth used by your Cloud Firestore
requests, as shown in the following sections. The network bandwidth cost of a
Cloud Firestore request depends on the request's response size, the
location of your Cloud Firestore database, and the destination of the
response.

Cloud Firestore calculates response size based on a serialized message
format. Protocol overhead, such as SSL overhead, does not count towards network
bandwidth usage. Requests denied by your Cloud Firestore Security Rules do not count
towards network bandwidth usage.

To learn how much network
bandwidth you have used, you can use the Google Cloud console to [export your
billing data to a file](https://cloud.google.com/billing/docs/how-to/export-data-file).

#### General network pricing

For requests that originate within Google Cloud Platform (for example, from an
application running on Google Compute Engine), you are charged as follows:

| Traffic type | Price |
|---|---|
| Inbound data transfer | Free |
| Data transfer within a region | Free |
| Data transfer between regions in the same multi-region | Free |
| Data transfer between regions within the US (per GiB) | $0.01 (first 10 GiB per month are free) |
| Data transfer between regions, not including traffic between US regions | [Google Cloud Platform outbound internet data transfer rates](https://cloud.google.com/firestore/pricing#internet-egress) |

If you pay in a currency other than USD, the prices listed in your currency on [Cloud Platform SKUs](https://cloud.google.com/skus) apply.

Cloud Firestore is also subject to additional internet egress charges for
the following:

- Google Cloud requests between regions, not including traffic between US regions
- Requests from outside of Google Cloud (for example, from a user's mobile device)

See [Google Cloud internet egress rates](https://cloud.google.com/firestore/pricing#internet-egress).

## See a pricing example

To see how Cloud Firestore billing costs accrue in a real-world sample
app, see the [Cloud Firestore billing example](https://firebase.google.com/docs/firestore/billing-example).

## Manage spending

To help avoid unexpected charges on your bill, set
[monthly budgets and alerts](https://firebase.google.com/docs/firestore/quotas#budget) in the Google Cloud console.

To monitor your Cloud Firestore usage from the Firebase console, go to the
**Databases \& Storage** \> **Firestore** \>
[**Usage** tab](https://console.firebase.google.com/project/_/firestore/usage).
Use this dashboard to gauge your usage over different time periods.
