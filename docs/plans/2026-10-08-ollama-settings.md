---
status: completed
created_at: 2026-10-08T23:20:05-03:00
updated_at: 2026-10-08T23:32:05-03:00
commit: b8843a0
---

# Ollama settings on pods

## Goal

A `runpod-pod` provider whose engine is `ollama` takes an `ollama:` block of settings, at the top level or in a profile, which Codeman gives the pod's Ollama server as environment variables, such as `num-parallel: 4` for `OLLAMA_NUM_PARALLEL=4`. Only the keys Codeman documents for the pinned Ollama are accepted, and a requested setting is never silently dropped.

## Context

- **Today.** A pod's gateway starts `ollama serve` with `OLLAMA_HOST=127.0.0.1:11434` and `OLLAMA_KEEP_ALIVE=-1`, pulls the model, and restarts Ollama with `OLLAMA_CONTEXT_LENGTH` set to the model's own context length (`serve` in `src/gateway/main.ts`, `prepareOllama` in `src/gateway/pod.ts`). Nothing else of Ollama is configurable, so a pod processes one request at a time (`OLLAMA_NUM_PARALLEL` defaults to 1, [FAQ](../web/ollama/faq.md#how-does-ollama-handle-concurrent-requests)): the 4 tasks that share a full-GPU pod in the test repository wait for each other's requests.
- **The source.** The pod image pins Ollama 0.35.1 (`docker/pod/Dockerfile`). Its FAQ names some server variables; the complete list is its `envconfig` source at the tag, recorded in full ([envconfig/config.go at v0.35.1](../web/ollama/envconfig-config-go-at-v0-35-1.md), MIT). Ollama ignores a variable it does not know, so a typo would be silently lost.
- **Memory.** Ollama's K/V cache grows with `OLLAMA_NUM_PARALLEL` × `OLLAMA_CONTEXT_LENGTH` ([FAQ](../web/ollama/faq.md#how-does-ollama-handle-concurrent-requests)). Codeman sets the model's own context length today, which may be too large for 4 parallel requests on one GPU, so the context length must be settable too.
- **The image.** The gateway runs in the pod image, so passing settings to Ollama changes `dist/gateway.js`, and needs a new image. The image pinned now (`POD_IMAGE`, `sha256:3252d41775a230249490b5af79aec050151e49c4722bb62f9ce3d247d02f6ca3`) serves several runs at once but cannot apply Ollama settings; the one before it (`SINGLE_RUN_IMAGES`) serves one run at a time.
- **GPU IDs.** `gpu` takes Runpod's GPU ID, whose list is Runpod's GPU types page, now recorded ([GPU types](../web/runpod/gpu-types.md)).
- **Constraints.** No new dependency. The settings file stays the strict YAML subset of `src/yaml.ts`, which already reads nested block mappings. Pods without Ollama settings keep their settings key, so the pods that serve now are still found.

## Decisions

Answered by the responsible person on 2026-10-08.

1. **Where the settings go.** Options: (a) top-level settings named after the variables, such as `ollama-num-parallel`; (b) an `ollama:` block, whose keys are Ollama's variables in the file's kebab-case.

   **Answer:** (b). `runpod-pod` accepts `ollama:` when its engine is `ollama`, at the top level or in a profile, inherited and overridden like the provider's other settings, and dropped when a layer or profile changes provider. Each key becomes the server's variable: `num-parallel: 4` → `OLLAMA_NUM_PARALLEL=4`; `context-length: 65536` → `OLLAMA_CONTEXT_LENGTH=65536`, which replaces the model's own context length that Codeman sets today.

2. **Which keys.** Options: (a) any key, passed through as `OLLAMA_<KEY>`: nothing to maintain, but a typo is silently ignored by Ollama, and keys such as `host` would break the gateway's guarantees; (b) a closed list: only the keys documented in a table for the Ollama version in the pod image, the same list in the code and the docs, checked by a test.

   **Answer:** (b). An unknown key stops the run with an error. Keys Codeman controls (`host`, `models`, `keep-alive`, `origins`, and any other that would break the gateway's guarantees: Ollama only on the pod's loopback behind the gateway, the model kept loaded) are refused with an explanation. Values are checked by type where the table gives one.

3. **Pods and images.** The Ollama settings are part of the pod's settings key, so tasks with different Ollama settings never share a pod; the pod receives them in its environment and the gateway passes them to Ollama. This needs a new pod image: the responsible person pushes, the pod image workflow publishes it, and they send the digest to pin in `POD_IMAGE`. Pods and images that cannot apply Ollama settings are handled conservatively: a requested setting is never silently dropped (choice 8).

4. **GPU types page.** Runpod's GPU types page is recorded in `docs/web/runpod/` (in Codeman's own words, since Runpod's documentation has no license: `gpu` takes the GPU type's ID, with examples) and linked from [Runpod's installation](../installation/runpod.md) where `gpu` is explained.

### Choices made while writing the plan

Settled conservatively, within the decisions above.

5. **The keys.** Accepted, from 0.35.1's `envconfig`, those that tune how the pod's server serves its one model:

   | Key | Variable | Value |
   | --- | --- | --- |
   | `context-length` | `OLLAMA_CONTEXT_LENGTH` | Whole number, at least 1 |
   | `num-parallel` | `OLLAMA_NUM_PARALLEL` | Whole number, at least 1 |
   | `max-queue` | `OLLAMA_MAX_QUEUE` | Whole number, at least 1 |
   | `flash-attention` | `OLLAMA_FLASH_ATTENTION` | `true` or `false` |
   | `kv-cache-type` | `OLLAMA_KV_CACHE_TYPE` | `f16`, `q8_0` or `q4_0` |
   | `gpu-overhead` | `OLLAMA_GPU_OVERHEAD` | Whole number of bytes |
   | `sched-spread` | `OLLAMA_SCHED_SPREAD` | `true` or `false` |
   | `load-timeout` | `OLLAMA_LOAD_TIMEOUT` | A duration, such as `10m`, or whole seconds |

   Refused, each with its reason: `host` and `origins` (only the gateway reaches Ollama, on the pod's loopback), `keep-alive` (the model stays loaded while the pod lives), `models` (the model goes where the image keeps models, on the disk Codeman sizes for it), `remotes` (remote models would send the runs' requests off the pod), `debug-log-requests` (it writes the runs' requests, the repository's code in them, to the pod's disk). Every other key, Ollama's other variables included (`debug`, `max-loaded-models`, `no-cloud`, client-only ones such as `editor`), is unknown: the error lists the accepted keys. A key written as the variable (`OLLAMA_NUM_PARALLEL`, or `num_parallel`) gets an error that gives the kebab-case key.
6. **Inheritance is per key.** Each key of the block behaves as one provider setting: a layer or profile on the same provider keeps the keys it inherits and replaces those it sets, so an organization's `num-parallel` and a profile's `context-length` both apply; a layer or profile that names another provider drops the whole block (the [provider settings across layers](../settings/provider-settings-across-layers.md) rule). No `/codeman set` or workflow input sets Ollama keys.
7. **How the pod receives them.** One variable, `CODEMAN_OLLAMA`, holds the variables as JSON (`{"OLLAMA_NUM_PARALLEL":"4"}`), set only when there are some. The gateway checks it against the same list (refusing what Codeman controls), gives Ollama those variables on every start, then its own `OLLAMA_HOST` and `OLLAMA_KEEP_ALIVE`, which always win, logs them, and reports them in `/admin/status` as `ollama`. A pod whose `CODEMAN_OLLAMA` it cannot read terminates itself, saying why. With `context-length`, the gateway does not restart Ollama with the model's own context length, and reports the setting's as the context length the agent is told. One variable rather than the `OLLAMA_*` variables themselves: an older gateway passes its whole environment to Ollama, so it would apply some variables and not others (it overrides the context length); with one variable it applies none, which Codeman detects.
8. **Images and pods that cannot apply them.** `open-key` refuses, before it claims or creates a pod, an image known not to apply Ollama settings when the run has some: the two images pinned before (`IMAGES_WITHOUT_OLLAMA_SETTINGS` in `src/inference/ollama.ts`, which keeps them after the new digest is pinned). The error names the image and the keys, and says no pod was created. For any other image, such as one of the `pod-image` input, Codeman checks the gateway's `ollama` report once the pod serves: a pod that does not report exactly the requested variables fails the run like a pod that did not serve (terminated when the task created it, abandoned when it joined it). Runs without Ollama settings are unchanged on every image. Until the new digest is pinned, `ollama:` on Codeman's own image stops the run with that error, at no cost.
9. **The settings key.** The pod's settings hash adds the variables, sorted, only when there are some: pods without Ollama settings keep the hash they have. The registry's documents do not change.
10. **The YAML subset.** It already reads nested block mappings. Three small changes: plain values may contain `_` (`kv-cache-type: q8_0`, and model names such as `q4_K_M`, which needed quotes); keys may contain capitals and `_`, so `OLLAMA_NUM_PARALLEL: 4` reaches the settings' error that gives its kebab-case key, rather than "expected `name: value`"; and a value in braces (`ollama: { num-parallel: 4 }`) gets an error that says to write the block on indented lines. Flow mappings stay outside the subset.
11. **The registry of providers.** `ollama` is a block a provider accepts for one engine (`blocks` in `src/inference/providers.ts`), beside its settings, so the errors that list what a provider takes and the providers docs test include it.

## Steps

1. Record the third-party pages: Runpod's GPU types, and Ollama's `envconfig` at v0.35.1, with the Ollama tool saying how source files are fetched. Done when `src/webdocs.test.ts` and the link checker pass.
   - **Done on 2026-10-08**: committed as `b8843a0`: [GPU types](../web/runpod/gpu-types.md), in Codeman's own words; [envconfig/config.go at v0.35.1](../web/ollama/envconfig-config-go-at-v0-35-1.md), a full copy (the tag's `LICENSE` is MIT); the [Ollama tool](../web/tools/ollama.md) has a "Source files" item. Both tests pass.
2. Write this plan. Done when it is committed with status `pending`, then set `in progress`.
   - **Done on 2026-10-08**: committed as `deb08bb` with status `pending`, then set `in progress`.
3. The list and the settings: the keys, their variables, types and the refused keys in `src/inference/ollama.ts`; the `ollama` block in the registry, `src/settings.ts` (parsing at the top level and in profiles, per-key inheritance, dropping on a change of provider, errors with their lines, the log's settings line) and `src/yaml.ts` (choice 10). Done when `src/settings.test.ts` and `src/inference/providers.test.ts` cover each rule and error, and `npm run typecheck` passes.
   - **Done on 2026-10-08**: `OLLAMA_SETTINGS` (8 keys with their variable and value), `REFUSED_OLLAMA_SETTINGS` (6 keys with their reason), `ollamaSetting`, `ollamaEnvironment` and `parseOllamaVariables` in `src/inference/ollama.ts`, with `src/inference/ollama.test.ts`. The registry has `PROVIDER_BLOCKS` and `runpod-pod`'s `blocks: { ollama: { engine: "ollama" } }`; `providerProblem` refuses the block on other providers and checks its keys. `src/settings.ts` reads `ollama` at the top level and in profiles (`ollamaBlock`), inherits it key by key in `serving`, drops it with the other provider settings, and shows it in the log's line. `src/yaml.ts`: keys with capitals and `_`, `_` in plain values, and the braces error. Tests in `src/settings.test.ts` ("Ollama settings on pods") and `src/inference/providers.test.ts`.
4. The run: the `inference` choice carries the block (checked again when read), the pod's settings key and environment, the refusal of known images and the check of the gateway's report (`src/inference/index.ts`, `src/inference/selfhosted.ts`). Done when tests cover: a key unchanged without settings and different with them; `CODEMAN_OLLAMA` in a new pod's environment; the pinned image refused before any pod is created; a gateway that does not report the settings failing the run.
   - **Done on 2026-10-08**: the `runpod-pod` choice has `ollama` (by key) only when there are some, and `parseInferenceChoice` checks it again; `selfHosted` gives `PodInference` the variables (`ollamaEnvironment`). `podSettingsKey` adds them only when there are some; `#launch` sets `CODEMAN_OLLAMA`; `open` refuses an image of `IMAGES_WITHOUT_OLLAMA_SETTINGS` before the sweep (`#checkImage`); `#attach` reads the gateway's status when the run has Ollama settings, and fails unless its `ollama` is exactly the variables. The fake gateway reports a `version`, and its real gateway the pod's variables. Tests in `src/inference/selfhosted.test.ts` and `src/inference/index.test.ts`.
5. The gateway: reading `CODEMAN_OLLAMA`, the variables on every start of Ollama with its own winning, the configured context length, the log line, `/admin/status`, terminating on an unreadable value (`src/gateway/main.ts`, `src/gateway/pod.ts`, `src/gateway/gateway.ts`). Done when `src/gateway/pod.test.ts` covers the parsing and the context length.
   - **Done on 2026-10-08**: `podSettings` reads `CODEMAN_OLLAMA` (`parseOllamaVariables`); `main` terminates the pod when it cannot ("its Ollama settings cannot be applied: …"), logs "Ollama settings: OLLAMA_NUM_PARALLEL=4.", and starts Ollama with `ollamaServeEnvironment` (the gateway's environment, the variables, then `OLLAMA_HOST`, `OLLAMA_KEEP_ALIVE` and the restart's context length). `prepareOllama` takes the configured context length: no restart, and that one reported. The gateway's `/admin/status` has `ollama`. Tests in `src/gateway/pod.test.ts`.
6. Docs and templates: a page for the Ollama settings with the table of accepted and refused keys (variable, type, Ollama's default, meaning, the version they come from), checked against the code by a test; [providers](../settings/providers.md) for `runpod-pod`; [settings](../settings/reference.md); [provider settings across layers](../settings/provider-settings-across-layers.md); [pods](../inference/pods.md); [Runpod's installation](../installation/runpod.md) with the GPU types page and an `ollama:` example; [development](../development/guide.md); `docs/README.md`; `templates/settings.yml`. Done when the docs tests and the template test pass.
   - **Done on 2026-10-08**: [Ollama settings](../settings/ollama.md) has the example, the tables of accepted and refused keys (from Ollama 0.35.1), the errors, how they apply, memory, pod images and how to add a key; `src/inference/ollama.test.ts` checks its tables against the code, `OLLAMA_VERSION` against the Dockerfile, and that the source page is recorded. [Providers](../settings/providers.md) has the `ollama` row (its test now takes the registry's blocks) and the pod image; [settings](../settings/reference.md), [provider settings across layers](../settings/provider-settings-across-layers.md) (key by key), [pods](../inference/pods.md), [Runpod's installation](../installation/runpod.md) (the recorded GPU types page and an `ollama:` example), [development](../development/guide.md), [dependencies](../development/dependencies.md) and `docs/README.md` follow. `templates/settings.yml` has a commented `ollama:` block in `runpod-pod`'s, which the template test reads.
7. Rebuild `dist/` and run `npm run check`. Done when it passes, the working tree is clean, and `dist/gateway.js` has changed, which needs a new pod image (the end-to-end test's first step).
   - **Done on 2026-10-08**: `npm run check` passes: 505 tests, 503 pass and 2 skipped (the sandbox's, Linux runners only). `dist/index.js` and `dist/gateway.js` changed: a new pod image is needed, and its digest pinned in `POD_IMAGE` (end-to-end test, step 1). Until then, `ollama:` stops runs on Codeman's own image before any pod is created.

## End-to-end test

By the responsible person, on the test repository, after pushing. Costs are estimates; check Runpod's current prices.

1. **Publish and pin the image.** Push; the pod image workflow publishes `ghcr.io/codenergy-dev/codeman-pod` from the new `dist/gateway.js`. Send its digest; it is pinned in `POD_IMAGE` in a commit of its own, and the image pinned now stays in `IMAGES_WITHOUT_OLLAMA_SETTINGS`. Cost: none.
2. **Errors, at no cost.** In `.codeman/settings.yml`, in the full-GPU profile, write `ollama:` with `num_parallel: 4`: `select` fails, naming the line, with the kebab-case key `num-parallel`. Then `host: 0.0.0.0`: it fails with the reason. Then `num-parallel: four`: it fails with the value's type. Before pinning the new image (or with `pod-image` set to the image pinned now), a valid block makes `open-key` fail with the image's error, and no pod is created. Cost: none.
3. **Four parallel requests on the full GPU.** The profile that takes exactly 4 tasks on `NVIDIA RTX PRO 6000 Blackwell Server Edition`, with `qwen3.8:27b-mtp-q4_K_M`, gets a block written in block style:

   ```yaml
       ollama:
         num-parallel: 4
         context-length: 65536
   ```

   With 4 tasks ready past planning, start a run. Check: the pod's environment in Runpod's console has `CODEMAN_OLLAMA={"OLLAMA_CONTEXT_LENGTH":"65536","OLLAMA_NUM_PARALLEL":"4"}`; the pod's log has the gateway's line naming both variables, and Ollama's own startup line of its configuration shows `OLLAMA_NUM_PARALLEL:4` and `OLLAMA_CONTEXT_LENGTH:65536`; `open-key`'s log reports a context length of 65536; while the 4 agents work, Ollama's log shows requests answered at overlapping times (several requests in progress at once, rather than one after another), and the runs end sooner than the same tasks did with one request at a time. Memory: Ollama's K/V cache scales with `num-parallel` × `context-length`, so 4 × 65,536 tokens must fit beside the model in 96 GB; if Ollama's log shows the model offloaded to the CPU, or it fails to load, lower `context-length` (such as 32768) or set `kv-cache-type: q8_0`. Cost: about 15 to 30 minutes of the full GPU, around US$ 1 to 2.
4. **The MIG profile.** The profile with `max-tasks: 3` on `NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 2g.48gb` gets `ollama:` with `num-parallel: 3` and a smaller `context-length`, such as 32768, since the partition has 48 GB. With 2 or 3 tasks ready, a run shares one MIG pod, created with its own settings key (not the full-GPU pod's). Cost: about 10 to 20 minutes of the partition, under US$ 0.50.
5. **Settings change the pod.** Change the MIG profile's `num-parallel` while its pod is kept: the next run creates a new pod for the new settings, and the kept one terminates when its keep lease ends. Cost: one more pod start, a few cents.

## Out of scope

- vLLM settings on pods, and a vLLM engine on pods.
- Per-request model options, such as `num_ctx` in API calls.
- Setting Ollama keys with `/codeman set` or the workflow's inputs.
- Ollama variables not in the table; adding one is a change of the list, its docs and its test, after checking it against the pinned version's source.
