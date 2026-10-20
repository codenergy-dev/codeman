---
title: "eclipse-temurin:21.0.12_8-jre-noble"
url: https://hub.docker.com/_/eclipse-temurin/tags?name=21.0.12_8-jre-noble
created_at: 2026-10-20T12:40:33-03:00
updated_at: 2026-10-20T12:40:33-03:00
tool: docs/web/tools/docker-hub.md
---

# eclipse-temurin:21.0.12_8-jre-noble

What the repository relies on, in its own words, from Docker Hub's tag API and the image's configuration in the registry (see the tool). Sizes are compressed, as pulled.

## Tag

- **Index digest:** `sha256:7739f0ffce786528961eea6bf46d9610ee968ac6127c9b2e93494757bdecce9f`, `last_updated` 2026-09-18.
- **linux/amd64:** manifest `sha256:0e0805b2c61299a70784a861800b732e37357ec434dfcd61514c3bd4227b874b`, 99.8 MB, 5 layers.
- **linux/arm64:** manifest `sha256:1917b2f04d01eb871ea1996df36952cf6ca757997c800dbb634486c6342036b2`, 98.2 MB.
- At the time of recording, the moving tag `21-jre-noble` pointed to a newer build, `21.0.12.1_1-jre-noble` (2026-10-17).

## Configuration of the linux/amd64 image

- **Java:** `JAVA_VERSION=jdk-21.0.12+8`, `JAVA_HOME=/opt/java/openjdk`, whose `bin` starts `PATH`.
- **Entry point:** `["/__cacert_entrypoint.sh"]`, no command, no `User` (root). Created 2026-09-16.
- **Base:** the label `org.opencontainers.image.version` is `24.04` (Ubuntu Noble).
