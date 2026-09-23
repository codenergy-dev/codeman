# Development

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci          # install exact versions from package-lock.json, without install scripts
npm run check   # lint, type check, test and build
```

| Script | What it does |
| --- | --- |
| `npm run lint` | Biome lint and format check |
| `npm run format` | Apply Biome fixes and formatting |
| `npm run typecheck` | `tsc`, no output |
| `npm test` | `node:test` on `src/**/*.test.ts` |
| `npm run build` | Bundle `src/index.ts` into `dist/index.js` |

## Layout

- `action.yml`: action metadata. Runs `dist/index.js` on Node 24.
- `src/`: source and tests (`*.test.ts` next to the code they test).
- `dist/`: the bundled action. Committed, because GitHub runs actions straight from the repository. CI fails when it does not match the source, so run `npm run build` before committing.
- `templates/`: files that target repositories copy.

## Conventions

- Imports of local files use the `.ts` extension; Node runs the tests without a build step.
- Use only TypeScript syntax that can be erased (`erasableSyntaxOnly`): no `enum`, `namespace` or parameter properties.
- Keep logic in pure functions that tests can call directly. `src/main.ts` wires them to GitHub.
