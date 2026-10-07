---
title: Transaction serializability and isolation
url: https://firebase.google.com/docs/firestore/transaction-data-contention
created_at: 2026-10-07T15:14:14-03:00
updated_at: 2026-10-07T15:14:14-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Transaction serializability and isolation

This page describes transactional data contention, serializability, and
isolation. For transaction code samples, see
[transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions) instead.

## Transactions and data contention

For a transaction to succeed, the documents retrieved by its read operations
must remain unmodified by operations outside the transaction. If another
operation attempts to change one of those documents, that operations enters
a state of data contention with the transaction.

Data contention
:   When two or more operations compete to control the same document. For example,
    one transaction might require a document to remain consistent while a concurrent
    operation tries to update that document's field values.

Cloud Firestore resolves data contention by delaying or failing one of
the operations. The Cloud Firestore client libraries
automatically retry transactions that fail due to data contention. After a
finite number of retries, the transaction operation fails and returns an error
message:

    ABORTED: Too much contention on these documents. Please try again.

When deciding which operation to fail or delay, behavior depends the type of
concurrency controls.

## Concurrency controls

The concurrency mode is a configurable database option.
Cloud Firestore supports the following concurrency modes:

- `PESSIMISTIC`: Pessimistic concurrency controls assume that data contention is likely. Pessimistic
  transactions use database locks to prevent other operations from modifying data.

  With pessimist concurrency controls, transactions place locks on the documents they
  read. A transaction's lock on a document blocks other transactions,
  batched writes, and non-transactional writes from changing that document. A
  transaction releases its document locks at commit time. It also
  releases its locks if it times out or fails for any reason.

  When a transaction locks a document, other write operations must wait for the
  transaction to release its lock. Transactions acquire their locks in
  chronological order.
- `OPTIMISTIC`: Optimistic concurrency controls assume that data contention is
  not likely or that it's not efficient to hold database locks. Optimistic
  transactions don't use database locks to block other operations from changing data

  With optimistic concurrency controls, a transaction keeps track of all the
  documents you read inside the transaction. The transaction completes its write operations **only
  if** none of those documents changed during the transaction's execution. If any
  document did change, the transaction handler retries the transaction. If
  the transaction can't get a clean result after a few retries, the transaction
  fails due to data contention.

### Concurrency mode defaults

The default for Standard edition is `PESSIMISTIC`. The default for
Enterprise edition is `OPTIMISTIC`. However, the behaviour also depends on the
type of client library:

- The mobile / web SDKs use optimistic concurrency controls. The mobile and web SDKs behave independently of this setting as they always emulate optimistic concurrency.
- The server client libraries use concurrency controls of the database setting.

### View concurrency mode

Run the
[`gcloud firestore databases describe`](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/databases/describe)
command to view your database's server-side concurrency mode:

    gcloud firestore databases describe \
      --project=PROJECT_ID \
      --database=DATABASE_ID

### Change concurrency mode

Run the
[`gcloud firestore databases update`](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/databases/update)
command to change your database's server-side concurrency mode:

    gcloud firestore databases update \
      --project=PROJECT_ID \
      --database=DATABASE_ID \
      --concurrency-mode=CONCURRENCY_MODE

where:

- <var translate="no">CONCURRENCY_MODE</var> is `PESSIMISTIC` or `OPTIMISTIC`.
- <var translate="no">PROJECT_ID</var> is the ID of your Google Cloud project.
- <var translate="no">DATABASE_ID</var> is the ID of your Cloud Firestore database.

> [!IMPORTANT]
> **Key Term:** In database systems, *concurrency controls* describe how the system resolves data contention between concurrent operations. Systems can implement optimistic or pessimistic concurrency controls.

## Data contention in the mobile/web SDKs

Mobile and web SDKs emulate optimistic concurrency transactions using write
preconditions on document versions. This emulation occurs regardless of the
database's concurrency mode setting. The mobile and web SDKs don't use
the [built-in transactions](https://docs.cloud.google.com//firestore/docs/reference/rest/v1/projects.databases.documents/commit)
feature, so even if the database concurrency mode
is configured for `PESSIMISTIC`, mobile clients still behave optimistically.

Mobile/web SDKs use optimistic concurrency controls, because they can operate in
environments with high latency and an unreliable network connection. Locking
documents in a high latency environment would cause too many data contention
failures.

## Data contention in the server client libraries

Server client libraries (C#, Go, Java, Node.js, PHP, Python, Ruby) use
the [built-in transactions](https://cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/commit)
feature. These transactions use the
database-level concurrency mode setting and the default depends on the edition:

- Enterprise edition uses optimistic concurrency controls by default to
  support operations that scan over entire collections.
  Optimistic concurrency controls help avoid scan operations that lock on a large
  number of documents.

- Standard edition uses pessimistic concurrency controls and
  assumes low latency and a reliable connection to the database.

> [!NOTE]
> **Note:** To best ensure low latency, use server client libraries from a [Google Cloud compute product as close to your Cloud Firestore database as possible](https://cloud.google.com/about/locations#products-available-by-location). A server client library with a high latency connection can run into issues with locking and data contention.

## Serializable isolation

Data contention between transactions is closely related to database isolation
levels. A database's *isolation level* describes how well the system
handles conflicts between concurrent operations. Conflict comes from the
following database requirements:

- Transactions require accurate, consistent data.
- To efficiently use resources, databases execute operations concurrently.

In systems with a low isolation level, a read operation within a transaction
might read inaccurate data from uncommitted changes in a concurrent
operation.

*Serializable isolation* defines the highest isolation level. Serializable
isolation means that:

- You can assume that the database executes transactions in series.
- Transactions are not affected by uncommitted changes in concurrent operations.

This guarantee must hold even while the database executes multiple
transactions in parallel. The database must implement concurrency controls to
resolve conflicts that would break this guarantee.

Cloud Firestore guarantees serializable isolation of transactions.
Transactions in Cloud Firestore are serialized and isolated by commit
time.

### Serializable isolation by commit time

Cloud Firestore assigns each transaction a commit time which represents
a single point in time. When Cloud Firestore commits a transaction's
changes to the database, you can assume all reads and writes within the
transaction take place exactly at the commit time.

Actual execution of a transaction requires some span of time. The execution of a
transaction begins before the commit time, and the execution of multiple
operations may overlap. Cloud Firestore upholds serializable isolation
and guarantees that:

- Cloud Firestore commits transactions in order by commit time.
- Cloud Firestore isolates transactions from concurrent operations with a later commit time.

In the case of data contention between concurrent operations,
[Cloud Firestore uses optimistic and pessimistic concurrency controls to resolve contention.](https://firebase.google.com/docs/firestore/transaction-data-contention#concurrency-controls)

### Isolation within a transaction

Transaction isolation also applies to write operations within a transaction.
Queries and reads inside a transaction do not see the results of previous writes
inside that transaction. Even if you modify or delete a document within a
transaction, all document reads in that transaction return the version of the
document at commit time, before the transaction's write operations.
Read operations return nothing if the document did not exist then.

> [!NOTE]
> **Note:** Document reads must come before document writes.

### Issues with data contention

For more information on data contention and how to resolve them check out the [troubleshooting page](https://cloud.google.com/firestore/docs/troubleshooting).
