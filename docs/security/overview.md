# Security

These pages tell you whether Codeman is safe to run on your repository. [Secrets](secrets.md) covers which secrets Codeman uses and why each one is safe; [risks](risks.md), the real risks, from most to least severe, and how to protect against them. This page has the checklist, and lists what is planned to make Codeman safer. The mechanisms themselves are described in [the other docs](../README.md).

Codeman runs an AI agent that reads text and runs shell commands. Read everything below assuming the agent can be manipulated: whatever the agent can reach, an attacker who controls text it reads can reach too.

## Checklist

Before running Codeman on a repository:

1. Install the App on selected repositories only.
2. Make Codeman's secrets visible only to the repositories that use it.
3. Add a ruleset on the default branch that requires a reviewed pull request.
4. Check which secrets the workflows that run on `codeman/*` branches expose. Move secrets that deploy or publish to an Environment with required reviewers ([risk 1](risks.md#1-code-the-agent-wrote-runs-with-the-repositorys-secrets)).
5. In the `agent` job, add only steps that install tools ([risk 3](risks.md#3-steps-added-to-the-agent-job-run-outside-the-sandbox)).
6. Keep `task-budget` and `monthly-budget` low ([risk 4](risks.md#4-the-agent-can-send-its-task-key-out)), and with several repositories, set `organization-monthly-budget` in the organization's settings. A repository's admins can still replace those settings, with a repository variable `CODEMAN_SETTINGS` or by changing its workflow file, so the organization's budget holds as far as they are trusted. With self-hosted inference, use a Runpod account dedicated to Codeman, with prepaid credits and no auto-pay.
7. Give the backend a Firebase project of its own, with the rules and the attribute condition of [installation](../installation/setup.md#4-set-up-the-backend), and grant its service account only Cloud Datastore User.
8. Label only issues you opened, written in your own words.

## Roadmap

Planned improvements, most valuable first. Each will get its own plan.

1. **Restrict the agent's network** to an allowlist (OpenRouter or the run's gateway, package registries), with `iptables` rules that match the agent's user. This reduces risks 2 and 4.
2. **Test the sandbox against a hostile agent.** A CI job on a GitHub-hosted runner replaces the harness with a script that tries to read secrets: other users' `/proc/*/environ`, the runner's home, `sudo`, `docker`, the runner's credentials and cloud metadata endpoints. The build fails if any attempt succeeds. This keeps the [secrets](secrets.md) table true as Codeman and the runner images change.
3. **Warn about secrets exposed to task branches.** `select` warns when a workflow that runs on `push` or `pull_request` for `codeman/*` references `secrets.*` outside an Environment. This reduces risk 1.
4. **Warn about extra steps in the agent job.** `select` reads the workflows and warns when the `agent` job has `run` steps, or actions other than known setup actions. This reduces risk 3.
5. **Have the review stage look for exfiltration:** new network calls, reads of environment variables, and changes to scripts that CI runs. This reduces risk 1, and does not replace a human review.
