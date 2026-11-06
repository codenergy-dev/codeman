---
status: in progress
created_at: 2026-10-30T16:20:00-03:00
updated_at: 2026-11-06T15:08:00-03:00
commit: 0bbb10d
---

# Start pods from official engine images

## Goal

A pod starts from its engine's official image, pinned by digest, and gets Codeman's gateway through a bootstrap that verifies every file it downloads. Before creating a pod, `open-key` checks each artifact against the release policy: minimum age, advisories, provenance. Codeman stops building one pod image per engine. This is part 1 of the multi-service pods work: a pod still serves one service.

## Context

- **Where it comes from.** The [investigation of multi-service pods](2026-10-30-investigate-multi-service-pods.md) decided the direction:
  - Decision 6: resolve outside, verify inside.
  - Decision 7: the primary engine is the pod's image.
  - Decisions A to G: the policy.
  - Its experiments showed that the bootstrap works in the official Ollama, vLLM and vLLM-Omni images, and that the Ollama image has no downloader but `openssl`.
- **What it unblocks.**
  - Part 2, the supervisor of several services, adds secondary engines on top of this bootstrap.
  - Later, settings let people choose their engine and version. Until then, Codeman pins them, as it does today.

### What changes

| Today | After this plan |
| --- | --- |
| `docker/pod/Dockerfile` builds `codeman-ollama` and `codeman-vllm`: the official image with Node and `dist/gateway.js` copied in. `.github/workflows/pod-image.yml` publishes them to GHCR, and `src/inference/images.ts` pins them | `src/inference/images.ts` pins the official images by digest, with their engine's version and publication date |
| The image's entry point is the gateway | The pod's command, set through Runpod's `entrypoint`/`cmd` and Salad's `container.command`, is the bootstrap ([Runpod REST API](../web/runpod/runpod-rest-api.md#the-containers-command), [Salad](../web/salad/specifying-a-command.md)) |
| The gateway's version is in the image's digest, so the pod settings key separates pods by Codeman commit | The gateway's SHA-256 joins the pod settings key (`podSettingsKey`), so pods with different gateways never mix |
| The gateway refuses an image whose `CODEMAN_IMAGE_ENGINE` differs from the requested engine | The engine comes from the environment, so that check proves nothing and goes ([E1](2026-10-30-investigate-multi-service-pods.md#e1-the-gateway-injected-into-official-images)) |
| Releases are audited by hand when pinned ([audit log](../development/dependencies.md#audit-log)) | `open-key` also checks them on every pod it creates, so an advisory published after the pin is caught |

### The bootstrap, in two stages (decision G of the investigation)

1. **Shell, in the pod's command.**
   - It downloads Node's linux-x64 tarball from `nodejs.org` with the first tool it finds: `curl`, `wget`, `python3`, or `openssl s_client`.
   - It checks the SHA-256 with `sha256sum`, `openssl dgst` or Python.
   - It extracts only `bin/node`.
   - Any mismatch or failure exits before anything runs.
2. **Node, a short inline script in the same command.** It downloads `gateway.js`, following redirects, checks its SHA-256, then runs it.

Salad allows at most 100 command items of at most 1,000 characters each. The experiment's command took 73 items, the longest 111 characters ([E1](2026-10-30-investigate-multi-service-pods.md#e1-the-gateway-injected-into-official-images)).

### The policy at `open-key`

The [recommendations](2026-10-30-investigate-multi-service-pods.md#recommendations), approved on 2026-10-30:

| Check | Applied to | Blocks when |
| --- | --- | --- |
| Minimum age: 7 days | The engine's image and its engine package, Node | Younger than 7 days, unless it is the earliest release that fixes a blocking advisory of the release it replaces |
| Advisories (OSV.dev) | The engine package: `github.com/ollama/ollama` (Go), `vllm` (PyPI). Node, as decision 9 settles | High or critical, unless an exception with its reason allows it |
| Provenance | Every artifact | Never in this plan: it is recorded |
| OS packages (Trivy) | The image | Not checked at run time: checked when a release is pinned (decision 4) |

A block is a mistake in the settings, not a reason to [fall back](../settings/profiles.md#fallback): the run stops with an error that names the artifact, the advisory and how to move on.

## Decisions

Answered by the maintainer on 2026-10-30: each as its recommendation.

1. **Engine versions.** Under the policy, vLLM 0.31.0 is blocked: it has 2 high advisories, fixed in 0.32.0 ([E3](2026-10-30-investigate-multi-service-pods.md#e3-resolving-outside-with-the-policy)). Ollama 0.35.1's own 9 advisories have no fix.
   - **Options:**
     - (a) Upgrade vLLM to 0.32.0, and give Ollama 0.35.1 exceptions with their reasons.
     - (b) Also look for a newer Ollama that fixes some of them.
     - (c) Keep both, with exceptions for every advisory.
   - **Recommendation:** (a) and (b). vLLM 0.32.0 passes through the security fix bypass. It needs its CUDA requirement checked again (`VLLM_MIN_CUDA`). Each Ollama exception gets the reason its advisory does not apply to an engine on the pod's loopback, or the reason it is accepted.
2. **Where exceptions live while Codeman pins the engines.**
   - **Options:**
     - (a) In Codeman's code, beside the pins: a list of advisory IDs with their reasons, reviewed in each commit that pins.
     - (b) In the settings files now.
   - **Recommendation:** (a). The settings key comes with the settings that choose engines. Until then, a repository cannot change the engine, so it has nothing to accept.
3. **Where the pod downloads the gateway from.**
   - **Options:**
     - (a) `https://raw.githubusercontent.com/<repository>/<commit>/dist/gateway.js`, at the commit the action runs from (`actionCommit`). Its SHA-256 is computed by `open-key` from its own copy of `dist/gateway.js`, which is committed.
     - (b) An asset of a GitHub release, published per commit.
     - (c) GHCR, as an OCI artifact.
   - **Recommendation:** (a). Nothing new to publish, and the file the pod runs is the one the action holds.
     - The URL serves the file without a redirect, so even stage 1 could fetch it.
     - A run whose commit is unknown, such as a local build, stops before creating a pod.
4. **Scanning OS packages.**
   - **Options:**
     - (a) A maintainer runs `scripts/scan-image.sh` (Trivy, pinned by digest) when pinning a release, and records the result in the audit log.
     - (b) A job of `ci.yml` scans every pinned image.
     - (c) A job before `open-key` scans at run time, cached per digest in the backend.
   - **Recommendation:** (a) in this plan. While Codeman pins the images, the commit that pins them is the cache. (c) comes with the settings that let people choose images. (b) changes CI and adds 30 to 40 minutes per change ([E5](2026-10-30-investigate-multi-service-pods.md#e5-scanning-os-packages)).
5. **Codeman's own pod images.**
   - **Options:**
     - (a) Remove `docker/pod/Dockerfile`'s targets and `.github/workflows/pod-image.yml`, and keep the images already published on GHCR, untouched.
     - (b) Keep publishing them as a fallback.
   - **Recommendation:** (a).
     - Deleting published images cannot be undone, and pods created from them may still be running, so they stay.
     - `IMAGES_BEFORE_SALAD` and the other lists of older images stay.
     - Removing the workflow is a change to CI.
6. **The pod registry.**
   - **Options:**
     - (a) Add a `resolution` field to each pod's document: every artifact's URL, SHA-256 and age, the advisories found and the exceptions used, and the provenance.
     - (b) Keep it only in the run's log.
   - **Recommendation:** (a). It is an additive change to the storage schema ([data layout](../backend/data-layout.md#pod-registry)), and the pod's record is where a later audit looks.
7. **When OSV.dev does not answer.**
   - **Options:**
     - (a) Stop the run with an error that says so.
     - (b) Go on with a warning when the same artifact passed within the last 24 hours, recorded in the backend; stop otherwise.
     - (c) Go on with a warning.
   - **Recommendation:** (b). One outage at OSV.dev should not stop every pod, and a result older than a day is not trusted.
8. **The `pod-image` input.** It overrides the Ollama image today.
   - **Options:**
     - (a) Keep it, now for an image the bootstrap starts in: any image with `sh` and glibc. The release policy does not check it, since the person chose it.
     - (b) Remove it.
   - **Recommendation:** (a). Removing it changes a public interface; its docs say what it no longer guarantees.
9. **Node's own release.**
   - **What was checked.**
     - Node 24.21.0's bundled root store trusts `emSign ECC Root CA - G3` ([`node_root_certs.h` at v24.21.0](../web/nodejs/node-src-node-root-certs-h-at-955266b.md)). Eight intermediates under it had their keys compromised (GHSA-hq85-5cpj-mr62, [uv's notice](../web/uv/removal-of-emsign-root-certificate.md)).
     - Node 24.22.1, the security release of 2026-10-21, removes that root and blocks the eight intermediates ([v24.22.1](../web/nodejs/node-v24-22-1.md), [security releases](../web/nodejs/wednesday-october-21-2026-security-releases.md)). It is the earliest fix, and older than 7 days.
     - The action's steps run on the runner's Node, which bundles 24.22.1 from runner 2.338.1 on ([externals.sh at d1eb12d](../web/github/runner-src-misc-externals-sh-at-d1eb12d.md)).
     - The pod images pin Node 24.21.0, and their gateway calls `api.runpod.io` with the Runpod key over TLS.
   - **Options:**
     - (a) This plan fetches Node 24.22.1 into pods, and Node's advisories are checked by hand when it is pinned. OSV covers no Node.js release, so its security releases are the source.
     - (b) The same, plus a separate fix on `main` now: `node:24.22.1-bookworm-slim` in `docker/pod/Dockerfile` and `docker/runner/Dockerfile`, with the pod images published and pinned again.
   - **Recommendation:** (b). This plan's pods take months to reach `main`, and today's pods are exposed until then. The fix on `main` upgrades a dependency, and publishing the images is the usual step of [pod images](../development/guide.md#pod-images).
10. **vLLM 0.32.0's scan.** Added on 2026-10-30 by step 9, answered on 2026-10-31: as recommended.
   - **What was found.** Trivy found 23 high or critical findings with a fix in the image, and there is no newer vLLM.
     - 22 are in packages that Codeman's path through the pod does not run: GnuPG, OpenSSL's PKCS7 and DTLS, `uv`, `setuptools`, `msgpack`, `urllib3`, Brotli.
     - The 23rd is `certifi` (GHSA-6q48-6c7w-9gw2). It trusts the same compromised emSign root, and vLLM downloads the model's weights from Hugging Face over TLS with it. Ollama, a Go program, reads the image's system store instead.
   - **Options:**
     - (a) Accept the 22 with their reasons in the audit log. For the 23rd, the gateway writes the roots of its own Node 24.22.1 (`tls.rootCertificates`) to a file, and points its engine at it with `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE`, for both engines.
     - (b) Accept all 23.
     - (c) Keep vLLM 0.31.0 until a newer vLLM.
   - **Recommendation:** (a). It adds no dependency, and the engines then trust exactly what the pod's Node trusts.
   - **Done on 2026-10-31,** with a fourth variable, `SSL_CERT_DIR`, pointing at the file's directory: Go and OpenSSL add every root of `/etc/ssl/certs` to `SSL_CERT_FILE`'s, and vLLM's system store still trusts the emSign root too. The four replace the image's values ([the engines' trusted roots](../development/dependencies.md#the-engines-trusted-roots)).

## Steps

The steps start once the decisions are answered. Subagents carry them out, one step or a group of independent steps each; commits are made on `features/multi-service-pods`.

1. **Record what is missing in `docs/web/`.** Node's download page and `SHASUMS256.txt`, and how `raw.githubusercontent.com` serves a file. Done when each page the steps rely on is recorded.
2. **The release policy** (`src/inference/release-policy.ts`, with OSV in `src/inference/osv.ts` on `fetch`). The minimum age with the bypass, severities and exceptions, the provenance recorded, and the 24-hour rule of decision 7. Done when unit tests cover each rule with fixtures, E3's cases included.
3. **The catalog of pinned artifacts** (`src/inference/images.ts`): official images by digest, each with its engine's coordinates, version and publication date, plus Node's tarball by URL and SHA-256. The gateway's URL and SHA-256 are computed at run time. Done when the tests read the catalog and the engines of decision 1 are pinned.
   - The engines' upgrade checklists ran for both pins: `OLLAMA_VERSION` and `VLLM_VERSION` follow the catalog, a test compares them, and the e2e suite's vLLM CPU image moves to `v0.32.0` ([dependencies](../development/dependencies.md#ollama)).
4. **The bootstrap** (`src/gateway/bootstrap.ts`). It builds the two-stage command as provider command lines.
   - Unit tests check:
     - Salad's limits;
     - the fallback to each downloader;
     - the refusal of a mismatch;
     - that nothing runs before the checks.
   - A test runs the real command in `sh` against a local server. Done when these pass.
5. **The providers.** Runpod's create sets `entrypoint`/`cmd`, and Salad's sets `container.command`; the environment carries the artifacts' URLs and digests. The gateway's SHA-256 joins `podSettingsKey`. Done when their tests and fakes pass.
6. **The gateway.** It drops the image-engine check, and fixes what E1 found in its start on another image. Done when `src/gateway/` tests pass.
7. **`open-key`.**
   - It resolves the catalog's artifacts and applies the policy before claiming or creating a pod.
   - It logs the result and records it in the pod's document (decision 6).
   - A block stops the run with its reason.
   - Done when `src/steps/keys.test.ts` and `src/inference/selfhosted.test.ts` cover a pass, a block, an exception and an OSV outage.
8. **The end-to-end suite.**
   - Fakes serve Node's tarball and the gateway.
   - Pods start from the official CPU images (`vllm/vllm-openai-cpu`, `ollama/ollama`) through the bootstrap.
   - A fake OSV answers.
   - Done when `npm run test:e2e` passes, with a scenario of a blocked release.
9. **Scanning when pinning.** `scripts/scan-image.sh` (Trivy pinned by digest, skipping `linux-libc-dev`), and an audit log row for each pinned image, Trivy's own audit included. Done when the pinned images are scanned and recorded.
10. **Codeman's images retire** (decision 5). Remove the Dockerfile's pod targets and `pod-image.yml`. Done when nothing in the repository builds or publishes pod images.
11. **The docs.**
    - Settings pages: [providers](../settings/providers.md), [vLLM](../settings/vllm.md#pod-images), [pod engines](../settings/pod-engines.md#pod-images).
    - Contributing pages: [development](../development/guide.md#pod-images), [dependencies](../development/dependencies.md).
    - Operating and security: [upgrading](../installation/upgrading.md), [risks](../security/risks.md) (the new hosts a pod reaches), [data layout](../backend/data-layout.md#pod-registry).
    - A page for the release policy, linked from [`docs/README.md`](../README.md).

    Done when each page describes the new behavior and `docs/README.md` lists the new page.
12. **Checks.** Done when `npm run check` and `npm run test:e2e` pass.

## Handover

A live test is needed before merging, done by the maintainer on a test repository:
- a `runpod-pod` and a `salad-pod` task on each engine;
- their pods started through the bootstrap from the official images;
- one task whose release is blocked.

The live test of part 2 adds the GPU measurements listed in the [investigation](2026-10-30-investigate-multi-service-pods.md#what-only-a-gpu-can-tell).

## Out of scope

- Several services in one pod, secondary engines and the supervisor: part 2.
- Settings that choose an engine, its version or its exceptions.
- Scanning images at run time.
- Deleting the images published on GHCR.
- Merging this branch.

## Progress

As of 2026-11-04. The work is paused until the maintainer says to continue, and these decisions wait for them: the 4 `pyasn1` findings, a way past the minimum age for an urgent Node.js fix, the minimum age covering only the image and Node.js, `undici`'s advisory, advisories with only a CVSS 2 or 4 score, and the five of the [plan for GitHub's runners](2026-11-04-run-e2e-on-github-runners.md#decisions).

### Done on `features/multi-service-pods`

- Steps 2 to 11.
- Ollama 0.40.10's and vLLM 0.32.0's upgrade checklists.
- Decision 10: the engines trust the gateway's Node roots.
- `8b3ae41`: vLLM's tool-call probe outlasts a cold engine's first request, which caused the extra request in `parallel/vllm-two-seats`.
- At 8b3ae41: lint, typecheck, build and unit tests pass (1,081 passed, 6 skipped), and the e2e suite passes, 49 of 49, in 134 minutes.

### Done elsewhere, not yet merged

The fix for Node on `main`, on the branch `fixes/node-24-22-1`, in the worktree `../codeman-node-fix`:
- `0d8ab87`: Node 24.21.0 → 24.22.1;
- `3dc42ad`: the e2e job image is built again every session.

Its first e2e run failed every scenario on a stale job image, which `3dc42ad` fixes. It has not run again since.

### Next

1. Done on 2026-11-06. `fixes/node-24-22-1` reached `main` with the [workflow that runs the e2e suite](2026-11-04-run-e2e-on-github-runners.md#decisions) (`f00d362`), and all 48 scenarios passed on GitHub's runner. `0f9bb8c`, on `main`, pins the pod images published from `f00d362`. Next, merge `main` into this branch: expect conflicts in `docs/development/dependencies.md` and `docs/development/e2e/suite.md`.
2. The maintainer decides on the 4 `pyasn1` findings of the scan of 2026-11-04, in the [audit log](../development/dependencies.md#audit-log).
3. The audit gaps step 11 found: OSV.dev has no audit log row, and `docs/web/` has no page on how raw.githubusercontent.com serves a file.
4. The comment in `docker/runner/Dockerfile` about "the version of the pod images" goes stale here: fix it after the Node branch, which changes the next line, is merged.
5. Step 12: `npm run check` (with `biome ci` on the repository's directories, not `.`, while worktrees live under `.claude/`). The e2e suite last passed at 8b3ae41; later commits change only docs and an input's description.
6. Remove the agents' worktrees and branches (`git worktree remove`).
7. Hand over to the live test, then write part 2's plan.
