---
title: Security & Trust on SaladCloud
url: https://salad.com/security/
created_at: 2026-10-29T11:07:19-03:00
updated_at: 2026-10-29T11:07:19-03:00
tool: docs/web/tools/salad.md
---

# Security & Trust on SaladCloud

What Codeman relies on from Salad's security page, in our own words. The page has no license that allows copying it.

## Hosts and isolation

- Salad's model assumes the host machine cannot be trusted (the introduction).
- Nodes are crowd-sourced, underutilized computers. A trust rating, built from each node's behavior and performance, together with the workload's requirements, decides where a workload is placed ("Architecture", "Trust rating system").
- A hypervisor partitions each node: the workload runs in an OCI container on a Linux virtual machine, isolated from Windows and the host's other processes ("Architecture").
- Data and environment variables are encrypted in transit and at rest ("Data security").
- Container Gateway: containers are exposed on one port through a WireGuard VPN, clients must use strong TLS, and routes are behind DDoS protection ("Product controls", Container Gateway).
- Salad Technologies holds a SOC 2 Type I report ("Compliance").

## Limits Salad states

- Nodes are crowd-sourced gaming computers, which raises security and privacy considerations. Traffic may be logged by networking equipment along the way: its content is protected by encryption, but its destination stays visible ("What are the security risks of using SaladCloud?").
- Salad relies on Hyper-V and container isolation, and watches for host intrusion, such as folder access or a shell being opened. When it detects one, it destroys the environment and blacklists the machine ("What happens if a host tries to access my container?").
- Workloads with specific regulatory or compliance requirements are often not a fit for Community Cloud. Salad points them to Salad Dedicated or Private Cloud ("Can you handle data subject to specific regulatory requirements?").
