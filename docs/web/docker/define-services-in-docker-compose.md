---
title: Define services in Docker Compose
url: https://docs.docker.com/reference/compose-file/services/
created_at: 2026-10-20T19:06:41-03:00
updated_at: 2026-10-20T19:06:41-03:00
tool: docs/web/tools/fetch-markdown.md
---

# Define services in Docker Compose

What the repository relies on, in its own words: the page's Markdown source (`https://docs.docker.com/reference/compose-file/services.md`) is larger than the repository should hold (78 KB). Its license is Apache-2.0, like the rest of Docker's documentation ([docker/docs](https://github.com/docker/docs)). Each fact names the attribute's section. The top-level elements are full copies: [networks](define-and-manage-networks-in-docker-compose.md), [volumes](define-and-manage-volumes-in-docker-compose.md), [deploy](compose-deploy-specification.md), [profiles](learn-how-to-use-profiles-in-docker-compose.md), and [`docker compose up`](docker-compose-up.md).

## Image and start

- **`image`:** `[<registry>/][<project>/]<image>[:<tag>|@<digest>]`; a digest is accepted. Compose pulls a missing image according to `pull_policy`.
- **`pull_policy`:** `never` uses only the local image and fails without one; `missing` (the default without a `build` section) pulls only an absent image, but always pulls the `latest` tag; `build` builds the image, again if present.
- **`init`:** `true` runs an init process as PID 1 that forwards signals and reaps processes.
- **`user`:** overrides the image's user; without either, `root`.
- **`read_only`:** creates the container with a read-only file system.

## Order and health

- **`depends_on`, short syntax:** services are created and removed in dependency order, but Compose does not wait for a dependency to be healthy.
- **`depends_on`, long syntax (`condition`):** `service_started`; `service_healthy`, which waits for the dependency's `healthcheck` to pass; `service_completed_successfully`, which waits for the dependency to exit successfully. `required: false` only warns when the dependency is not started.
- **`healthcheck`:** works like the Dockerfile's `HEALTHCHECK`, with the same defaults, and overrides the image's.
  - `test` is a string (run with `CMD-SHELL`, by `/bin/sh`) or a list whose first item is `NONE`, `CMD` or `CMD-SHELL`.
  - `interval`, `timeout`, `start_period` and `start_interval` are durations; `retries` a count.
  - `disable: true`, or `test: ["NONE"]`, turns off the image's check.

## Profiles

- **`profiles`:** a list of profile names, matching `[a-zA-Z0-9][a-zA-Z0-9_.-]+`. A service without `profiles` always starts; one with them starts only when one of its profiles is active.

## Resources

- **`mem_limit`:** the memory a container can allocate, as a byte value. It must agree with `deploy.resources.limits.memory` when both are set.
- **`mem_reservation`:** a reservation, which must agree with `deploy.resources.reservations.memory`.
- **`memswap_limit`:** memory plus swap. Set to the same value as the memory limit, the container gets no swap; unset, it can use as much swap as its memory limit, if the host has swap.
- **`cpus`:** the number of CPUs, possibly virtual and fractional, given to the containers; `0.000` means no limit. It must agree with `deploy.resources.limits.cpus` when both are set.
- **`shm_size`:** the size of `/dev/shm`, as a byte value.

## Security

- **`cap_add`, `cap_drop`:** capabilities added or dropped, as strings.
- **`security_opt`:** security options as `option=value` or `option:value`, such as `no-new-privileges`; the options themselves are those of `docker run`'s `--security-opt`, to which the section links.

## Networks

- **`networks`:** the networks, named in the top-level `networks` element, that the service joins. Without the attribute, the service joins the implicit `default` network; `network_mode: none` leaves it on none.
- **`ipv4_address`:** a fixed address on a network, whose top-level definition must have an `ipam` subnet covering it.

## Volumes

- **`volumes`:** mounts of type `volume`, `bind`, `tmpfs`, `image` or `npipe`. A volume used by several services must be named in the top-level `volumes` element.
  - Short syntax: `VOLUME:CONTAINER_PATH[:ACCESS_MODE]`, where `VOLUME` is a host path or a volume's name, and `ro` makes it read-only.
  - The short syntax creates a missing host directory for a bind mount; the long syntax with `create_host_path: false` does not.
