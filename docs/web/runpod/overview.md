---
title: Overview
url: https://docs.runpod.io/serverless/workers/overview
created_at: 2026-10-06T22:24:39-03:00
updated_at: 2026-10-06T22:24:39-03:00
tool: docs/web/tools/runpod.md
---

# Overview

What Codeman relies on, in its own words. The documentation states no license that allows copying it. Several Runpod pages are titled "Overview"; this is Serverless's page on workers, the only one recorded.

## Worker states

A worker is in one of these states ("Worker states"):

| State | What it is | Billed |
| --- | --- | --- |
| Initializing | Downloading the image, loading code, downloading cached models | No |
| Idle | Scaled down, waiting for requests | No |
| Running | Processing requests | Yes |
| Throttled | Cannot run for now: the host lacks resources | No |
| Outdated | To be replaced after an update | Yes, while it processes |
| Unhealthy | Crashed; retried for up to 7 days | No |

Billing starts when a worker turns **Running** and stops when it scales down. A running worker is billed while its handler loads the model (the cold start), while it processes requests, and for the idle timeout after each request, which the console also shows as Running. The console's **Workers** tab of an endpoint shows its workers' states ("Worker states").

## Worker types

Flex workers scale down to zero when idle and cost nothing then; active workers run all the time ("Worker types").
