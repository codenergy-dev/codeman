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
| `npm test` | `node:test` on `src/**/*.test.ts`. The sandbox test runs only on Linux with `CODEMAN_SANDBOX_TEST=1`, because it creates a system user with `sudo`; CI sets it. The store's contract tests run on Firestore's emulator when there is one, and are skipped otherwise, as on CI; see [the emulator](#firestores-emulator). `src/docs.test.ts` checks that every relative link in `README.md`, `AGENTS.md` and `docs/`, and every path of `docs/` named in the code, the templates and the pod image, names a file and a heading that exist. |
| `npm run build` | Bundle `src/index.ts` into `dist/index.js`, and the gateway, `src/gateway/main.ts`, into `dist/gateway.js` |

## Layout

- `action.yml`: action metadata. Runs `dist/index.js` on Node 24.
- `src/`: source and tests (`*.test.ts` next to the code they test).
  - `src/steps/`: the steps of the six workflow jobs, in five modules: `select.ts`, `agent.ts`, `apply.ts`, `keys.ts` (`openKey`, `closeKey` and `release`, for `open-key`, `close-key` and `release-pod`) and `common.ts`, which they share. `STEPS` in `src/main.ts` maps each job to its step. Each step takes `Services` (`src/services.ts`), which has eight members: the runtime, the platform's conventions, its API (`platform`, with the `workflow-token` for `workflows` access), its CI's results (`ci`), the inference provider, the providers' accounts that the budgets read (`accounts`), the store and the job's ledger.
  - `src/inference/`: the registry of providers and the settings each accepts (`providers.ts`; see [providers](../settings/providers.md)), the Ollama and vLLM settings a pod takes (`ollama.ts`, `vllm.ts`; see [Ollama settings](../settings/ollama.md) and [vLLM settings](../settings/vllm.md)), the pod images by engine (`images.ts`), the check of a vLLM pod's model on Hugging Face (`huggingface.ts`), the `InferenceProvider`, `GpuProvider` and `InferenceEngine` interfaces and their adapters (OpenRouter, Runpod, Ollama, vLLM); see [self-hosted inference](../inference/self-hosted.md).
  - `src/gateway/`: the gateway in front of a self-hosted engine, which runs in Codeman's pod image (`docker/pod/Dockerfile`) and in the agent job, and, in the pod, fits the model to the GPU (`fit.ts`; see [memory](../settings/ollama.md#memory)) or starts vLLM for the pod's requests (`vllm.ts`; see [memory](../settings/vllm.md#memory)). It uses Node's modules only.
  - `src/platform/`: the `Platform`, `CiResults` and `Conventions` interfaces and the types they share. Adapters live in a directory each, such as `src/platform/github/`; see [platforms](platforms.md) for what they must guarantee.
  - `src/runtime/`: the `Runtime` interface and its adapters, such as `src/runtime/github-actions.ts`. Only runtime adapters import `@actions/core`.
  - `src/testing/`: fakes for tests: an in-memory platform unlike GitHub, its CI, a runtime that keeps what steps report, an inference provider, and a GPU cloud with its pods' gateways; and the example settings of [profiles](../settings/profiles.md#example), which the tests read.
  - `src/harness/`: the `Harness` interface and its adapters. To add a harness, implement `install` and `command` and register it in `src/harness/index.ts`.
  - `src/store/`: the `Store` interface of the [backend](../backend/backend.md), on Firestore and in memory, with the contract tests both pass; Google's authentication; the data layout. `src/ledger.ts` records runs in it.
- `dist/`: the bundled action. Committed, because GitHub runs actions straight from the repository. CI fails when it does not match the source, so run `npm run build` before committing.
- `templates/`: files that target repositories copy; see [template version](#template-version).
- `firebase/firestore.rules`: the backend's security rules, which deny every client; [installation](../installation/setup.md#4-set-up-the-backend) publishes them.
- `docker/pod/`: Codeman's pod images, one target per engine ([pod images](#pod-images)).
- `docs/web/`: the documentation of the third-party services Codeman uses, one page per file under `docs/web/<third-party>/`, and in `docs/web/tools/` how each kind of page is fetched. The format is in `AGENTS.md` ("Third-party documentation"). Pages are copies only where their license allows; the others hold what Codeman relies on, in our own words.

## Template version

Repositories run the Codeman commit their `CODEMAN_COMMIT_SHA` variable names, with workflow files copied from `templates/` at some commit, maybe an older one. Every Codeman step of both templates passes `template-version`, and `TEMPLATE_VERSION` in [`src/action.ts`](../../src/action.ts) is the version the code expects: on any other, every step fails before it starts, saying to copy the templates from the variable's commit ([installation](../installation/setup.md#5-add-the-workflow-and-settings)).

- **Bump it** (add one, and write the new value in every `template-version:` of both templates) when the code comes to depend on something in the templates that older copies lack or do differently: an input or an output it reads, a job, a permission, a secret, a step, or the checkout's path. Say what changed in [upgrading](../installation/upgrading.md).
- **Keep it** for comments, and for changes the code does not depend on, such as a step a repository may do without. Each bump makes every repository copy its files again.
- `src/templates.test.ts` fails when a template's value differs from `TEMPLATE_VERSION`, but cannot tell whether a change needed a bump: the reviewer of a change to `templates/` decides.

## Pod images

`docker/pod/Dockerfile` has a target per engine, `ollama` and `vllm`, each the engine's official image with Node's binary and `dist/gateway.js`. [`.github/workflows/pod-image.yml`](../../.github/workflows/pod-image.yml) builds both when `docker/pod/`, the workflow or `dist/gateway.js` changes on `main` (or when run by hand), and publishes each to GitHub's container registry as `ghcr.io/<owner>/codeman-<engine>:<commit>`; its summary lists both digests. The vLLM leg frees the runner's disk first and may take most of its 60 minutes the first time, while GHCR has none of vLLM's layers.

Pods run the images pinned in `POD_IMAGES`, not the latest build. A change to `docker/pod/` or to `dist/gateway.js`, the gateway included, reaches pods only once the new digests are pinned (step 2), in a commit after the one the images were built from.

1. **Make a new package public, once.** A package GHCR creates is private, and Runpod pulls images without credentials, so a pod on a private image never starts. After the first publish of `codeman-ollama` and of `codeman-vllm`: on GitHub, the owner's **Packages** tab, the package, **Package settings**, **Danger Zone**, **Change visibility**, **Public**, and type the package's name to confirm. An organization must allow public packages (organization **Settings**, **Packages**, **Package creation**). Check it with `docker pull ghcr.io/<owner>/codeman-<engine>@sha256:<digest>` while logged out.
2. **Pin each digest** in `POD_IMAGES` in [`src/inference/images.ts`](../../src/inference/images.ts), one line per engine: `vllm: "ghcr.io/codenergy-dev/codeman-vllm@sha256:<digest>"`, in a commit of its own, after checking that the image's tag is the commit it was built from. A test checks that each pinned image is its engine's package by digest.
3. **Keep older images listed.** When the Ollama image changes, the image it replaces stays known where it must: images whose gateway serves one run at a time stay in `SINGLE_RUN_IMAGES` (`src/inference/ollama.ts`), so each task gets a pod of its own on them; images whose gateway cannot apply [Ollama settings](../settings/ollama.md#pod-images) stay in `IMAGES_WITHOUT_OLLAMA_SETTINGS`, so a run with some stops before creating a pod on them. Both lists keep the `ghcr.io/codenergy-dev/codeman-pod` digests pinned before the image per engine, since pods on them may still exist. An image built from this code needs neither.

## Firestore's emulator

`src/store/emulator.test.ts` runs the store's contract tests (`src/store/contract.ts`) on Firestore's emulator, the same tests the store in memory passes, and five checks that need its transactions or its rules: two runs that reserve their limits in the ledger at once never pass the monthly budget together; two Serverless runs that close at once split the time they shared on the endpoint's worker; two tasks that claim a pod's settings in the pod registry at once get one creator; two `select`s at once reserve each task of the board once; and the security rules deny every client. It uses, in this order:

1. The emulator that `FIRESTORE_EMULATOR_HOST` names (`host:port`), already running. The rules' test still needs the next one.
2. The newest `cloud-firestore-emulator-v*.jar` in Firebase's cache, `~/.cache/firebase/emulators/`, which the Firebase CLI downloads (`firebase setup:emulators:firestore`); the test starts it with `java -jar` (Java 21) on a free port of the loopback, and stops it at the end.

With neither, the tests are skipped. Each test uses a project of its own, so they share no documents. The emulator takes requests without a token, and only tests reach it: the action never reads `FIRESTORE_EMULATOR_HOST`.

## Conventions

- Write the docs as [writing the docs](documentation.md) says.
- Imports of local files use the `.ts` extension; Node runs the tests without a build step.
- Use only TypeScript syntax that can be erased (`erasableSyntaxOnly`): no `enum`, `namespace` or parameter properties.
- Keep logic in pure functions that tests can call directly. `src/main.ts` wires the steps to GitHub; nothing else picks a platform.
