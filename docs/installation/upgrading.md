# Upgrading

## Old setting names

Settings written before the [provider settings plan](../plans/2026-10-08-provider-settings.md) stop the run with an error that gives the new name. In `.codeman/settings.yml`, the organization's `CODEMAN_SETTINGS` and each profile:

- `inference: openrouter` becomes `provider: openrouter`, or goes, since it is the default.
- `inference: self-hosted` with `gpu-mode: pod` (or no `gpu-mode`) becomes `provider: runpod-pod`, and `gpu-type` becomes `gpu`.
- `inference: self-hosted` with `gpu-mode: serverless` becomes `provider: runpod-serverless`, and `serverless-endpoint` becomes `endpoint`.
- `gpu-provider` and `gpu-mode` go.
- `inference-profiles` becomes `profiles`.

A task that changed its GPU with `/codeman set gpu-type` needs `/codeman set gpu` instead: the old command is reported as a problem that gives the new name.

## Secret renamed

`CODEMAN_OPENROUTER_KEY_ENCRYPTION_SECRET` is now `CODEMAN_KEY_ENCRYPTION_SECRET`, since it also protects the gateway tokens of self-hosted runs. Add the secret under the new name (the same value will do) where the old one is, then copy the templates again, then remove the old one. Workflow files copied before keep passing the old name, and work until they are replaced. Templates copied from this change on pass only the new name: without the new secret, every `open-key` fails with `Input required and not supplied: encryption-secret`, so no agent runs.

## A model per provider

Since the [model per provider plan](../plans/2026-10-08-model-per-provider.md), a repository's file or a profile that names another provider than the one it inherits must set its own `model`; the first run stops with an error that names it otherwise. Add the model the new provider serves, such as `model: qwen3-coder:30b` to a profile with `provider: runpod-pod` that inherits OpenRouter from the top level. A task's `/codeman set model` now applies only to the runs on the top level's provider ([the model](../settings/provider-settings-across-layers.md#the-model)).

## Profiles pick the tasks

Since the [plan for profiles that pick the tasks](../plans/2026-10-08-profiles-pick-the-tasks.md), a profile's conditions sit at its first level, the profiles' counts decide how many tasks a run takes, and no setting is required. Settings written before stop the run with an error that says what to write instead. In `.codeman/settings.yml`, the organization's `CODEMAN_SETTINGS` and each profile:

| Before | Now |
| --- | --- |
| `when:` with `stages: [code]` under it | `stages: [code]` in the profile, beside its `name` |
| `parallel-tasks: N` under a profile's `when` (at least N tasks) | `min-tasks: N` in the profile; or `tasks: N` for exactly N, `max-tasks` for at most |
| `parallel-tasks: N` at the top level | `max-tasks: N` (or `tasks: N`) in a profile: the largest count a profile names is how many tasks a run takes. A profile with only a `name` and `max-tasks: N` is enough: it changes nothing else |
| `parallel-tasks: 1`, or none | Nothing: one task at a time when no profile has a count |
| `model` required at the top level | Optional: without it, only profiles serve agent runs, and each sets its own `model` |

For example:

```yaml
# Before
model: deepseek/deepseek-v4.1-flash
parallel-tasks: 3
profiles:
  - name: small-pod
    when:
      stages: [code, test]
      parallel-tasks: 2
    provider: runpod-pod
    gpu: "NVIDIA RTX A6000"
    model: qwen3-coder:30b

# Now
model: deepseek/deepseek-v4.1-flash
profiles:
  - name: small-pod
    stages: [code, test]
    min-tasks: 2
    max-tasks: 3
    provider: runpod-pod
    gpu: "NVIDIA RTX A6000"
    model: qwen3-coder:30b
```

`small-pod`'s `max-tasks: 3` makes runs of up to 3 tasks, as `parallel-tasks: 3` did; the top level serves the other runs, at any count. Without a profile that names a count, add one with only a `name` and `max-tasks: 3`.

Behind the change: a task that its profiles serve only with more tasks than are ready now waits, and its panel says so; one whose stage nothing serves at any count is blocked ([profiles](../settings/profiles.md#how-many-tasks-a-run-takes)). The workflow files need no change: the run's matrix already follows what `select` picks.

## Pods fit the GPU

Since the [plan for fitting Ollama to the GPU](../plans/2026-10-13-fit-ollama-to-the-gpu.md), once Codeman's pinned pod image is one built since it, a pod serves as many requests at once as its profile's tasks, with the largest context that fits its GPU instead of the model's own, and fails to start when the model does not fit wholly on the GPU ([memory](../settings/ollama.md#memory)). Settings need no change, but check two things:

- An `ollama:` block written only to match the profile's count, such as `num-parallel: 4` in a `tasks: 4` profile, can go.
- A pod profile with `min-tasks` alone, or none of the counts while another profile has `min-tasks` alone, serves up to 10 requests at once ([parallel requests](../settings/ollama.md#parallel-requests)); give it a `max-tasks`, or `num-parallel` in its `ollama:` block, when its GPU cannot hold their caches.

## vLLM on pods

Since the [plan for vLLM on pods](../plans/2026-10-13-vllm-on-pods.md), a pod can serve a Hugging Face model with vLLM (`engine: vllm`, [vLLM settings](../settings/vllm.md)). Nothing changes for Ollama pods: their settings, settings key and environment stay as they were. Check three things:

- **Pod images.** Codeman's images are now one per engine, `codeman-ollama` and `codeman-vllm`, pinned in `POD_IMAGES` (`src/inference/images.ts`) instead of `POD_IMAGE`. A version that pins no vLLM image yet stops runs with `engine: vllm` before any pod is created. A `pod-image` input still overrides the Ollama image only.
- **Layers that change engine.** A layer or profile that names another `engine` leaves out the block of the engine it inherits, as one that names another provider leaves out its settings ([provider settings across layers](../settings/provider-settings-across-layers.md)).
- **The model.** With `engine: vllm`, `model` is a Hugging Face ID of a public model, not gated, with safetensors weights, such as `unsloth/Qwen3.8-27B-NVFP4`, not an Ollama name; and the `vllm` block needs the model's `tool-call-parser`.

## GPU batches across repositories

Since the [plan for GPU batches across repositories](../plans/2026-10-13-gpu-batches-across-repositories.md), a profile's count is the size of a batch, which on a pod may take tasks of the organization's other repositories, and of a [pool](../runs/batches.md#pools)'s organizations. Upgrade in this order:

1. **Every repository at once, with no live pod.** Pods, Serverless endpoints' runs, the board and the batches move to `pools/{pool}/` in the backend, and the cache of fits to `contexts/`; runs and events stay under `organizations/{owner}`. The older `pods`, `contexts` and `endpoints` of each organization stay as history, unread, except that the organization's month still counts its older pods' untracked time. An upgraded `open-key` terminates the organization's pods created by older versions, which no registry reads any more: wait until no pod runs (Runpod's console shows none) before the first upgraded run, and upgrade every repository of every member of the pool together. The first pod of each settings searches its context again.
2. **The App's Actions permission**: read and write, approved in each installation ([setup](setup.md#1-register-the-github-app)).
3. **Both workflow files**, copied again in each repository: `codeman.yml` gains the `issues` trigger, the concurrency group of skipped runs, the `batch` input and the `dispatch` job. Create the `codeman` label if a repository lacks it.
4. **Counts.** A planning task and code tasks are no longer counted together: in the [profiles' example](../settings/profiles.md#example), 1 planning task and 3 code tasks now run the code tasks on `mig` (3), not on the profile named `parallel-tasks` (4). A profile whose count was meant as the whole run's needs another look.
5. **A pool of organizations**, optionally: [setup](setup.md#a-pool-of-organizations).

## Codeman's commit from a variable

Since the [plan for Codeman's commit from a variable](../plans/2026-10-14-commit-from-a-variable.md), the workflow files name no commit of Codeman: each job that runs it checks it out at the commit in the `CODEMAN_COMMIT_SHA` variable. Once, in each repository:

1. Add `CODEMAN_COMMIT_SHA`, in the organization or the repository: a full commit SHA of Codeman's `main` branch, at or after that plan ([setup](setup.md#5-add-the-workflow-and-settings)).
2. Copy both templates again from that commit, keeping the steps you added to the `agent` job. These templates pass only `CODEMAN_KEY_ENCRYPTION_SECRET`: add it before copying them, if the old name is all you have ([secret renamed](#secret-renamed)). Until then, the files keep running the commit written in them; pointed by hand at a commit since the plan, they fail at once, saying they pass no template version.

From then on, a new version of Codeman is a change of the variable. Copy the templates again only when a job fails saying the files' template version is not the one Codeman expects.

## Backend mapping gains repository_id

Since the [plan for the backend's condition and maintenance](../plans/2026-10-14-backend-condition-and-maintenance.md), the installation's provider also maps `attribute.repository_id=assertion.repository_id`, so that a condition can admit only listed repositories by their IDs ([setup](setup.md#4-set-up-the-backend)). A provider created before maps only `google.subject`, `attribute.repository`, `attribute.repository_owner_id` and `attribute.workflow_ref`. It keeps working with its condition, and needs no change while it admits any repository of the organization. A condition may use only fields the mapping maps ([attribute condition](../web/google-cloud/configure-workload-identity-federation-with-deployment-pipelines.md#define-an-attribute-condition)), so to move to the listed-repositories condition, read the mapping, with the names and variables of [backend maintenance](backend-maintenance.md):

```sh
gcloud iam workload-identity-pools providers describe github --project="$PROJECT_ID" \
  --location=global --workload-identity-pool=codeman --format='yaml(attributeMapping)'
```

If it has no `attribute.repository_id`, pass the installation's whole mapping with `--attribute-mapping` in the same `update-oidc` that sets the new condition ([change the attribute condition](backend-maintenance.md#change-the-attribute-condition), step 4). Nothing changes in settings or workflow files.

## A spent pod waits for its close

Since the [plan for keeping a spent pod for its close](../plans/2026-10-15-keep-a-spent-pod-for-its-close.md), a pod whose runs all spent their budget or went silent stops them and waits for their `close-key`, instead of terminating at once ([pods](../inference/pods.md)). That is the gateway's, so it applies with the version of Codeman that pins the pod images published from `e26a8c9`, which contains the change (`POD_IMAGES` in `src/inference/images.ts`, [pod images](../development/guide.md#pod-images)); pods on the images pinned before keep terminating at once. `close-key`'s retries of `/admin/end` and its estimate capped at the run's limit apply to pods on any image. Nothing to change in settings or workflow files.

## The dispatch reads the default branch

The `dispatch` job's App token also asks for `metadata: read` (`permission-metadata: read`; the job's own token has no permission): without it, `gh workflow run` cannot read the target repository's default branch, and every dispatch to another repository of the pool fails with "Resource not accessible by integration (repository.defaultBranchRef)". Copy `codeman.yml` again in each repository of the pool. The App already has that permission, which every GitHub App has, so its installations approve nothing. The template version does not change: files copied before keep running, and only their dispatches fail.

## Workflow files copied before the backend

To update workflow files copied before the backend, copy both templates again, and move any steps you added to the `agent` job into the new `codeman-task.yml`: the jobs that record runs need their new permissions, variables and the run's ID in the ledger. Older workflow files fail in `select`, before they mark any task, since they pass none of the backend's variables. Workflow files copied before the budgets came from the ledger pass neither the organization's monthly budget nor the task's spend from `close-key` to `apply`: copy both templates again, too. With pods, update every repository of the organization at once to a version with the pod registry: its `open-key` terminates the organization's pods created by older versions, which the registry does not hold, and older versions cannot share the newer pods.
