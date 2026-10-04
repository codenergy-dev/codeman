---
title: Endpoint settings
url: https://docs.runpod.io/serverless/endpoints/endpoint-configurations
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Endpoint settings

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## Settings Codeman checks

- Active workers (default 0) are always on and billed when idle; max workers default to 3 ("Quick reference", "Active workers").
- Idle timeout (default 5 seconds): a worker stays up, and billed, that long after its last request ("Idle timeout").
- FlashBoot, on by default, speeds up starts of endpoints whose workers cycle often ("FlashBoot").
- Execution timeout: 600 seconds per job by default ("Execution timeout").

## Idle endpoints

After 3 days without requests, Runpod lowers the endpoint's max workers to 2; after 7 days, to 0. It stays there until someone raises it ("Idle endpoint scale-down").
