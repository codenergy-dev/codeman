---
title: Expose ports
url: https://docs.runpod.io/pods/configuration/expose-ports
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-03T22:43:31-03:00
tool: docs/web/tools/runpod.md
---

# Expose ports

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## HTTP proxy

- An exposed HTTP port is reached at `https://<pod-id>-<port>.proxy.runpod.net` ("Access your service").
- A pod shown as running may not serve yet; services can take minutes to start ("Access your service").
- Requests go through Cloudflare, which closes a connection that gets no response within 100 seconds, with a `524` ("Proxy limitations and behavior").
- The proxy is HTTPS only, and the service is public: it must authenticate requests itself ("Proxy limitations and behavior").
