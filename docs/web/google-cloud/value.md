---
title: Value
url: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value
created_at: 2026-10-07T15:13:55-03:00
updated_at: 2026-10-07T15:13:55-03:00
tool: docs/web/tools/google-cloud.md
license: CC-BY-4.0
---

# Value

A message that can hold any of the supported value types.

| JSON representation ||
|---|---|
| ``` { // Union field `value_type` can be only one of the following: "nullValue": null, "booleanValue": boolean, "integerValue": string, "doubleValue": number, "timestampValue": string, "stringValue": string, "bytesValue": string, "referenceValue": string, "geoPointValue": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/LatLng`) }, "arrayValue": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/ArrayValue`) }, "mapValue": { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value#MapValue`) } // End of list of possible types for union field `value_type`. } ``` |

| Fields ||
|---|---|---|
| Union field `value_type`. Must have a value set. `value_type` can be only one of the following: |||
| `nullValue` | `null` A null value. |
| `booleanValue` | `boolean` A boolean value. |
| `integerValue` | `string (https://developers.google.com/discovery/v1/type-format format)` An integer value. |
| `doubleValue` | `number` A double value. |
| `timestampValue` | ``string (`https://developers.google.com/protocol-buffers/docs/reference/google.protobuf#google.protobuf.Timestamp` format)`` A timestamp value. Precise only to microseconds. When stored, any additional precision is rounded down. A timestamp in RFC3339 UTC "Zulu" format, with nanosecond resolution and up to nine fractional digits. Examples: `"2014-10-02T15:01:23Z"` and `"2014-10-02T15:01:23.045123456Z"`. |
| `stringValue` | `string` A string value. The string, represented as UTF-8, must not exceed 1 MiB - 89 bytes. Only the first 1,500 bytes of the UTF-8 representation are considered by queries. |
| `bytesValue` | `string (https://developers.google.com/discovery/v1/type-format format)` A bytes value. Must not exceed 1 MiB - 89 bytes. Only the first 1,500 bytes are considered by queries. A base64-encoded string. |
| `referenceValue` | `string` A reference to a document. For example: `projects/{project_id}/databases/{database_id}/documents/{document_path}`. |
| `geoPointValue` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/Shared.Types/LatLng`)`` A geo point value representing a point on the surface of Earth. |
| `arrayValue` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/ArrayValue`)`` An array value. Cannot directly contain another array value, though can contain an map which contains another array. |
| `mapValue` | ``object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value#MapValue`)`` A map value. |

## MapValue

A map value.

| JSON representation ||
|---|---|
| ``` { "fields": { string: { object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value`) }, ... } } ``` |

| Fields ||
|---|---|
| `fields` | ``map (key: string, value: object (`https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Value`))`` The map's fields. The map keys represent field names. Field names matching the regular expression `__.*__` are reserved. Reserved field names are forbidden except in certain documented contexts. The map keys, represented as UTF-8, must not exceed 1,500 bytes and cannot be empty. An object containing a list of `"key": value` pairs. Example: `{ "name": "wrench", "mass": "1.3kg", "count": "3" }`. |
