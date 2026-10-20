---
title: toolkit: packages/artifact/src/generated/results/api/v1/artifact.ts at 21229dc
url: https://github.com/actions/toolkit/blob/21229dc09e551e6da18e72e4e454ee145709c713/packages/artifact/src/generated/results/api/v1/artifact.ts
created_at: 2026-10-20T15:18:00-03:00
updated_at: 2026-10-20T15:18:00-03:00
tool: docs/web/tools/github-repositories.md
---

# toolkit: packages/artifact/src/generated/results/api/v1/artifact.ts at 21229dc

The file is about 46 KB of generated code, so this page holds, in Codeman's words, only the messages of the artifact service that `@actions/artifact` 6.2.1 (commit `21229dc`) uses. `upload-artifact` v7.0.1 bundles 6.2.0 and `download-artifact` v8.0.1 bundles 6.2.1; they differ only in how a download's file name is read and in an error's text.

## The service

- `github.actions.results.api.v1.ArtifactService` has the methods `CreateArtifact`, `FinalizeArtifact`, `ListArtifacts`, `GetSignedArtifactURL` and `DeleteArtifact` (`ArtifactService`).

## Messages, by protobuf field name

| Message | Fields |
| --- | --- |
| `CreateArtifactRequest` | `workflow_run_backend_id` string, `workflow_job_run_backend_id` string, `name` string, `expires_at` Timestamp, `version` int32, `mime_type` StringValue |
| `CreateArtifactResponse` | `ok` bool, `signed_upload_url` string |
| `FinalizeArtifactRequest` | `workflow_run_backend_id`, `workflow_job_run_backend_id`, `name` strings, `size` int64, `hash` StringValue |
| `FinalizeArtifactResponse` | `ok` bool, `artifact_id` int64 |
| `ListArtifactsRequest` | `workflow_run_backend_id`, `workflow_job_run_backend_id` strings, `name_filter` StringValue, `id_filter` Int64Value |
| `ListArtifactsResponse` | `artifacts`, repeated `ListArtifactsResponse.MonolithArtifact` |
| `ListArtifactsResponse.MonolithArtifact` | `workflow_run_backend_id`, `workflow_job_run_backend_id` strings, `database_id` int64, `name` string, `size` int64, `created_at` Timestamp, `digest` StringValue |
| `GetSignedArtifactURLRequest` | `workflow_run_backend_id`, `workflow_job_run_backend_id`, `name` strings |
| `GetSignedArtifactURLResponse` | `signed_url` string |
| `DeleteArtifactRequest` | `workflow_run_backend_id`, `workflow_job_run_backend_id`, `name` strings |
| `DeleteArtifactResponse` | `ok` bool, `artifact_id` int64 |

(each message's `$Type` class)
