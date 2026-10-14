---
title: Actions runner pricing
url: https://docs.github.com/en/billing/reference/actions-runner-pricing
created_at: 2026-10-13T20:46:57-03:00
updated_at: 2026-10-13T20:46:57-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Actions runner pricing

Reference information for calculating the cost of using different GitHub-hosted runners.

GitHub rounds the minutes and partial minutes each job uses up to the nearest whole minute.

| Operating system                     | Billing SKU           | Per-minute rate (USD) |
| ------------------------------------ | --------------------- | --------------------- |
| Linux 1-core (x64)                   | `actions_linux_slim`  | $0.002                |
| Linux 2-core (x64)                   | `actions_linux`       | $0.006                |
| Linux 2-core (arm64)                 | `actions_linux_arm`   | $0.005                |
| Windows 2-core (x64)                 | `actions_windows`     | $0.010                |
| Windows 2-core (arm64)               | `actions_windows_arm` | $0.010                |
| macOS 3-core or 4-core (M1 or Intel) | `actions_macos`       | $0.062                |

## x64-powered larger runners

| Operating system      | Billing SKU             | Per-minute rate (USD) |
| --------------------- | ----------------------- | --------------------- |
| Linux Advanced 2-core | `linux_2_core_advanced` | $0.006                |
| Linux 4-core          | `linux_4_core`          | $0.012                |
| Linux 8-core          | `linux_8_core`          | $0.022                |
| Linux 16-core         | `linux_16_core`         | $0.042                |
| Linux 32-core         | `linux_32_core`         | $0.082                |
| Linux 64-core         | `linux_64_core`         | $0.162                |
| Linux 96-core         | `linux_96_core`         | $0.252                |
| Windows 4-core        | `windows_4_core`        | $0.022                |
| Windows 8-core        | `windows_8_core`        | $0.042                |
| Windows 16-core       | `windows_16_core`       | $0.082                |
| Windows 32-core       | `windows_32_core`       | $0.162                |
| Windows 64-core       | `windows_64_core`       | $0.322                |
| Windows 96-core       | `windows_96_core`       | $0.552                |
| macOS 12-core         | `macos_l`               | $0.077                |

## arm64-powered larger runners

| Operating system      | Billing SKU           | Per-minute rate (USD) |
| --------------------- | --------------------- | --------------------- |
| Linux 2-core          | `linux_2_core_arm`    | $0.005                |
| Linux 4-core          | `linux_4_core_arm`    | $0.008                |
| Linux 8-core          | `linux_8_core_arm`    | $0.014                |
| Linux 16-core         | `linux_16_core_arm`   | $0.026                |
| Linux 32-core         | `linux_32_core_arm`   | $0.050                |
| Linux 64-core         | `linux_64_core_arm`   | $0.098                |
| Windows 2-core        | `windows_2_core_arm`  | $0.008                |
| Windows 4-core        | `windows_4_core_arm`  | $0.014                |
| Windows 8-core        | `windows_8_core_arm`  | $0.026                |
| Windows 16-core       | `windows_16_core_arm` | $0.050                |
| Windows 32-core       | `windows_32_core_arm` | $0.098                |
| Windows 64-core       | `windows_64_core_arm` | $0.194                |
| macOS 5-core (M2 Pro) | `macos_xl`            | $0.102                |

## GPU-powered larger runners

| Operating system | Billing SKU          | Per-minute rate (USD) |
| ---------------- | -------------------- | --------------------- |
| Linux 4-core     | `linux_4_core_gpu`   | $0.052                |
| Windows 4-core   | `windows_4_core_gpu` | $0.102                |

## Points to note about rates for runners

* The number of jobs you can run concurrently across all repositories in your user or organization account depends on your GitHub plan. For more information, see [Billing and usage](/en/actions/concepts/billing-and-usage) for GitHub-hosted runners and [Actions limits](/en/actions/reference/limits) for self-hosted runner usage limits.

* Larger runners are only available for organizations and enterprises using the GitHub Team or GitHub Enterprise Cloud plans.

* Larger runners are only billed at the per-minute rate for the amount of time workflows are executed on them. There is no cost associated with creating a larger runner that is not being used by a workflow.

* For larger runners, there is no additional cost for configurations that assign public static IP addresses to a larger runner. For more information on larger runners, see [Larger runners](/en/actions/concepts/runners/larger-runners).

* Included minutes cannot be used for larger runners.

* The larger runners are not free for public repositories.

* Custom images can only be used with larger runners. Jobs that use custom images are billed at the same per-minute rates as those runners, and storage for custom images is billed separately through GitHub Actions storage based on the amount of stored image data over time. For more information, see [GitHub Actions billing](/en/billing/concepts/product-billing/github-actions#custom-image-storage).
