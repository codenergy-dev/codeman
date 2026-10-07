---
title: Write
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write
created_at: 2026-10-07T15:13:50-03:00
updated_at: 2026-10-07T15:13:50-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Write

A write on a document.

| JSON representation |
|---|
| ``` { "updateMask": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/DocumentMask`) }, "updateTransforms": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#FieldTransform`) } ], "currentDocument": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition`) }, // Union field `operation` can be only one of the following: "update": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document`) }, "delete": string, "transform": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#DocumentTransform`) } // End of list of possible types for union field `operation`. } ``` |

| Fields ||
|---|---|
| `updateMask` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/DocumentMask`)`` The fields to update in this write. This field can be set only when the operation is `update`. If the mask is not set for an `update` and the document exists, any existing data will be overwritten. If the mask is set and the document on the server has fields not covered by the mask, they are left unchanged. Fields referenced in the mask, but not present in the input document, are deleted from the document on the server. The field paths in this mask must not contain a reserved field name. |
| `updateTransforms[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#FieldTransform`)`` The transforms to perform after update. This field can be set only when the operation is `update`. If present, this write is equivalent to performing `update` and `transform` to the same document atomically and in order. |
| `currentDocument` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition`)`` An optional precondition on the document. The write will fail if this is set and not met by the target document. |
| Union field `operation`. The operation to execute. `operation` can be only one of the following: ||
| `update` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document`)`` A document to write. |
| `delete` | `string` A document name to delete. In the format: `projects/{projectId}/databases/{databaseId}/documents/{document_path}`. |
| `transform` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#DocumentTransform`)`` Applies a transformation to a document. |

## DocumentTransform

A transformation of a document.

| JSON representation |
|---|
| ``` { "document": string, "fieldTransforms": [ { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#FieldTransform`) } ] } ``` |

| Fields ||
|---|---|
| `document` | `string` The name of the document to transform. |
| `fieldTransforms[]` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#FieldTransform`)`` The list of transformations to apply to the fields of the document, in order. This must not be empty. |

## FieldTransform

A transformation of a field of the document.

| JSON representation |
|---|
| ``` { "fieldPath": string, // Union field `transform_type` can be only one of the following: "setToServerValue": enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#ServerValue`), "increment": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`) }, "maximum": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`) }, "minimum": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`) }, "appendMissingElements": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue`) }, "removeAllFromArray": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue`) } // End of list of possible types for union field `transform_type`. } ``` |

| Fields ||
|---|---|
| `fieldPath` | `string` The path of the field. See `https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents#Document.FIELDS.fields` for the field path syntax reference. |
| Union field `transform_type`. The transformation to apply on the field. `transform_type` can be only one of the following: ||
| `setToServerValue` | ``enum (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#ServerValue`)`` Sets the field to the given server value. |
| `increment` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`)`` Adds the given value to the field's current value. This must be an integer or a double value. If the field is not an integer or double, or if the field does not yet exist, the transformation will set the field to the given value. If either of the given value or the current field value are doubles, both values will be interpreted as doubles. Double arithmetic and representation of double values follow IEEE 754 semantics. If there is positive/negative integer overflow, the field is resolved to the largest magnitude positive/negative integer. |
| `maximum` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`)`` Sets the field to the maximum of its current value and the given value. This must be an integer or a double value. If the field is not an integer or double, or if the field does not yet exist, the transformation will set the field to the given value. If a maximum operation is applied where the field and the input value are of mixed types (that is - one is an integer and one is a double) the field takes on the type of the larger operand. If the operands are equivalent (e.g. 3 and 3.0), the field does not change. 0, 0.0, and -0.0 are all zero. The maximum of a zero stored value and zero input value is always the stored value. The maximum of any numeric value x and NaN is NaN. |
| `minimum` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue#Value`)`` Sets the field to the minimum of its current value and the given value. This must be an integer or a double value. If the field is not an integer or double, or if the field does not yet exist, the transformation will set the field to the input value. If a minimum operation is applied where the field and the input value are of mixed types (that is - one is an integer and one is a double) the field takes on the type of the smaller operand. If the operands are equivalent (e.g. 3 and 3.0), the field does not change. 0, 0.0, and -0.0 are all zero. The minimum of a zero stored value and zero input value is always the stored value. The minimum of any numeric value x and NaN is NaN. |
| `appendMissingElements` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue`)`` Append the given elements in order if they are not already present in the current field value. If the field is not an array, or if the field does not yet exist, it is first set to the empty array. Equivalent numbers of different types (e.g. 3L and 3.0) are considered equal when checking if a value is missing. NaN is equal to NaN, and Null is equal to Null. If the input contains multiple equivalent values, only the first will be considered. The corresponding transform_result will be the null value. |
| `removeAllFromArray` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/ArrayValue`)`` Remove all of the given elements from the array in the field. If the field is not an array, or if the field does not yet exist, it is set to the empty array. Equivalent numbers of the different types (e.g. 3L and 3.0) are considered equal when deciding whether an element should be removed. NaN is equal to NaN, and Null is equal to Null. This will remove all equivalent values if there are duplicates. The corresponding transform_result will be the null value. |

## ServerValue

A value that is calculated by the server.

| Enums ||
|---|---|
| `SERVER_VALUE_UNSPECIFIED` | Unspecified. This value must not be used. |
| `REQUEST_TIME` | The time at which the server processed the request, with millisecond precision. If used on multiple fields (same or different documents) in a transaction, all the fields will get the same server timestamp. |
