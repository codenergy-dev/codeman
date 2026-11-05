---
title: dockerd
url: https://docs.docker.com/reference/cli/dockerd/
created_at: 2026-11-05T12:55:38-03:00
updated_at: 2026-11-05T12:55:38-03:00
tool: docs/web/tools/fetch-markdown.md
---

# dockerd

The daemon's reference is too large to keep here (about 60 KB), so this page holds, in Codeman's words, only what Codeman relies on, from the page's Markdown source (`https://docs.docker.com/reference/cli/dockerd.md`).

## Host gateway

From "Configure host gateway IP":

- The value `host-gateway` of `--add-host` resolves to addresses on the host, so that containers can connect to services running there.
- By default it is the IPv4 address of the default bridge, and its IPv6 address if it has one.
- `--host-gateway-ip`, or `host-gateway-ips` in the daemon's configuration file, sets other addresses.
