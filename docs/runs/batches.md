# Batches across repositories

A profile's count (`tasks`, `min-tasks`, `max-tasks`) is the size of a batch: the tasks that run at once with the same resolved settings. On a pod, a batch may take tasks of several repositories, and of several organizations of a pool. The choice was made in the [plan for GPU batches across repositories](../plans/2026-10-13-gpu-batches-across-repositories.md).

## Pools

A pool is a closed list of organizations that share the board, the batches, the pod registry and the Runpod account. Without the `pool` setting, an organization is a pool alone.

- `pool` is set only in the organization's settings (`CODEMAN_SETTINGS`), as a list of logins that includes the organization itself: `pool: [organization-a, organization-b]`. Anywhere else, or without the organization, it stops the run.
- The pool's ID is its members' logins, lowercase, sorted, joined by `+`: `organization-a+organization-b`. Alone, it is the organization's login.
