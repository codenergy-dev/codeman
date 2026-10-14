# Security

These pages tell you whether Codeman is safe to run on your repository. [Secrets](secrets.md) covers which secrets Codeman uses and why each one is safe; [risks](risks.md), the real risks, from most to least severe, and how to protect against them. This page has the checklist, and lists what is planned to make Codeman safer. The mechanisms themselves are described in [the other docs](../README.md).

Codeman runs an AI agent that reads text and runs shell commands. Read everything below assuming the agent can be manipulated: whatever the agent can reach, an attacker who controls text it reads can reach too.

## Checklist

Before running Codeman on a repository:

1. Install the App on selected repositories only. With a [pool](#a-public-app-and-a-pool), install it in each member, and check its installations in the App's settings from time to time: suspend any you do not know.
2. Make Codeman's secrets visible only to the repositories that use it.
3. Add a ruleset on the default branch that requires a reviewed pull request.
4. Check which secrets the workflows that run on `codeman/*` branches expose. Move secrets that deploy or publish to an Environment with required reviewers ([risk 1](risks.md#1-code-the-agent-wrote-runs-with-the-repositorys-secrets)).
5. In the `agent` job, add only steps that install tools ([risk 3](risks.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox)).
6. Keep `task-budget` and `monthly-budget` low ([risk 4](risks.md#4-the-agent-can-send-its-task-key-out)), and with several repositories, set `organization-monthly-budget` in the organization's settings. A repository's admins can still replace those settings, with a repository variable `CODEMAN_SETTINGS` or by changing its workflow file, so the organization's budget holds as far as they are trusted. With self-hosted inference, use a Runpod account dedicated to Codeman, with prepaid credits and no auto-pay.
7. Set `CODEMAN_COMMIT_SHA` in the organization to a commit of Codeman's `main` branch, and give write access to the repositories that run Codeman only to people you would let change `codeman.yml`: a repository variable of that name runs whatever commit it names, with Codeman's secrets ([risk 7](risks.md#7-codemans-own-code-and-dependencies)).
8. Give the backend a Firebase project of its own, with the rules and the attribute condition of [installation](../installation/setup.md#4-set-up-the-backend), and grant its service account only Cloud Datastore User.
9. Label only issues you opened, written in your own words.

## A public App and a pool

A [pool of organizations](../runs/batches.md#pools) installs one App, made public so each organization can install it by its link, with the same private key in each organization's secrets. The analysis of decision 6 of the [plan for GPU batches across repositories](../plans/2026-10-13-gpu-batches-across-repositories.md):

- **A stranger who installs the App gains nothing.** Without the private key they mint no token, and Codeman never acts on owners outside its pool: it mints tokens only for the members its organization's `pool` names and that declare the same pool, and never lists the App's installations.
- **Whoever holds the key reaches a stranger's installation too**, with the App's permissions; Codeman ignores it, but a person with the key does not have to. The App's owner sees every installation in the App's settings, and can suspend any of them.
- **A leaked key reaches every installation**, the pool's and any stranger's: rotate it (an App may hold several keys; delete the leaked one) and suspend installations while doing so.
- **A pool is mutual trust.** Anyone who can change `codeman.yml` on a default branch of any member holds the key, and so reaches every member's installed repositories with the App's permissions (Contents and Workflows write already). Inside one organization this was already true. The backend's attribute condition, which lists the pool's owner IDs, is the boundary of what reaches the board, the batches and the registry.
- **The `dispatch` job** holds the key only to mint, for one repository of another member, a token limited to `actions: write`, which its step revokes when it ends; it checks out nothing, runs no Codeman step, and has no OIDC token. Actions write also lets that token cancel, re-run and delete runs, and disable workflows, of that repository, for one hour at most.
- *Alternative considered:* one private App per organization, each key also in the other organizations' secrets: the same trust, more upkeep.

## Roadmap

Planned improvements, most valuable first. Each will get its own plan.

1. **Restrict the agent's network** to an allowlist (OpenRouter or the run's gateway, package registries), with `iptables` rules that match the agent's user. This reduces risks 2 and 4.
2. **Test the sandbox against a hostile agent.** A CI job on a GitHub-hosted runner replaces the harness with a script that tries to read secrets: other users' `/proc/*/environ`, the runner's home, `sudo`, `docker`, the runner's credentials and cloud metadata endpoints. The build fails if any attempt succeeds. This keeps the [secrets](secrets.md) table true as Codeman and the runner images change.
3. **Warn about secrets exposed to task branches.** `select` warns when a workflow that runs on `push` or `pull_request` for `codeman/*` references `secrets.*` outside an Environment. This reduces risk 1.
4. **Warn about extra steps in the agent job.** `select` reads the workflows and warns when the `agent` job has `run` steps, or actions other than known setup actions. This reduces risk 3.
5. **Have the review stage look for exfiltration:** new network calls, reads of environment variables, and changes to scripts that CI runs. This reduces risk 1, and does not replace a human review.
