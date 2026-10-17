---
title: Point-in-time recovery (PITR) overview
url: https://docs.cloud.google.com/firestore/native/docs/pitr
created_at: 2026-10-17T13:07:14-03:00
updated_at: 2026-10-17T13:07:14-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Point-in-time recovery (PITR) overview

Point-in-time recovery (PITR) protects against
accidental deletion or writes. PITR maintains versions of your
documents from past timestamps. For example, in the case of a developer
pushing any incorrect data, accidental deletes or writes, PITR can recover the
data to a point in time in the past (up to a maximum of 7 days).
For any live database that follows [Best practices](https://docs.cloud.google.com/firestore/native/docs/best-practices), use of PITR doesn't affect the performance of reads or writes.

## PITR window

After you enable PITR, Firestore starts retaining PITR data. PITR data
is retained for 7 days in the PITR window.

You can read data for a timestamp based on when PITR was enabled:

| PITR enablement status | Earliest PITR data available |   |
|---|---|---|
| Disabled | 1 hour before the time of read request |   |
| enabled within 7 days | 1 hour before PITR was enabled |   |
| enabled more than 7 days ago | 7 days before the time of read request |   |

> [!NOTE]
> **Note:** You can't start reading from 7 days in the past immediately after you enable PITR.

A single version per minute is retained in the PITR window. You can read
documents at minute granularity using a whole minute timestamp. Reads that are
not at minute granularity like `2023-05-30 09:00:00.1234AM` return an
error that the `read_time` is too old.

Only one version of a document is retained in case of multiple writes. For
example, if a document had multiple writes ranging from `v1, v2, ... vk` between
`2023-05-30 09:00:00AM` (exclusive) and `2023-05-30 09:01:00AM` (inclusive)
timestamp, a read request at timestamp `2023-05-30 09:01:00AM` returns the `vk`
version of the document.

You can read from the data created during the PITR
window. The data is stored at a minute granularity and you can recover data
at the same granularity. The PITR feature is disabled by default.

The [`earliestVersionTime`](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases#Database) field of your database specifies the
earliest permissible read time for your data.

Regardless of whether PITR is enabled or not, you can read (but not export) documents at any microsecond-granularity timestamp within the past hour, but not before the `earliestVersionTime`.

## Ways to recover data

There are several ways to recover data:

- To **recover a portion of the database** ,

  perform a [stale read](https://docs.cloud.google.com/firestore/native/docs/understand-reads-writes-scale#stale_reads)
  specifying a query-condition or using direct key lookup along with a timestamp in
  the past,

  and then write the results back into the live database. This is
  typically used for surgical operations on a live database. For example, if
  you accidentally delete a particular document or incorrectly update a
  subset of data, you can recover it with this method. For instructions, see
  [recovering a portion of your database](https://docs.cloud.google.com/firestore/native/docs/use-pitr#read-pitr).

- To **recover the entire database**, use one of the following options:

  -
    [Clone the database](https://docs.cloud.google.com/firestore/native/docs/manage-databases#clone-database)

    to create a copy of the database at a specific timestamp.

  - [Export](https://docs.cloud.google.com/firestore/native/docs/use-pitr#export-import) the database and specify
    a timestamp in the past and then import it to a new database. The PITR
    export operation supports all filters, including export of all documents and
    export of specific collections.

  You can clone or export PITR data where the timestamp
  is a whole minute timestamp within the past seven days, but not earlier than
  the `earliestVersionTime`.

## Pricing

Consider the following pricing information before you enable PITR for your database:

- Storage: Firestore measures the database size daily. Over the
  period of a month, these sample points are averaged to calculate the
  database storage size. This average value is multiplied by the unit price of
  PITR (GB-month). See [storage pricing](https://docs.cloud.google.com/firestore/pricing) for more information.

  PITR storage doesn't have a free tier and you must have billing enabled if you want to use PITR.
- Compute billing: Any queries that you make during the PITR window of 7 days,
  either through stale reads or exports, incur read operation costs
  based on the number of documents read. See [pricing](https://docs.cloud.google.com/firestore/pricing) for more
  information.

- Minimum billing: You may be charged up to 1 day of PITR storage cost even if you disable PITR within a day after enablement.

## What's next

- Learn more about how to [recover data with PITR](https://docs.cloud.google.com/firestore/native/docs/use-pitr).