---
title: Operation reference
url: https://docs.runpod.io/serverless/endpoints/operation-reference
created_at: 2026-10-06T17:30:00-03:00
updated_at: 2026-10-06T17:30:00-03:00
tool: docs/web/tools/runpod.md
---

# Operation reference

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

All operations are under `https://api.runpod.ai/v2/<endpoint-id>`, with the API key in `Authorization` ("Setup").

## `/runsync`

Waits for the job to finish: 90 seconds by default, up to 300 seconds with `?wait=` in milliseconds ("/runsync"). Codeman does not use it; the OpenAI-compatible route gave up on queued requests after the same 5 minutes in its tests.

## `/run`

`POST`, with the job as `{"input": {...}}`, at most 10 MB. It answers at once with the job's `id` and `status` (`IN_QUEUE`), and keeps the result 30 minutes after the job ends ("/run").

## `/status`

`GET /status/<job-id>`: the job's state (`IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, `FAILED`), its `delayTime` and `executionTime`, and its `output` when there is one ("/status").

## `/stream`

`GET /stream/<job-id>`: what a streaming handler yielded since the last call, in chunks of at most 1 MB ("/stream"). The page's example shows only the chunks; Runpod's Python SDK, [`runpod/endpoint/runner.py`](https://github.com/runpod/runpod-python/blob/main/runpod/endpoint/runner.py) (`Job.stream`), reads an object with `status` and `stream`, a list of `{"output": ...}`, and polls every second until the job is in a final state and `stream` is empty.

## `/cancel`

`POST /cancel/<job-id>` stops a running job, or removes a queued one before it starts, and answers at once with `CANCELLED` ("/cancel").

## `/purge-queue`

`POST /purge-queue` removes every job still in the queue, of anyone; jobs already running go on ("/purge-queue").
