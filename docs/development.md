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
| `npm test` | `node:test` on `src/**/*.test.ts`. The sandbox test runs only on Linux with `CODEMAN_SANDBOX_TEST=1`, because it creates a system user with `sudo`; CI sets it. The store's contract tests run on Firestore's emulator when there is one, and are skipped otherwise, as on CI; see [the emulator](#firestores-emulator). |
| `npm run build` | Bundle `src/index.ts` into `dist/index.js`, and the gateway, `src/gateway/main.ts`, into `dist/gateway.js` |

## Layout

- `action.yml`: action metadata. Runs `dist/index.js` on Node 24.
- `src/`: source and tests (`*.test.ts` next to the code they test).
  - `src/steps/`: one module per workflow job (`select`, `open-key`, `agent`, `close-key`, `apply`, `release-pod`). Each takes `Services` (`src/services.ts`): the runtime, the platform's conventions, its API, and the inference provider.
  - `src/inference/`: the `InferenceProvider`, `GpuProvider` and `InferenceEngine` interfaces and their adapters (OpenRouter, Runpod, Ollama, vLLM); see [self-hosted inference](architecture.md#self-hosted-inference).
  - `src/gateway/`: the gateway in front of a self-hosted engine, which runs in Codeman's pod image (`docker/pod/Dockerfile`) and in the agent job. It uses Node's modules only.
  - `src/platform/`: the `Platform`, `CiResults` and `Conventions` interfaces and the types they share. Adapters live in a directory each, such as `src/platform/github/`; see [platforms](architecture.md#platforms) for what they must guarantee.
  - `src/runtime/`: the `Runtime` interface and its adapters, such as `src/runtime/github-actions.ts`. Only runtime adapters import `@actions/core`.
  - `src/testing/`: fakes for tests: an in-memory platform unlike GitHub, its CI, a runtime that keeps what steps report, an inference provider, and a GPU cloud with its pods' gateways.
  - `src/harness/`: the `Harness` interface and its adapters. To add a harness, implement `install` and `command` and register it in `src/harness/index.ts`.
  - `src/store/`: the `Store` interface of the [backend](architecture.md#backend), on Firestore and in memory, with the contract tests both pass; Google's authentication; the data layout. `src/ledger.ts` records runs in it.
- `dist/`: the bundled action. Committed, because GitHub runs actions straight from the repository. CI fails when it does not match the source, so run `npm run build` before committing.
- `templates/`: files that target repositories copy.
- `firebase/firestore.rules`: the backend's security rules, which deny every client; [installation](installation.md#4-set-up-the-backend) publishes them.
- `docker/pod/`: Codeman's pod image. [`.github/workflows/pod-image.yml`](../.github/workflows/pod-image.yml) publishes it when it or `dist/gateway.js` changes on `main`; pin the published digest in `src/inference/ollama.ts` in a commit of its own. Images whose gateway serves one run at a time stay listed in `SINGLE_RUN_IMAGES` there, so tasks do not try to share their pods.
- `docs/web/`: the documentation of the third-party services Codeman uses, one page per file under `docs/web/<third-party>/`, and in `docs/web/tools/` how each kind of page is fetched. The format is in `AGENTS.md` ("Third-party documentation"). Pages are copies only where their license allows; the others hold what Codeman relies on, in our own words.

## Firestore's emulator

`src/store/emulator.test.ts` runs the store's contract tests (`src/store/contract.ts`) on Firestore's emulator, the same tests the store in memory passes, checks that two runs that reserve their limits in the ledger at once never pass the monthly budget together, and checks that the security rules deny every client. It uses, in this order:

1. The emulator that `FIRESTORE_EMULATOR_HOST` names (`host:port`), already running. The rules' test still needs the next one.
2. The newest `cloud-firestore-emulator-v*.jar` in Firebase's cache, `~/.cache/firebase/emulators/`, which the Firebase CLI downloads (`firebase setup:emulators:firestore`); the test starts it with `java -jar` (Java 21) on a free port of the loopback, and stops it at the end.

With neither, the tests are skipped. Each test uses a project of its own, so they share no documents. The emulator takes requests without a token, and only tests reach it: the action never reads `FIRESTORE_EMULATOR_HOST`.

## Conventions

- Imports of local files use the `.ts` extension; Node runs the tests without a build step.
- Use only TypeScript syntax that can be erased (`erasableSyntaxOnly`): no `enum`, `namespace` or parameter properties.
- Keep logic in pure functions that tests can call directly. `src/main.ts` wires the steps to GitHub; nothing else picks a platform.
