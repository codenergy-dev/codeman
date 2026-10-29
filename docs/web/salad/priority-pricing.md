---
title: Priority Pricing
url: https://docs.salad.com/container-engine/explanation/billing-pricing/priority-pricing
created_at: 2026-10-29T11:06:09-03:00
updated_at: 2026-10-29T11:06:09-03:00
tool: docs/web/tools/salad.md
license: CC-BY-4.0
---

# Priority Pricing

*Last Updated: October 13, 2026*

## SaladCloud Infrastructure

SaladCloud is a distributed network with nodes located worldwide, ranging from esports arenas to personal computers.
This global network allows us to offer computing resources at exceptionally low prices and gives us the ability to grow
the network by hundreds of nodes a day when needed.

It is important to understand that as a result, the nodes powering our network can disconnect at any time, stopping
container instances running on the node. When this happens we automatically reallocate these instances to a new node as
quickly as possible.

Although some nodes may remain connected for days at a time, maintaining constant uptime requires multiple replicas for
redundancy.

## Priority Levels

Priority levels let you balance interruptions and cost savings according to your needs. Container Groups run at one of
four priority levels on our network: "High", "Medium", "Low", or "Lowest" (formally "Batch"). Lower priority levels have
reduced costs. Higher priority container groups can preempt lower priority ones if a higher-paying job becomes
available. Pick the lowest priority level that meets your interruption tolerance when you deploy. If instances at a
lower priority level are being interrupted too frequently for your needs, you can raise the priority of a running
container group at any time. See [Changing Priority](#changing-priority).

After adding a GPU to your container group, you can choose between priority levels. At the highest priority level, your
container group instances will not be interrupted *by other workloads*. However, high priority instances **will** still
be reallocated if your container exits, you request a reallocation, or the node powering the instance disconnects.
Container groups without a GPU always run at the "Lowest" priority level, and can be interrupted by any container group
requesting a GPU.

## Changing Priority

You can change the priority level of an existing container group in the Portal by editing the container group, or with
the [Update Container Group API](https://docs.salad.com/reference/saladcloud-api/container-groups/update-container-group.md).

* **Changes apply to running instances immediately.** Nothing restarts or redeploys. The new priority level determines
  both whether your instances can be preempted by higher priority container groups and the hourly rate billed from that
  point on.
* **Raising priority** is allowed at any time on a running container group.
* **Lowering priority** on a running container group is only allowed once the container group has been running at its
  current priority level for 1 hour. The hour counts from the container group's last start or its last priority change,
  whichever is later, and a priority change in either direction restarts it. This applies while the container group is
  deploying or running.
* **Rejected changes.** If you attempt to lower the priority before the hour has passed, the request is rejected and the
  container group keeps its current priority level. The API returns HTTP `400` with the problem type
  `container_group_update_exception` and the message: "The priority of a running container group can only be lowered
  after it has been running at this priority for 60 minutes. Stop the container group to change its priority
  immediately." The Portal shows the same error.
* **Stopped container groups** can change priority freely, and stopping clears the 1-hour timer. To move a running
  container group to a lower priority level right away, stop the container group, change the priority, and start it
  again. The new priority level applies when the container group starts.
* **Container groups without a GPU** always run at the "Lowest" priority level. A priority value set on them is ignored.

> [!TIP]
>
> Choose the lowest priority level that meets your interruption tolerance when you deploy. Raise priority whenever you
> need nodes faster. To lower priority right away, stop the container group, change the priority, and start it again.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
