---
status: in progress
created_at: 2026-10-02T18:25:00-03:00
updated_at: 2026-10-03T22:50:00-03:00
commit: d0637c8
---

# Self-hosted inference

## Goal

A task can run its agents on a model that Codeman serves on rented GPUs, instead of through OpenRouter. The first implementation is Runpod for the GPUs, in both of its forms (pods, billed while they exist, and serverless endpoints, billed while a worker runs), and Ollama as the inference engine on pods. Each layer sits behind an interface, so other GPU providers (Salad) and engines (vLLM) can be added. A metrics layer gives the same figures OpenRouter gives (cost, input and output tokens, context length and tokens per second per run), by combining the GPU provider's billing with what the engine reports.

## Context

OpenRouter does four things for Codeman today ([budget](../architecture.md#budget)):

| What | How, with OpenRouter | What replaces it |
| --- | --- | --- |
| Model access | OpenAI-compatible API; OpenCode's `openrouter` provider. | The engine's OpenAI-compatible API on a GPU, behind a gateway. |
| A credential per run, with a spending limit | A key per run, limited to what remains of the task's budget, disabled after the run. | A token per run, issued by the gateway, which stops serving at the run's limit. |
| What a task and a repository spent | Usage of the keys whose name has the task's or the repository's prefix. | The GPU provider's billing. |
| Tokens and performance | The analytics API, by key hash. | What the engine reports for each request, recorded by the gateway. |

The cost model changes. OpenRouter charges per token; a GPU provider charges per second of GPU, whether or not the agent is generating.

### Two ways to rent a GPU

| | Pod | Serverless endpoint |
| --- | --- | --- |
| Billed | Every second the pod exists, from the image pull on. | Every second a worker runs: start, requests and the idle timeout after them. Flex workers scale to zero. |
| Price | Lower per second. | Higher per second (flex); active workers are cheaper but always on. |
| Start | Minutes: image and model pull, every new pod. | Seconds with FlashBoot when the endpoint ran recently; longer when cold. |
| Lifecycle | Codeman creates and terminates it. | Long-lived endpoint; workers come and go. |
| Engine | Any image: Ollama, through Codeman's image. | Runpod's workers; the official one runs vLLM, with an OpenAI-compatible route at `https://api.runpod.ai/v2/<endpoint>/openai/v1`. |
| Credential | Codeman's gateway token. | A Runpod API key; restricted keys can be limited to one endpoint, but they do not expire and have no spending limit. |

A pod suits long, steady runs; an endpoint suits short runs and tasks with gaps between runs, where a pod would be idle or start cold.

### Layers

- **`InferenceProvider`**: what the jobs see. `open` (for a run, with a limit) returns a base URL, a credential and a handle; `close` returns the run's usage; `taskSpent` and `monthSpent` add up. OpenRouter becomes one implementation ([`src/budget.ts`](../../src/budget.ts) and [`src/steps/keys.ts`](../../src/steps/keys.ts) today); self-hosted is the other.
- **`GpuProvider`**, with two capabilities that an adapter implements one or both of:
  - pods: price per second of a GPU type, create (image, environment, exposed port, GPU, name), wait until ready, URL, terminate, list Codeman's pods, billing by pod;
  - serverless: an endpoint's URL, its price per second, and its billing.

  Runpod implements both.
- **`InferenceEngine`**: the image and settings to serve a model (for Ollama: the model to pull, `OLLAMA_CONTEXT_LENGTH`, keep-alive), its health check, its OpenAI-compatible path, and how to read usage from its responses. Ollama first, on pods; per decision 9, vLLM on serverless.
- **Gateway (the metrics API)**: one program, written in this repository, in front of the engine. It accepts only the run's token, forwards requests, and records each one: input and output tokens, generation time, time to first token. `GET /usage`, with a separate token that only the key jobs hold, returns them in OpenRouter's terms. It stops serving when the run's estimated cost reaches its limit. It runs in two places:
  - in the pod, in Codeman's image (decision 3), so the pod's public URL needs a token and the engine's port is never exposed;
  - for serverless, in the agent job, outside the sandbox (decision 11): it holds the endpoint's key, and the agent gets a local URL and the run's token. It writes its usage where `close-key` reads it.

### Keeping a pod for a task

The responsible person asked that a pod can serve consecutive runs of one task (decision 1), to save its start. What decides that today does not exist yet: `apply`'s `chain` output, which starts `next-run`, is true whenever the agent ran, also when the task now waits for decisions or is done. `apply` therefore gets an output that says whether the task goes on to another agent run: its new state is a stage or routing. Even then, the next run may pick another task first, such as one that needs a plan; a kept pod needs an idle limit.

Cost per run stays the time from `open` to `close` at the pod's price. The idle time between runs belongs to no run; it shows in the spend table's row for what the task spent outside its runs, since the task's total comes from the billing of its pods.

### Found while writing this plan (2026-10-02), verified in step 1 (2026-10-03)

From the documentation only: the Runpod account does not exist yet, so every check that needs one moved to step 8. Pages are in [`docs/web/runpod/`](../web/runpod/) and [`docs/web/ollama/`](../web/ollama/).

- **Runpod's REST API v1 is deprecated** and retired on 2026-11-15. Codeman uses v2, `https://api.runpod.io/v2`: pods at `/v2/pods`, termination with `DELETE /v2/pods/{id}`, wrapped list responses and RFC 9457 errors ([migrate from API v1](../web/runpod/migrate-from-api-v1.md)).
- **Pods.** A created pod goes from `PROVISIONING` through `STARTING` to `RUNNING`; its `cost` is the billed rate in USD per hour, and `env` returns what it was created with ([get a pod](../web/runpod/get-a-pod.md)). `cloud` defaults to `SECURE`. A pod sees its ID in `RUNPOD_POD_ID`, and gets a "pod-scoped" key in `RUNPOD_API_KEY`, whose reach is not documented: step 8 checks whether it can terminate its own pod ([environment variables](../web/runpod/environment-variables.md)). Exposed HTTP ports are at `https://<pod>-<port>.proxy.runpod.net`, behind Cloudflare, which drops a request that gets no response within 100 seconds ([expose ports](../web/runpod/expose-ports.md)): the gateway answers a streamed request at once and keeps it alive until the engine responds.
- **Billing.** `GET /v2/billing/pods` reports per pod per bucket, terminated pods included ([pod billing](../web/runpod/get-pod-billing-history.md)), and `GET /v2/billing` the account's total ([aggregated billing](../web/runpod/get-aggregated-billing-history.md)). Billing runs every 5 minutes ([billing overview](../web/runpod/billing-overview.md)), so a pod's billing lags behind its end, as decision 4 expected. `GET /v2/billing/serverless` filters by endpoint, but in buckets of an hour at least ([Serverless billing](../web/runpod/get-serverless-billing-history.md)): a run's Serverless cost is estimated from the gateway's measures.
- **Serverless.** Flex workers are billed per second from start to stop, rounded up, idle timeout included ([pricing](../web/runpod/pricing.md)). An endpoint reports its workers, idle timeout, GPU pools, FlashBoot and environment, but no cloud: Secure Cloud for endpoints cannot be checked, only stated in the installation steps ([get a Serverless endpoint](../web/runpod/get-a-serverless-endpoint.md)). After 7 days without requests, Runpod sets its max workers to 0 ([endpoint settings](../web/runpod/endpoint-settings.md)); Codeman reports that instead of starting a run.
- **vLLM worker.** The model is `MODEL_NAME` (or `OPENAI_SERVED_MODEL_NAME_OVERRIDE`), the context length `MAX_MODEL_LEN`, and tool calling, which the harness needs, `ENABLE_AUTO_TOOL_CHOICE` with a `TOOL_CALL_PARSER` ([vLLM environment variables](../web/runpod/vllm-environment-variables.md)). Whether `usage` is returned, streamed or not, is still undocumented: step 8.
- **Ollama.** Its default context length now depends on VRAM (4k below 24 GiB, 256k from 48 GiB; [context length](../web/ollama/context-length.md)); the engine sets `OLLAMA_CONTEXT_LENGTH` to the model's own, read from `/api/show`. Its native API reports `prompt_eval_cached_count` apart from `prompt_eval_count` ([usage](../web/ollama/usage.md)), and its OpenAI-compatible API supports `stream_options.include_usage` ([OpenAI compatibility](../web/ollama/openai-compatibility.md)). Whether that API's `prompt_tokens` counts cached tokens is checked in step 8.
- **Restricted keys** can be limited to one Serverless endpoint and do not expire ([manage credentials](../web/runpod/manage-credentials.md)), as the plan assumed.
- **A hard cap.** At a balance of US$ 0, Runpod stops every pod and terminates those without a network volume ([billing overview](../web/runpod/billing-overview.md)). A prepaid account without auto-pay is therefore a cap no bug in Codeman can exceed.

### Risks

- **GPU time nobody uses keeps billing.** A failed `close-key`, a cancelled workflow or a crash must not leave a pod running. Guards: the key jobs terminate it, the pod terminates itself at its deadline and after its idle limit, and `open-key` terminates any Codeman pod past either before creating a new one. Serverless workers stop by themselves after the endpoint's idle timeout.
- **The repository's code leaves GitHub for a GPU host.** With OpenRouter it goes to the model's provider; here it goes to Runpod (decision 6).
- **A long-lived credential near the agent.** The serverless key does not expire; it stays outside the sandbox (decision 11).

This plan depends on [`2026-10-02-context-and-throughput`](2026-10-02-context-and-throughput.md): the spend row's fields and the meaning of each figure come from it. It also comes after [`2026-10-02-third-party-docs`](2026-10-02-third-party-docs.md), so the pages it relies on are recorded in `docs/web/`.

### Audit

Recorded in [`docs/dependencies.md`](../dependencies.md#self-hosted-inference) (step 1). No npm package is added: the Runpod API is called with `fetch`, as OpenRouter's is, and the gateway uses Node's built-in modules only.

## Decisions

Decisions 1 to 8 were answered on 2026-10-02 by the responsible person: the recommendation of each, with an addition to decision 1. The addition brought in serverless endpoints and keeping a pod for a task, which raise decisions 9 to 12.

1. **Pod lifecycle.** Options:
   - (a) One pod per run: `open-key` creates it, `close-key` terminates it. The run's cost is that pod's billing.
   - (b) One pod per task, kept between its runs and terminated when the task stops moving.
   - (c) A long-lived pod shared by every task, with costs split by tokens or time.
   - (d) Runpod Serverless, billed per second of requests only.

   Recommendation: (a). Exact cost per run, nothing shared, nothing to clean up between runs, and it maps onto today's key per run. Its cost is a cold start per run; step 8 measures it, and a network volume that caches models can follow in a plan update.

   **Answer:** (a), with at least the option of (b) when consecutive runs of the task are expected (decision 12), and compatibility with (d) as well (decisions 9 to 11).
2. **Where the metrics API lives.** Options:
   - (a) The gateway in the pod records each request; `close-key` reads `/usage` before terminating the pod and combines it with the GPU provider's billing, in Codeman's code.
   - (b) A standalone service with OpenRouter-like endpoints that stores usage across runs.
   - (c) A proxy in the agent job, outside the sandbox, that records requests and forwards them to the pod.

   Recommendation: (a). The gateway is needed anyway to authenticate the public URL, and it adds no service to host, pay for or secure. (b) makes sense with shared pods (decision 1c). (c) still needs authentication on the pod.

   **Answer:** (a). For serverless, the same gateway runs as in (c) (decision 11).
3. **How the gateway gets into the pod.** Options:
   - (a) An image Codeman builds in its own CI, from Ollama's image pinned by digest plus the gateway, published to GitHub's container registry and referenced by digest.
   - (b) Ollama's official image, with the gateway as a script passed in the pod's start command.

   Recommendation: (a). The pod runs exactly what was reviewed, and the image is built from pinned inputs. It adds a publishing workflow to this repository, a change to CI that needs its own review.

   **Answer:** (a).
4. **Where cost comes from.** Options:
   - (a) Computed: the pod's price per second, from the provider when it is created, times the seconds it existed.
   - (b) The provider's billing API by pod.
   - (c) Computed in `close-key`, then refreshed from billing in later runs, as costs from OpenRouter are refreshed today.

   Recommendation: (c). Billing may lag behind the pod's end, and the spend table already refreshes.

   **Answer:** (c). A run's row is refreshed only when its pod served that run alone; a kept pod's billing refreshes the task's total. Serverless costs are estimated per run (step 1 checks whether Runpod reports more).
5. **The monthly budget.** Runpod cannot list terminated pods, and pod IDs do not say which repository they belong to. Options:
   - (a) The Runpod account's whole spend this month counts against the repository's monthly budget. Each repository, or each group of repositories sharing a budget, uses a Runpod account or team dedicated to Codeman.
   - (b) Each task's record keeps its pods; the repository's spend is the sum over its tasks' records.

   Recommendation: (a). It never counts less than was spent, and needs no state beyond what the provider keeps. A task's spend still comes from the pods its record lists.

   **Answer:** (a). It covers serverless spend too.
6. **Runpod cloud.** Options:
   - (a) Secure Cloud only: Runpod's own data centers.
   - (b) A setting, defaulting to Secure Cloud, that allows Community Cloud.

   Recommendation: (a). Community Cloud hosts are run by third parties, and the agent sends them the repository's code.

   **Answer:** (a). Serverless endpoints must run on Secure Cloud too (decision 10).
7. **Settings.** Options:
   - (a) Separate settings: `inference` (`openrouter`, the default, or `self-hosted`), `gpu-provider` (`runpod`), `gpu-type`, `engine` (`ollama`); `model` names the engine's model (`qwen3-coder:30b`).
   - (b) One composite `model`, such as `runpod/ollama/qwen3-coder:30b@RTX-A6000`.

   Recommendation: (a). Each part is validated on its own, and `model` keeps one meaning per `inference`. Which of them `/codeman set` may change is part of the answer; the recommendation is `model` and `gpu-type`.

   **Answer:** (a), with `model` and `gpu-type` settable per task. Serverless adds `gpu-mode` (`pod` or `serverless`) and `serverless-endpoint` (decision 10).
8. **Spending on tests.** Building and checking this needs GPU time on a Runpod account. Options:
   - (a) The responsible person sets a Runpod account with a spending cap for development, and states it here.
   - (b) Only unit tests with a fake provider until a later decision.

   Recommendation: (a), with a cap the responsible person chooses.

   **Answer:** (a). The cap is still to be stated here before step 8.

   **Cap** (2026-10-03): US$ 20 per month, as OpenRouter's current monthly budget, and US$ 2 per task, as its task budget. Step 8 runs with `monthly-budget: 20` and `task-budget: 2`, on an account with US$ 20 of credits and no auto-pay, which caps it at Runpod too.

Decisions 9 to 12 were answered on 2026-10-02 by the responsible person: the recommendation of each.

9. **The serverless engine.** Options:
   - (a) Runpod's official vLLM worker. This adds a vLLM `InferenceEngine` adapter, small since the worker is configured by environment (model as a Hugging Face ID, context length). Ollama stays the engine on pods.
   - (b) Codeman's own serverless worker running Ollama, built and published like the pod image.

   Recommendation: (a). It is maintained by Runpod, tuned for FlashBoot, and serves the OpenAI-compatible route already. (b) means maintaining a worker and its handler. The price is two engines from the start, and model names that differ between modes.

   **Answer:** (a).
10. **Who creates the serverless endpoint.** Options:
    - (a) A maintainer creates it in Runpod's console (Secure Cloud, flex workers only, at most one worker, a short idle timeout), with a key restricted to it; Codeman gets the endpoint's ID in `serverless-endpoint` and the key as a secret.
    - (b) Codeman creates and updates endpoints through Runpod's API, with the account key.

    Recommendation: (a). The endpoint lives across tasks and costs nothing while idle, which is what makes FlashBoot starts likely; the key the agent job holds can reach that endpoint only. Codeman checks the endpoint's settings at `open` and refuses one that breaks the rules above.

    **Answer:** (a).
11. **Where the serverless key lives.** Options:
    - (a) In the gateway, which the agent job runs outside the sandbox. The agent gets a local URL and the run's token, valid for that run only and limited by its budget.
    - (b) The agent gets the restricted key, as it gets an OpenRouter key today.

    Recommendation: (a). The key does not expire and has no spending limit, and the agent reads hostile text; leaked, it would run the endpoint at the account's cost until someone revokes it.

    **Answer:** (a).
12. **Keeping a pod for a task.** Options:
    - (a) A setting, `pod-reuse`, with `task` as the default and `run` as the alternative. With `task`, `apply` says whether the task goes on to another agent run; if so, the pod stays, with a new deadline and its tokens revoked, and the next run of the task reuses it when the model and GPU type match, with new tokens. Otherwise a new job, `release-pod`, with the account key only, terminates it. A kept pod terminates itself after 15 minutes without a run.
    - (b) The same setting, with `run` as the default.

    Recommendation: (a). Most runs that move a task are followed by another within minutes, and a wrong guess costs at most the idle limit at the pod's price.

    **Answer:** (a).

## Steps

1. Verify the APIs and complete the audit. **Done on 2026-10-03 from the documentation**: the checks that need an account (every one below that creates, measures or calls something) moved to step 8, since the account is created after the implementation. Pods: create, wait for, terminate and list a pod, read its billing, and check self-termination from inside the pod with the least privileged key Runpod allows. Ollama: the chosen context length, and its counts against the tokens sent, cached prompt included. Serverless: a restricted key's reach, the vLLM worker's `usage` in plain and streamed responses, what Runpod reports per request or per endpoint for billing, and cold and warm start times. The pages each check relies on go in `docs/web/`, following its tools. Done when `docs/dependencies.md` has the audit, `docs/web/` has the pages, and this plan is updated with what differs.
2. Extract `InferenceProvider` from `src/budget.ts` and `src/steps/keys.ts`, with OpenRouter as its implementation and no change in behavior. Done when `keys` tests pass unchanged in meaning and key names are identical.
3. `GpuProvider` with a Runpod adapter for pods and serverless and a fake; `InferenceEngine` with Ollama and vLLM adapters (decision 9) and a fake. Done when unit tests cover create, ready, terminate, list, billing and the deadline for pods, and the endpoint's check for serverless, without the network.
4. The gateway: token check and rotation, forwarding with streaming, a record per request, `/usage`, the budget limit, and, in a pod, termination at the deadline and the idle limit. Its image for pods (decision 3), with the publishing workflow pinned by commit SHA. Done when its tests cover a rejected token, a rotated token, a streamed and a non-streamed request, the budget limit and `/usage`, against a fake engine.
5. The self-hosted `InferenceProvider` for pods: `open` sweeps pods past their deadline or idle limit, reuses the task's kept pod or creates one with the run's deadline (limit ÷ price per second), waits until the model is served, and outputs the URL and encrypted tokens; `close` reads `/usage` and computes the run's usage (decision 4); then the pod is kept or terminated (decision 12). Done when tests with the fakes cover a run, a reused pod, a model change that replaces it, a failed close, an expired pod and an exceeded budget.
6. The self-hosted `InferenceProvider` for serverless: `open` checks the endpoint (decision 10) and the budgets; the agent job starts the gateway outside the sandbox before the agent (decision 11) and stops it after; `close` reads its usage and estimates the cost from the flex price. Done when tests with the fakes cover a run, a rejected endpoint, a gateway that stops at the limit, and a sandbox that cannot read the key.
7. Workflow, harness and settings: `apply`'s new output and the `release-pod` job (decision 12); OpenCode gets an OpenAI-compatible provider with the gateway's URL instead of `openrouter`, still the only provider enabled; settings per decision 7; `action.yml` and [`templates/codeman.yml`](../../templates/codeman.yml) get the new secrets, outputs and job, unchanged for OpenRouter. Done when `settings`, `harness` and `apply` tests cover the three modes.
8. On the test account (decision 8), first the checks of step 1 that need it: create, wait for, terminate and list a pod, read its billing, a pod's self-termination with `RUNPOD_API_KEY`, Ollama's counts against the tokens sent, a restricted key's reach, the vLLM worker's `usage`, and start times. Then run a full task on a small model with each mode, compare cost and figures with Runpod's billing, measure starts with and without a kept pod and on a warm and a cold endpoint, and confirm no pod is left after a cancelled workflow. Done when the results are recorded in this plan.
9. Update [`docs/architecture.md`](../architecture.md) (budget, jobs, a section on self-hosted inference), [`docs/security.md`](../security.md) (where code goes, the new secrets, the public URL, the gateway outside the sandbox), [`docs/installation.md`](../installation.md) (the endpoint's settings, for serverless) and the README's "Getting started". Done when they describe every mode.
10. Rebuild `dist/`, run `npm run check`. Done when it passes.

## Out of scope

- Adapters for other GPU providers (Salad and others), and engines beyond Ollama on pods and vLLM on serverless; only the interfaces.
- Pods shared between tasks, active serverless workers and network volumes.
- Choosing which models or GPUs to recommend.
- Mixing providers within a task, such as one stage on OpenRouter and another self-hosted.
