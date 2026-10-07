---
title: StructuredQuery
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery
created_at: 2026-10-07T15:13:51-03:00
updated_at: 2026-10-07T15:13:51-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# StructuredQuery

A Firestore query.

The query stages are executed in the following order: 1. from 2. where 3. select 4. orderBy + startAt + endAt 5. offset 6. limit 7. findNearest

| JSON representation |
|---|
| ``` { "select": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Projection`) }, "from": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#CollectionSelector`) } ], "where": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Filter`) }, "orderBy": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Order`) } ], "startAt": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Cursor`) }, "endAt": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Cursor`) }, "offset": integer, "limit": integer, "findNearest": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#FindNearest`) } } ``` |

| Fields ||
|---|---|
| `select` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Projection`)`` Optional sub-set of the fields to return. This acts as a `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/DocumentMask` over the documents returned from a query. When not set, assumes that the caller wants all fields returned. |
| `from[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#CollectionSelector`)`` The collections to query. |
| `where` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Filter`)`` The filter to apply. |
| `orderBy[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Order`)`` The order to apply to the query results. Callers can provide a full ordering, a partial ordering, or no ordering at all. While Firestore will always respect the provided order, the behavior for queries without a full ordering is different per database edition: In Standard edition, Firestore guarantees a stable ordering through the following rules: - The `orderBy` is required to reference all fields used with an inequality filter. - All fields that are required to be in the `orderBy` but are not already present are appended in lexicographical ordering of the field name. - If an order on `__name__` is not specified, it is appended by default. Fields are appended with the same sort direction as the last order specified, or 'ASCENDING' if no order was specified. For example: - `ORDER BY a` becomes `ORDER BY a ASC, __name__ ASC` - `ORDER BY a DESC` becomes `ORDER BY a DESC, __name__ DESC` - `WHERE a > 1` becomes `WHERE a > 1 ORDER BY a ASC, __name__ ASC` - `WHERE __name__ > ... AND a > 1` becomes `WHERE __name__ > ... AND a > 1 ORDER BY a ASC, __name__ ASC` In Enterprise edition, Firestore does not guarantee a stable ordering. Instead it will pick the most efficient ordering based on the indexes available at the time of query execution. This will result in a different ordering for queries that are otherwise identical. To ensure a stable ordering, always include a unique field in the `orderBy` clause, such as `__name__`. |
| `startAt` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Cursor`)`` A potential prefix of a position in the result set to start the query at. The ordering of the result set is based on the `ORDER BY` clause of the original query. SELECT * FROM k WHERE a = 1 AND b > 2 ORDER BY b ASC, __name__ ASC; This query's results are ordered by `(b ASC, __name__ ASC)`. Cursors can reference either the full ordering or a prefix of the location, though it cannot reference more fields than what are in the provided `ORDER BY`. Continuing off the example above, attaching the following start cursors will have varying impact: - `START BEFORE (2, /k/123)`: start the query right before `a = 1 AND b > 2 AND __name__ > /k/123`. - `START AFTER (10)`: start the query right after `a = 1 AND b > 10`. Unlike `OFFSET` which requires scanning over the first N results to skip, a start cursor allows the query to begin at a logical position. This position is not required to match an actual result, it will scan forward from this position to find the next document. Requires: - The number of values cannot be greater than the number of fields specified in the `ORDER BY` clause. |
| `endAt` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Cursor`)`` A potential prefix of a position in the result set to end the query at. This is similar to `START_AT` but with it controlling the end position rather than the start position. Requires: - The number of values cannot be greater than the number of fields specified in the `ORDER BY` clause. |
| `offset` | `integer` The number of documents to skip before returning the first result. This applies after the constraints specified by the `WHERE`, `START AT`, \& `END AT` but before the `LIMIT` clause. Requires: - The value must be greater than or equal to zero if specified. |
| `limit` | `integer` The maximum number of results to return. Applies after all other constraints. Requires: - The value must be greater than or equal to zero if specified. |
| `findNearest` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#FindNearest`)`` Optional. A potential nearest neighbors search. Applies after all other filters and ordering. Finds the closest vector embeddings to the given query vector. |

## Projection

The projection of document's fields to return.

| JSON representation |
|---|
| ``` { "fields": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`) } ] } ``` |

| Fields ||
|---|---|
| `fields[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`)`` The fields to return. If empty, all fields are returned. To only return the name of the document, use `['__name__']`. |

## CollectionSelector

A selection of a collection, such as `messages as m1`.

| JSON representation |
|---|
| ``` { "collectionId": string, "allDescendants": boolean } ``` |

| Fields ||
|---|---|
| `collectionId` | `string` The collection ID. When set, selects only collections with this ID. |
| `allDescendants` | `boolean` When false, selects only collections that are immediate children of the `parent` specified in the containing `RunQueryRequest`. When true, selects all descendant collections. |

## Filter

A filter.

| JSON representation |
|---|
| ``` { // Union field `filter_type` can be only one of the following: "compositeFilter": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#CompositeFilter`) }, "fieldFilter": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#FieldFilter`) }, "unaryFilter": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#UnaryFilter`) } // End of list of possible types for union field `filter_type`. } ``` |

| Fields ||
|---|---|
| Union field `filter_type`. The type of filter. `filter_type` can be only one of the following: ||
| `compositeFilter` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#CompositeFilter`)`` A composite filter. |
| `fieldFilter` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#FieldFilter`)`` A filter on a document field. |
| `unaryFilter` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#UnaryFilter`)`` A filter that takes exactly one argument. |

## CompositeFilter

A filter that merges multiple other filters using the given operator.

| JSON representation |
|---|
| ``` { "op": enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Operator`), "filters": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Filter`) } ] } ``` |

| Fields ||
|---|---|
| `op` | ``enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Operator`)`` The operator for combining multiple filters. |
| `filters[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Filter`)`` The list of filters to combine. Requires: - At least one filter is present. |

## Operator

A composite filter operator.

| Enums ||
|---|---|
| `OPERATOR_UNSPECIFIED` | Unspecified. This value must not be used. |
| `AND` | Documents are required to satisfy all of the combined filters. |
| `OR` | Documents are required to satisfy at least one of the combined filters. |

## FieldFilter

A filter on a specific field.

| JSON representation |
|---|
| ``` { "field": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`) }, "op": enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Operator_1`), "value": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`) } } ``` |

| Fields ||
|---|---|
| `field` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`)`` The field to filter by. |
| `op` | ``enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Operator_1`)`` The operator to filter by. |
| `value` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`)`` The value to compare to. |

## Operator

A field filter operator.

| Enums ||
|---|---|
| `OPERATOR_UNSPECIFIED` | Unspecified. This value must not be used. |
| `LESS_THAN` | The given `field` is less than the given `value`. Requires: - That `field` come first in `orderBy`. |
| `LESS_THAN_OR_EQUAL` | The given `field` is less than or equal to the given `value`. Requires: - That `field` come first in `orderBy`. |
| `GREATER_THAN` | The given `field` is greater than the given `value`. Requires: - That `field` come first in `orderBy`. |
| `GREATER_THAN_OR_EQUAL` | The given `field` is greater than or equal to the given `value`. Requires: - That `field` come first in `orderBy`. |
| `EQUAL` | The given `field` is equal to the given `value`. |
| `NOT_EQUAL` | The given `field` is not equal to the given `value`. Requires: - No other `NOT_EQUAL`, `NOT_IN`, `IS_NOT_NULL`, or `IS_NOT_NAN`. - That `field` comes first in the `orderBy`. |
| `ARRAY_CONTAINS` | The given `field` is an array that contains the given `value`. |
| `IN` | The given `field` is equal to at least one value in the given array. Requires: - That `value` is a non-empty `ArrayValue`, subject to disjunction limits. - No `NOT_IN` filters in the same query. |
| `ARRAY_CONTAINS_ANY` | The given `field` is an array that contains any of the values in the given array. Requires: - That `value` is a non-empty `ArrayValue`, subject to disjunction limits. - No other `ARRAY_CONTAINS_ANY` filters within the same disjunction. - No `NOT_IN` filters in the same query. |
| `NOT_IN` | The value of the `field` is not in the given array. Requires: - That `value` is a non-empty `ArrayValue` with at most 10 values. - No other `OR`, `IN`, `ARRAY_CONTAINS_ANY`, `NOT_IN`, `NOT_EQUAL`, `IS_NOT_NULL`, or `IS_NOT_NAN`. - That `field` comes first in the `orderBy`. |

## UnaryFilter

A filter with a single operand.

| JSON representation |
|---|
| ``` { "op": enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Operator_2`), // Union field `operand_type` can be only one of the following: "field": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`) } // End of list of possible types for union field `operand_type`. } ``` |

| Fields ||
|---|---|
| `op` | ``enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Operator_2`)`` The unary operator to apply. |
| Union field `operand_type`. The argument to the filter. `operand_type` can be only one of the following: ||
| `field` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`)`` The field to which to apply the operator. |

## Operator

A unary operator.

| Enums ||
|---|---|
| `OPERATOR_UNSPECIFIED` | Unspecified. This value must not be used. |
| `IS_NAN` | The given `field` is equal to `NaN`. |
| `IS_NULL` | The given `field` is equal to `NULL`. |
| `IS_NOT_NAN` | The given `field` is not equal to `NaN`. Requires: - No other `NOT_EQUAL`, `NOT_IN`, `IS_NOT_NULL`, or `IS_NOT_NAN`. - That `field` comes first in the `orderBy`. |
| `IS_NOT_NULL` | The given `field` is not equal to `NULL`. Requires: - A single `NOT_EQUAL`, `NOT_IN`, `IS_NOT_NULL`, or `IS_NOT_NAN`. - That `field` comes first in the `orderBy`. |

## Order

An order on a field.

| JSON representation |
|---|
| ``` { "field": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`) }, "direction": enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Direction`) } ``` |

| Fields ||
|---|---|
| `field` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`)`` The field to order by. |
| `direction` | ``enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#Direction`)`` The direction to order by. Defaults to `ASCENDING`. |

## Direction

A sort direction.

| Enums ||
|---|---|
| `DIRECTION_UNSPECIFIED` | Unspecified. |
| `ASCENDING` | Ascending. |
| `DESCENDING` | Descending. |

## FindNearest

Nearest Neighbors search config. The ordering provided by FindNearest supersedes the orderBy stage. If multiple documents have the same vector distance, the returned document order is not guaranteed to be stable between queries.

| JSON representation |
|---|
| ``` { "vectorField": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`) }, "queryVector": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`) }, "distanceMeasure": enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#DistanceMeasure`), "limit": integer, "distanceResultField": string, "distanceThreshold": number } ``` |

| Fields ||
|---|---|
| `vectorField` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/FieldReference`)`` Required. An indexed vector field to search upon. Only documents which contain vectors whose dimensionality match the queryVector can be returned. |
| `queryVector` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`)`` Required. The query vector that we are searching on. Must be a vector of no more than 2048 dimensions. |
| `distanceMeasure` | ``enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery#DistanceMeasure`)`` Required. The distance measure to use, required. |
| `limit` | `integer` Required. The number of nearest neighbors to return. Must be a positive integer of no more than 1000. |
| `distanceResultField` | `string` Optional. Optional name of the field to output the result of the vector distance calculation. Must conform to `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document.FIELDS.fields` limitations. |
| `distanceThreshold` | `number` Optional. Option to specify a threshold for which no less similar documents will be returned. The behavior of the specified `distanceMeasure` will affect the meaning of the distance threshold. Since DOT_PRODUCT distances increase when the vectors are more similar, the comparison is inverted. - For EUCLIDEAN, COSINE: `WHERE distance <= distanceThreshold` - For DOT_PRODUCT: `WHERE distance >= distanceThreshold` |

## DistanceMeasure

The distance measure to use when comparing vectors.

| Enums ||
|---|---|
| `DISTANCE_MEASURE_UNSPECIFIED` | Should not be set. |
| `EUCLIDEAN` | Measures the EUCLIDEAN distance between the vectors. See [Euclidean](https://en.wikipedia.org/wiki/Euclidean_distance) to learn more. The resulting distance decreases the more similar two vectors are. |
| `COSINE` | COSINE distance compares vectors based on the angle between them, which allows you to measure similarity that isn't based on the vectors magnitude. We recommend using DOT_PRODUCT with unit normalized vectors instead of COSINE distance, which is mathematically equivalent with better performance. See [Cosine Similarity](https://en.wikipedia.org/wiki/Cosine_similarity) to learn more about COSINE similarity and COSINE distance. The resulting COSINE distance decreases the more similar two vectors are. |
| `DOT_PRODUCT` | Similar to cosine but is affected by the magnitude of the vectors. See [Dot Product](https://en.wikipedia.org/wiki/Dot_product) to learn more. The resulting distance increases the more similar two vectors are. |
