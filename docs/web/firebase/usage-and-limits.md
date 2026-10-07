---
title: Usage and limits
url: https://firebase.google.com/docs/firestore/quotas
created_at: 2026-10-07T15:14:10-03:00
updated_at: 2026-10-07T15:14:10-03:00
tool: docs/web/tools/firebase.md
license: CC-BY-4.0
---

# Usage and limits

Use this guide to understand Cloud Firestore limits,
and see [Cloud Firestore Pricing](https://firebase.google.com/docs/firestore/pricing) for a full, detailed explanation of
Cloud Firestore costs, including things to watch out for.

## Monitor your usage

To monitor your Cloud Firestore usage from the Firebase console, go to the
**Databases \& Storage** \> **Firestore** \>
[**Usage** tab](https://console.firebase.google.com/project/_/firestore/usage).
Use this dashboard to gauge your usage over different time periods.

> [!NOTE]
> **Note:** As a result of how the dashboard computes usage, the numbers reported can differ slightly from billing reports. The billing reports are the final usage numbers.

### Detailed usage in the Google Cloud console

When you create a Firebase project, you're also creating a Google Cloud project.
The
[Cloud Firestore API Quotas](https://console.cloud.google.com/apis/api/firestore.googleapis.com/quotas)
and
[App Engine Quotas](https://console.cloud.google.com/appengine/quotadetails)
pages in the Google Cloud console track Cloud Firestore usage and quota
information.

## Free quota

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
[Storage pricing](https://firebase.google.com/docs/firestore/pricing#storage-size).

## Standard limits

The following tables show the limits that apply to
Cloud Firestore. These are hard limits unless otherwise noted.

### Databases

| Limit | Details |
|---|---|
| Maximum number of databases per project | 100 You can [contact support](https://firebase.google.com/support) to request an increase to this limit. |
| Maximum number of [customer-managed encryption keys (CMEK) databases](https://firebase.google.com/docs/firestore/cmek) per project | 0 By default the quota is 0 because this feature is behind an allowlist. You can request to increase the quota by filling in [the CMEK access request form](https://docs.google.com/forms/d/e/1FAIpQLSfKs8wJf4IXu1NizvfyU2vT59JDbdPvkehMVZ2ab5l_aDLIIA/viewform?resourcekey=0-O15dlRFvA0JIDmh6VFUEcA). |

### Collections, documents, and fields

| Limit | Details |
|---|---|
| Constraints on collection IDs | - Must be valid UTF-8 characters - Must be no longer than 1,500 bytes - Cannot contain a forward slash (`/`) - Cannot solely consist of a single period (`.`) or double periods (`..`) - Cannot match the regular expression `__.*__` |
| Maximum depth of subcollections | 100 |
| Constraints on document IDs | - Must be valid UTF-8 characters - Must be no longer than 1,500 bytes - Cannot contain a forward slash (`/`) - Cannot solely consist of a single period (`.`) or double periods (`..`) - Cannot match the regular expression `__.*__` - If you import Datastore entities into a Firestore database, numeric entity IDs are exposed as `__id[0-9]+__` |
| Maximum size for a document name | 6 KiB |
| Maximum size for a document | 1 MiB (1,048,576 bytes) |
| Constraints on field names | - Must be valid UTF-8 characters - Cannot match the regular expression `__.*__` |
| Maximum size of a field name | 1,500 bytes |
| Constraints on field paths | - Must separate field names with a single period (`.`) - May be passed as a dot-delimited (`.`) string of segments where each segment is either a simple field name or a quoted field name (defined below). A simple field name is one where all of the following are true: <!-- --> - Contains only the characters `a-z`, `A-Z`, `0-9`, and underscore (`_`) - Does not start with `0-9` A quoted field name starts and ends with the backtick character (`` ` ``). For example, `` foo.`x&y` `` refers to the `x&y` field nested under the `foo` field. To construct a field name with the backtick character, escape the backtick character with the backslash character (`\`). For convenience, you can avoid quoted field names by passing the field path as a FieldPath object ([for example, see JavaScript FieldPath](https://firebase.google.com/docs/reference/js/firestore_.fieldpath)). |
| Maximum size of a field path | 1,500 bytes |
| Maximum size of a field value | 1 MiB - 89 bytes (1,048,487 bytes) |
| Maximum depth of fields in a map or array | 20 Map and array fields add one level to the overall depth of an object. For example, the following object has a total depth of three levels: { nested_map: {         #depth 1 nested_array: [     #depth 2 { foo: "bar"      #depth 3 } ] } } <br /> |

### Writes and transactions

In addition to these limits, you should also see the
[best practices for designing for scale](https://firebase.google.com/docs/firestore/best-practices#designing_for_scale).

| Limit | Details |
|---|---|
| Maximum API request size | 10 MiB |
| Time limit for a transaction | 270 seconds, with a 60-second idle expiration time |
| Maximum number of field transformations that can be performed on a single document in a `Commit` operation or in a transaction | 500 |

### Indexes

The following limits apply to [single-field indexes](https://firebase.google.com/docs/firestore/query-data/index-overview#single-field_indexes) and [composite indexes](https://firebase.google.com/docs/firestore/query-data/index-overview#composite_indexes):

| Limit | Details |
|---|---|
| Maximum number of composite indexes for a database | - 200 when you have not enabled billing for your Google Cloud project. If you need more quota, you must [enable billing for your Google Cloud project.](https://cloud.google.com/billing/docs/how-to/modify-project) - 1000 when you enable billing for your Google Cloud project. You can [contact support](https://firebase.google.com/support) to request an increase to this limit. |
| Maximum number of single-field configurations for a database | - 200 when you have not enabled billing for your Google Cloud project. If you need more quota, you must [enable billing for your Google Cloud project.](https://cloud.google.com/billing/docs/how-to/modify-project) - 1000 when you enable billing for your Google Cloud project. One field level configuration can contain multiple configurations for the same field. For example, a single-field indexing exemption and a TTL policy on the same field count as one field configuration towards the limit. |
| Maximum number of index entries for each document | 40,000 The number of index entries is the sum of the following for a document: - The number of single-field index entries - The number of composite index entries To see how Cloud Firestore turns a document and a set of indexes into index entries, see [this index entry count example](https://firebase.google.com/docs/firestore/query-data/index-overview#index_entries). |
| Maximum number of fields in a composite index | 100 |
| Maximum size of an index entry | 7.5 KiB To see how Cloud Firestore calculates index entry size, see [index entry size](https://firebase.google.com/docs/firestore/storage-size#index-entry-size). |
| Maximum sum of the sizes of a document's index entries | 8 MiB The total size is the sum of the following for a document: - The sum of the size of a document's single-field index entries - The sum of the size of a document's composite index entries |
| Maximum size of an indexed field value | 1500 bytes Field values over 1500 bytes are truncated. Queries involving truncated field values may return inconsistent results. |

### Time-to-live (TTL)

| Limit | Details |
|---|---|
| Maximum number of single-field configurations for a database | - 200 when you have not enabled billing for your Google Cloud project. If you need more quota, you must [enable billing for your Google Cloud project.](https://cloud.google.com/billing/docs/how-to/modify-project) - 1000 when you enable billing for your Google Cloud project. One field level configuration can contain multiple configurations for the same field. For example, a single-field indexing exemption and a TTL policy on the same field count as one field configuration towards the limit. |

### Export/Import

The following limits apply to [managed import and export operations](https://firebase.google.com/docs/firestore/manage-data/export-import):

| Limit | Details |
|---|---|
| Maximum total number of both export and import requests for a project allowed per minute | 20 |
| Maximum number of concurrent exports and imports | 50 |
| Maximum number of collection ID filters for export and import requests | 100 |

### Security rules

| Limit | Details |
|---|---|
| Maximum number of `exists()`, `get()`, and `getAfter()` calls per request | - 10 for single-document requests and query requests. - 20 for multi-document reads, transactions, and batched writes. The previous limit of 10 also applies to each operation. For example, imagine you create a batched write request with 3 write operations and that your security rules use 2 document access calls to validate each write. In this case, each write uses 2 of its 10 access calls and the batched write request uses 6 of its 20 access calls. Exceeding either limit results in a permission denied error. Some document access calls may be cached, and cached calls do not count towards the limits. |
| Maximum nested `match` statement depth | 10 |
| Maximum path length, in path segments, allowed within a set of nested `match` statements | 100 |
| Maximum number of path capture variables allowed within a set of nested `match` statements | 20 |
| Maximum function call depth | 20 |
| Maximum number of function arguments | 7 |
| Maximum number of `let` variable bindings per function | 10 |
| Maximum number of recursive or cyclical function calls | 0 (not permitted) |
| Maximum number of expressions evaluated per request | 1,000 |
| Maximum size of a ruleset | Rulesets must obey two size limits: - a 256 KB limit on the size of the ruleset text source published from the Firebase console or from the CLI using `firebase deploy`. - a 250 KB limit on the size of the compiled ruleset that results when Firebase processes the source and makes it active on the back-end. |

## Manage spending

To help avoid unexpected charges on your bill, set monthly budgets and alerts.

### Set a monthly budget

To track your Cloud Firestore costs, create a monthly budget in the
Google Cloud console. Budgets won't limit your usage, but you can set alerts to
notify you when you're approaching or exceeding your planned costs for the
month.

To set a budget, go to the [Billing](https://console.cloud.google.com/billing/)
section in the Google Cloud console and create a budget for your
Cloud Billing account. You can use the default alert settings or modify the
alerts to send notifications at different percentages of your monthly budget.

Learn more about
[setting up budgets and budget alerts](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills#set-up-budget-alert-emails).
