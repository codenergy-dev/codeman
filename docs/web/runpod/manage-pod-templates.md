---
title: Manage Pod templates
url: https://docs.runpod.io/pods/templates/manage-templates
created_at: 2026-10-30T11:47:10-03:00
updated_at: 2026-10-30T11:47:10-03:00
tool: docs/web/tools/runpod.md
---

# Manage Pod templates

What the repository relies on, in its own words. The documentation states no license that allows copying it.

## The container start command

- A template's "Container start command" overrides the image's `CMD`. It takes a shell command, such as `bash -c 'mkdir /workspace && /start.sh'`, or JSON with `entrypoint` and `cmd`, such as `{"cmd": ["python", "app.py"], "entrypoint": ["bash", "-c"]}` ("Template configuration options").
- The page warns that most images have a start command of their own, which an override must not drop when the image needs it (the note under "Container start command").

## The older REST API

- Its example creates a template with `POST https://rest.runpod.io/v1/templates`, whose body names the command `dockerEntrypoint` and `dockerStartCmd`, both arrays ("REST API", under "Creating templates"). Codeman calls the REST API v2, `https://api.runpod.io/v2`, whose fields are `entrypoint`, `cmd` and `args` ([Runpod REST API](runpod-rest-api.md#the-containers-command)).
