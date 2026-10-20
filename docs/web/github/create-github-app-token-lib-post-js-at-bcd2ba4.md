---
title: create-github-app-token: lib/post.js at bcd2ba4
url: https://github.com/actions/create-github-app-token/blob/bcd2ba49218906704ab6c1aa796996da409d3eb1/lib/post.js
created_at: 2026-10-20T15:17:26-03:00
updated_at: 2026-10-20T15:17:26-03:00
tool: docs/web/tools/github-repositories.md
license: MIT
---

# create-github-app-token: lib/post.js at bcd2ba4

```js
// @ts-check

/**
 * @param {import("@actions/core")} core
 * @param {import("@octokit/request").request} request
 */
export async function post(core, request) {
  const skipTokenRevoke = core.getBooleanInput("skip-token-revoke");

  if (skipTokenRevoke) {
    core.info("Token revocation was skipped");
    return;
  }

  const token = core.getState("token");

  if (!token) {
    core.info("Token is not set");
    return;
  }

  const expiresAt = core.getState("expiresAt");
  if (expiresAt && tokenExpiresIn(expiresAt) < 0) {
    core.info("Token expired, skipping token revocation");
    return;
  }

  try {
    await request("DELETE /installation/token", {
      headers: {
        authorization: `token ${token}`,
      },
    });
    core.info("Token revoked");
  } catch (error) {
    core.warning(`Token revocation failed: ${error.message}`);
  }
}

/**
 * @param {string} expiresAt
 */
function tokenExpiresIn(expiresAt) {
  const now = new Date();
  const expiresAtDate = new Date(expiresAt);

  return Math.round((expiresAtDate.getTime() - now.getTime()) / 1000);
}
```
