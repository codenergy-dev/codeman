---
title: Send API requests
url: https://docs.runpod.io/serverless/endpoints/send-requests
created_at: 2026-10-06T17:30:00-03:00
updated_at: 2026-10-06T17:30:00-03:00
tool: docs/web/tools/runpod.md
---

# Send API requests

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Execution policies

A job's request may carry `policy` next to `input` ("Execution policies"):

- `executionTimeout`: how long the job may run once a worker takes it; 10 minutes by default, from 5 seconds to 7 days. It overrides the endpoint's setting for that job.
- `ttl`: the job's whole life, queue included, after which it is deleted whatever its state; 24 hours by default, from 10 seconds to 7 days ("TTL vs. execution timeout").

## Job states

A job that ends is `COMPLETED`, `FAILED`, `CANCELLED` or `TIMED_OUT`; the last when it expired in the queue or ran past its execution timeout ([Job states and metrics](https://docs.runpod.io/serverless/endpoints/job-states)).

## Rate limits

Per endpoint: `/run` 1,000 requests per 10 seconds, `/status` and `/stream` 2,000, `/cancel` 100 ("Rate limits").
