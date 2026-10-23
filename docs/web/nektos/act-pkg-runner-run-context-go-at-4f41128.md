---
title: "act: pkg/runner/run_context.go at 4f41128"
url: https://github.com/nektos/act/blob/4f411281417e88660bea1c1a1749aa71ae0bd60f/pkg/runner/run_context.go
created_at: 2026-10-20T12:35:32-03:00
updated_at: 2026-10-23T16:01:45-03:00
tool: docs/web/tools/github-repositories.md
---

# act: pkg/runner/run_context.go at 4f41128

Commit `4f41128` is the one tag `v0.2.89` points at. The file is over 30 KB, so this page holds, in Codeman's words, only what Codeman relies on, each fact naming its function.

## The jobs' environment

- **`GetEnv`.** A job's environment merges the workflow's `env`, then the job's `env`, then act's own `Env` (what `--env` and the env file give): a value given with `--env` replaces the workflow's and the job's. It always adds `ACT=true`.
- **`withGithubEnv`.** Each step's environment gets `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_RUN_NUMBER` and the other `GITHUB_*` variables from the `github` context, which overwrite the same names from `GetEnv`. A step's own `env` is merged after it (`setupEnv` in `step.go`).
- **OIDC.** No function sets `ACTIONS_ID_TOKEN_REQUEST_URL` or `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, and nothing in act 0.2.89's Go source names them: a job sees them only when `--env` gives them.

## The run's identity

- **`getGithubContext`.** `github.run_id`, `github.run_attempt` and `github.run_number` come from act's `Env` entries `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` and `GITHUB_RUN_NUMBER`; each is `"1"` when absent. So every run has `run_id` 1 unless `--env GITHUB_RUN_ID=<n>` sets another.
- **`getGithubContext`.** `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_OWNER`, `GITHUB_REF` and the other context fields are also read from act's `Env` first.
- **`setActionRuntimeVars`.** With an artifact server, `ACTIONS_RUNTIME_URL` and `ACTIONS_RESULTS_URL` point at it, and `ACTIONS_RUNTIME_TOKEN` is a token act makes from `GITHUB_RUN_ID` (1 when absent), unless act's own process has these variables.

## The job containers

- **`GetBindsAndMounts`.** Every job container mounts the named volume `act-toolcache` on `/opt/hostedtoolcache`, and a volume named after the container on act's own directory. With `--container-daemon-socket -`, it binds no Docker socket.
- **`startJobContainer`.** The container's environment holds `RUNNER_TOOL_CACHE=/opt/hostedtoolcache`, `RUNNER_TEMP=/tmp` and `LANG=C.UTF-8`, and its entry point is `tail -f /dev/null`, not the image's.
- **`withGithubEnv`.** `setActionRuntimeVars` runs only with `--artifact-server-path`: otherwise act sets no `ACTIONS_RUNTIME_URL`, `ACTIONS_RESULTS_URL` or `ACTIONS_RUNTIME_TOKEN`, and the jobs get them from `--env` only.
- **`getGithubContext`.** `github.sha` comes from act's `Env` entry `SHA_REF`, else from the event, else from the working directory's git. `github.ref` comes from `GITHUB_REF`, else from the event, else from git. `github.repository` comes from `GITHUB_REPOSITORY`, else from git, else is `nektos/act`.
- **`isLocalCheckout`.** An `actions/checkout` step whose `repository` and `ref`, when given, are the run's is skipped, the working directory being copied instead, unless `--no-skip-checkout` is given (`step_action_remote.go`).
- **`isEnabled`.** A job whose `if:` is false gets the result `skipped`, logged at the debug level only.
