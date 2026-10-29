# Self-hosted inference on Salad

Instead of OpenRouter, Codeman can serve the model itself on consumer GPUs rented by the hour from [Salad](https://salad.com). This page sets up the `salad-pod` [inference provider](../glossary.md#inference-provider): a [pod](../glossary.md#pod) Codeman creates for the task, as a Salad container group of one replica.

`salad-pod` takes its own settings ([providers](../settings/providers.md#salad-pod)). How pods are shared, held and ended is in [pods](../inference/pods.md), and how Salad compares with Runpod in [self-hosted inference](../inference/self-hosted.md#at-a-glance).

> [!WARNING]
> Salad's on-demand GPUs are all consumer PCs that third parties own ([Salad's overview](../web/salad/salad-container-engine-overview-how-saladcloud-works.md)). The repository's code, its issues and every request of the agent are decrypted on them. Use `salad-pod` only for repositories whose code may go there ([risks](../security/risks.md#self-hosted-inference)).

You need:

- a Codeman installation with its [backend](setup.md#4-set-up-the-backend);
- a Salad user, organization and project for Codeman only, with prepaid credits ([the account](#the-account));
- the secret `CODEMAN_SALAD_API_KEY`, the user's key;
- the variables `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT`;
- the encryption secret, `CODEMAN_KEY_ENCRYPTION_SECRET`, as with OpenRouter;
- a version of Codeman whose [pinned pod images](../glossary.md#pinned-pod-image) serve on Salad ([pod images](#pod-images)).

OpenRouter's management key is not needed then, unless a [profile](mixing-providers.md) uses OpenRouter. Where each secret goes is in [secrets](../security/secrets.md#salad-api-key).

## The account

1. **Create a Salad user for Codeman only**, and an organization and a project in [Salad's portal](https://portal.salad.com).
   - Salad's API key belongs to the user, not to the organization: it reaches every organization and project the user belongs to ([using the API](../web/salad/using-the-api.md)). A user that belongs only to Codeman's organization is the only way to limit what the key reaches.
   - The organization's repositories share it, or those of the organizations of its [pool](../glossary.md#pool-of-organizations) ([pools](../runs/batches.md#pools)).
2. **Add prepaid credits**, about the organization's monthly budget, and leave auto recharge off ([billing](../web/salad/billing.md)).
   - At a balance of US$ 0, Salad shuts usage down "as soon as possible", and invoices what ran past the balance at the start of the next month. So the credits cap what Codeman spends there, give or take that delay.
   - Salad has no billing API: Codeman counts its runs as estimates and never reconciles them with the bill ([spend](../budget/spend.md#the-months)). Salad's portal shows the usage, by project.
3. **Copy the user's API key** from the portal's **API Access** page. Add it as the secret `CODEMAN_SALAD_API_KEY`. Only the workflow's `open-key`, `close-key` and `release-pod` jobs receive it, the [key jobs](../glossary.md#key-jobs).
4. **Add the variables** `CODEMAN_SALAD_ORGANIZATION` and `CODEMAN_SALAD_PROJECT`, the organization's and the project's names, to the organization's or the repository's variables. A run on `salad-pod` without them fails, naming the one it lacks.
5. **Check the replica quota.** Every container group counts against the organization's quota of replicas, running or not ([quotas](../web/salad/quotas.md)). Each pod is one replica, so the quota caps the pods at once, whatever `concurrency` allows.

## Pods

1. **Choose a GPU class and allow Community hosts.** In `.codeman/settings.yml`:

   ```yaml
   provider: salad-pod
   model: qwen3-coder:30b        # an Ollama model name
   gpu: "RTX 4090 (24 GB)"       # a Salad GPU class's name
   hosts: [community]            # Salad's on-demand GPUs
   priority: high                # the default
   ```

   - `gpu` is a GPU class's name, as [Salad's pricing](https://salad.com/pricing/) and its API list them, in any case ([GPU classes](../web/salad/list-the-gpu-classes.md)).
   - `hosts` must allow `community`. Its default, `[secure]`, allows only Salad Dedicated's classes, which Salad reserves by contract, so without `community` every on-demand class is refused before any group is created ([hosts](../settings/providers.md#hosts)).
   - Only the settings files set `hosts`, the organization's or the repository's: a task's command cannot.
   - Choose a class with enough memory for the model and its cache. Windows, which the hosts run, keeps a part of the GPU's memory, so the pod gets slightly less than the class's name says ([Salad's overview](../web/salad/salad-container-engine-overview-how-saladcloud-works.md)). The pod fits its context to what it finds ([context and the GPU](../settings/pod-engines.md#context-and-the-gpu)).

   Result: the run's tasks get a pod on a node with that GPU class.

2. **Choose a priority.** `high`, the default, is never taken by other workloads. `medium`, `low` and `batch` cost less, but a higher-priority workload may take the pod's node, and its tasks fail as a failed pod's do ([priority](../settings/providers.md#priority), [Salad's priority pricing](../web/salad/priority-pricing.md)).

3. **Choose an [engine](../glossary.md#engine)**, as on Runpod: Ollama by default, or vLLM, with its block ([Runpod's pods](runpod.md#pods), [choosing an engine](../settings/pod-engines.md#choosing-an-engine)).
   - Salad cannot pick hosts by CUDA version. A vLLM pod checks its host's driver when it starts, and fails, naming the driver's CUDA, when it is older than 13.0 ([CUDA](../settings/vllm.md#cuda)).
   - The hosts download the image over home connections, so a pod starts more slowly than on Runpod, more so for vLLM's larger image. Salad does not bill the download, but Codeman counts it ([spend](../budget/spend.md#the-months)).

4. **Keep the project for Codeman.** Codeman deletes as orphans the project's container groups of its pool that the [pod registry](../glossary.md#pod-registry) does not hold ([sweeping orphans](../inference/pods.md#sweeping-orphans)). It never touches a group without Codeman's `CODEMAN_*` environment, but a project of its own keeps them apart.

The tasks with the same [pod settings](../glossary.md#pod-settings), in any repository of the organization or its pool, share one pod, up to its parallel requests, as on Runpod ([shared pods](../inference/pods.md#shared-pods)).

## Pod images

> [!IMPORTANT]
> A Salad pod needs a pod image whose gateway listens on IPv6 and ends the pod by exiting. Images built before Codeman supported Salad cannot, so a run on one stops before any group is created: "The pod image … cannot serve on Salad, so no pod was created …". Use a version of Codeman that pins images built after it ([pod images](../development/guide.md#pod-images)).

A `pod-image` of your own, on the `open-key` step, must do both too.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "The pod image … cannot serve on Salad, so no pod was created …" | The version of Codeman pins images from before Salad | Use a version that pins newer images ([pod images](#pod-images)) |
| "Salad's `<class>` runs on community hosts, machines third parties run, which `hosts` does not allow …" | `hosts` lacks `community` | Add `community` to `hosts` in the settings file, if the repository's code may go there |
| "Salad has no GPU class "`<gpu>`" …" | `gpu` names no class of the organization | Copy a class's name from Salad's pricing page, such as `RTX 4090 (24 GB)` |
| "The run's salad account needs `CODEMAN_SALAD_ORGANIZATION` …", or `…_PROJECT` | A variable is missing | Add it to the repository's or the organization's variables |
| "The host's driver supports CUDA …, older than the 13.0 that vLLM's image needs." | A vLLM pod landed on a host with an older driver | Try again, which may land on another node, or use `engine: ollama` |
| "`<model>` does not fit the GPU …" | The model and its cache do not fit wholly on the GPU | Fewer parallel requests, a quantized cache, or a class with more memory ([context and the GPU](../settings/pod-engines.md#context-and-the-gpu)) |
| A pod takes long to start | The node downloads the image over a slow connection | Wait: the model must be served within 25 minutes of the group's creation ([timers](../inference/pods.md#timers)) |
| A task fails mid-run on a pod below `high` | Another workload took the node | Use `priority: high` |
| Every pod stops | The organization's balance reached US$ 0 | Add credits |
