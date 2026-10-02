---
status: pending
created_at: 2026-10-02T18:25:00-03:00
updated_at: 2026-10-02T18:25:00-03:00
commit: d0637c8
---

# Self-hosted inference

## Goal

A task can run its agents on a model that Codeman serves on rented GPUs, instead of through OpenRouter. The first implementation is Runpod for the GPUs and Ollama as the inference engine, each behind an interface so others (Salad, vLLM) can be added. A metrics layer gives the same figures OpenRouter gives (cost, input and output tokens, context length and tokens per second per run), by combining the GPU provider's billing with what the engine reports.

## Context

OpenRouter does four things for Codeman today ([budget](../architecture.md#budget)):

| What | How, with OpenRouter | What replaces it |
| --- | --- | --- |
| Model access | OpenAI-compatible API; OpenCode's `openrouter` provider. | The engine's OpenAI-compatible API on a GPU, behind a gateway. |
| A credential per run, with a spending limit | A key per run, limited to what remains of the task's budget, disabled after the run. | A token per run, valid for the pod's life, and a pod that lives at most limit ÷ price per second. |
| What a task and a repository spent | Usage of the keys whose name has the task's or the repository's prefix. | The GPU provider's billing, by pod. |
| Tokens and performance | The analytics API, by key hash. | What the engine reports for each request, recorded by the gateway. |

The cost model changes. OpenRouter charges per token; a GPU provider charges per second while the pod exists, whether or not the agent is generating, from the moment it starts pulling the image and the model.

The layers:

- **`InferenceProvider`**: what the jobs see. `open` (for a run, with a limit) returns a base URL, a credential and a handle; `close` returns the run's usage; `taskSpent` and `monthSpent` add up. OpenRouter becomes one implementation ([`src/budget.ts`](../../src/budget.ts) and [`src/steps/keys.ts`](../../src/steps/keys.ts) today); self-hosted is the other.
- **`GpuProvider`**: price per second of a GPU type, create a pod (image, environment, exposed port, GPU, name), wait until it is ready, its URL, terminate, list Codeman's pods, and billing by pod. Runpod first; Salad and others later.
- **`InferenceEngine`**: the image and settings to serve a model (for Ollama: the model to pull, `OLLAMA_CONTEXT_LENGTH`, keep-alive), its health check, its OpenAI-compatible path, and how to read usage from its responses. Ollama first; vLLM and others later.
- **Gateway (the metrics API)**: a small HTTP server in the pod, in front of the engine. It accepts only the run's token, forwards requests to the engine, and records each one: input and output tokens, generation time, time to first token. `GET /usage`, with a separate token that only `close-key` holds, returns them in OpenRouter's terms. The engine's port is never exposed.

What was found while writing this plan (2026-10-02), to verify in step 1:

- Runpod's REST API (`https://rest.runpod.io/v1`) creates, stops and terminates pods, and `GET /billing/pods` filters by `podId` and returns `amount` (USD) and `timeBilledMs`. A pod sees its own ID in `RUNPOD_POD_ID`. Exposed HTTP ports are reached through a public URL (`https://<pod>-<port>.proxy.runpod.net`), so the gateway must authenticate.
- Ollama reports per request `prompt_eval_count`, `eval_count`, `eval_duration` and `prompt_eval_duration` (nanoseconds). Its API has no authentication. Its default context window is small, and a longer prompt is cut without an error, so the engine must set the context length to what the model supports.
- Ollama may count in `prompt_eval_count` only the prompt it evaluated, leaving out what it reused from its cache. OpenRouter's `tokens_prompt` includes cached tokens. If that holds, the gateway counts the prompt another way, or the difference is documented.

Risks:

- **A pod that outlives its run keeps billing.** A failed `close-key`, a cancelled workflow or a crash must not leave a pod running. Three guards: `close-key` terminates it, the pod terminates itself at its deadline, and `open-key` terminates any Codeman pod past its deadline before creating a new one.
- **The repository's code leaves GitHub for a GPU host.** With OpenRouter it goes to the model's provider; here it goes to Runpod and, on its Community Cloud, to hosts run by third parties.
- **Cold start.** Pulling a large model can take minutes, billed, on every run.

This plan depends on [`2026-10-02-context-and-throughput`](2026-10-02-context-and-throughput.md): the spend row's fields and the meaning of each figure come from it.

### Preliminary audit

To complete in step 1 and record in [`docs/dependencies.md`](../dependencies.md). No npm package is planned: the Runpod REST API is called with `fetch`, as OpenRouter's is.

| Component | What it is | Notes |
| --- | --- | --- |
| Runpod | Paid GPU cloud, per-second billing. | Needs a new secret, `CODEMAN_RUNPOD_API_KEY`, in `open-key` and `close-key` only. Check scoped API keys, data handling on Secure and Community Cloud, and terms. |
| Ollama | Inference server, MIT, very active. | Runs from its official image, pinned by digest. Past vulnerabilities include path traversal and unauthenticated access to an exposed API; its port stays inside the pod. |
| Gateway | Code Codeman writes. | Per decision 3, in an image Codeman publishes or delivered at start. |

## Decisions

Answer these before work starts.

1. **Pod lifecycle.** Options:
   - (a) One pod per run: `open-key` creates it, `close-key` terminates it. The run's cost is that pod's billing.
   - (b) One pod per task, kept between its runs and terminated when the task stops moving.
   - (c) A long-lived pod shared by every task, with costs split by tokens or time.
   - (d) Runpod Serverless, billed per second of requests only.

   Recommendation: (a). Exact cost per run, nothing shared, nothing to clean up between runs, and it maps onto today's key per run. Its cost is a cold start per run; step 7 measures it, and a network volume that caches models can follow in a plan update.
2. **Where the metrics API lives.** Options:
   - (a) The gateway in the pod records each request; `close-key` reads `/usage` before terminating the pod and combines it with the GPU provider's billing, in Codeman's code.
   - (b) A standalone service with OpenRouter-like endpoints that stores usage across runs.
   - (c) A proxy in the agent job, outside the sandbox, that records requests and forwards them to the pod.

   Recommendation: (a). The gateway is needed anyway to authenticate the public URL, and it adds no service to host, pay for or secure. (b) makes sense with shared pods (decision 1c). (c) still needs authentication on the pod.
3. **How the gateway gets into the pod.** Options:
   - (a) An image Codeman builds in its own CI, from Ollama's image pinned by digest plus the gateway, published to GitHub's container registry and referenced by digest.
   - (b) Ollama's official image, with the gateway as a script passed in the pod's start command.

   Recommendation: (a). The pod runs exactly what was reviewed, and the image is built from pinned inputs. It adds a publishing workflow to this repository, a change to CI that needs its own review.
4. **Where cost comes from.** Options:
   - (a) Computed: the pod's price per second, from the provider when it is created, times the seconds it existed.
   - (b) The provider's billing API by pod.
   - (c) Computed in `close-key`, then refreshed from billing in later runs, as costs from OpenRouter are refreshed today.

   Recommendation: (c). Billing may lag behind the pod's end, and the spend table already refreshes.
5. **The monthly budget.** Runpod cannot list terminated pods, and pod IDs do not say which repository they belong to. Options:
   - (a) The Runpod account's whole spend this month counts against the repository's monthly budget. Each repository, or each group of repositories sharing a budget, uses a Runpod account or team dedicated to Codeman.
   - (b) Each task's record keeps its pods; the repository's spend is the sum over its tasks' records.

   Recommendation: (a). It never counts less than was spent, and needs no state beyond what the provider keeps. A task's spend still comes from the pods its record lists.
6. **Runpod cloud.** Options:
   - (a) Secure Cloud only: Runpod's own data centers.
   - (b) A setting, defaulting to Secure Cloud, that allows Community Cloud.

   Recommendation: (a). Community Cloud hosts are run by third parties, and the agent sends them the repository's code.
7. **Settings.** Options:
   - (a) Separate settings: `inference` (`openrouter`, the default, or `self-hosted`), `gpu-provider` (`runpod`), `gpu-type`, `engine` (`ollama`); `model` names the engine's model (`qwen3-coder:30b`).
   - (b) One composite `model`, such as `runpod/ollama/qwen3-coder:30b@RTX-A6000`.

   Recommendation: (a). Each part is validated on its own, and `model` keeps one meaning per `inference`. Which of them `/codeman set` may change is part of the answer; the recommendation is `model` and `gpu-type`.
8. **Spending on tests.** Building and checking this needs GPU time on a Runpod account. Options:
   - (a) The responsible person sets a Runpod account with a spending cap for development, and states it here.
   - (b) Only unit tests with a fake provider until a later decision.

   Recommendation: (a), with a cap the responsible person chooses.

## Steps

1. Verify the APIs and complete the audit: create, wait for, terminate and list a pod, read its billing, and check self-termination from inside the pod with the least privileged key Runpod allows; run Ollama with the chosen context length and compare its counts with the tokens sent, cached prompt included. Done when `docs/dependencies.md` has the audit, and this plan is updated with what differs.
2. Extract `InferenceProvider` from `src/budget.ts` and `src/steps/keys.ts`, with OpenRouter as its implementation and no change in behavior. Done when `keys` tests pass unchanged in meaning and key names are identical.
3. `GpuProvider` with a Runpod adapter and a fake, and `InferenceEngine` with an Ollama adapter and a fake. Done when unit tests cover create, ready, terminate, list, billing and the deadline, without the network.
4. The gateway and its image (decision 3): token check, forwarding with streaming, a record per request, `/usage`, and termination at the deadline. Done when its tests cover a rejected token, a streamed and a non-streamed request, and `/usage`, against a fake engine.
5. The self-hosted `InferenceProvider`: `open` sweeps expired pods, creates the pod with the run's deadline (limit ÷ price per second), waits until the model is served, and outputs the URL and encrypted tokens; `close` reads `/usage`, terminates the pod and computes the run's usage (decision 4). The task's spend comes from its record's pods, the month's from the account (decision 5). Done when tests with the fakes cover a run, a failed close, an expired pod and an exceeded budget.
6. Harness and settings: OpenCode gets an OpenAI-compatible provider with the gateway's URL instead of `openrouter`, still the only provider enabled; settings per decision 7; `action.yml` and [`templates/codeman.yml`](../../templates/codeman.yml) get the new secret and outputs, unchanged for OpenRouter. Done when `settings` and `harness` tests cover both modes.
7. On the test account (decision 8): run a full task on a small model, compare cost and figures with Runpod's billing, measure the cold start, and confirm no pod is left after a cancelled workflow. Done when the results are recorded in this plan.
8. Update [`docs/architecture.md`](../architecture.md) (budget, jobs, a section on self-hosted inference), [`docs/security.md`](../security.md) (where code goes, the new secret, the public URL), [`docs/installation.md`](../installation.md) and the README's "Getting started". Done when they describe both modes.
9. Rebuild `dist/`, run `npm run check`. Done when it passes.

## Out of scope

- Adapters for other GPU providers (Salad and others) or engines (vLLM and others); only the interfaces.
- Shared or long-lived pods, Runpod Serverless and network volumes.
- Choosing which models or GPUs to recommend.
- Mixing providers within a task, such as one stage on OpenRouter and another self-hosted.
