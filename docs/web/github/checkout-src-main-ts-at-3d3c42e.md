---
title: checkout: src/main.ts at 3d3c42e
url: https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/src/main.ts
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
tool: docs/web/tools/github-repositories.md
license: MIT
---

# checkout: src/main.ts at 3d3c42e

```ts
import * as core from '@actions/core'
import * as gitSourceProvider from './git-source-provider.js'
import * as inputHelper from './input-helper.js'
import * as path from 'path'
import * as stateHelper from './state-helper.js'
import {fileURLToPath} from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function run(): Promise<void> {
  try {
    const sourceSettings = await inputHelper.getInputs()

    try {
      // Register problem matcher
      core.info(
        `::add-matcher::${path.join(__dirname, 'problem-matcher.json')}`
      )

      // Get sources
      await gitSourceProvider.getSource(sourceSettings)
      core.setOutput('ref', sourceSettings.ref)
    } finally {
      // Unregister problem matcher
      core.info('::remove-matcher owner=checkout-git::')
    }
  } catch (error) {
    core.setFailed(`${(error as any)?.message ?? error}`)
  }
}

async function cleanup(): Promise<void> {
  try {
    await gitSourceProvider.cleanup(stateHelper.RepositoryPath)
  } catch (error) {
    core.warning(`${(error as any)?.message ?? error}`)
  }
}

// Main
if (!stateHelper.IsPost) {
  run()
}
// Post
else {
  cleanup()
}
```
