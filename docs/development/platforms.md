# Platforms

The steps reach the platform and the runtime only through interfaces. GitHub and GitHub Actions are the only implementations so far; [`src/main.ts`](../../src/main.ts) wires them into `Services`, which each step takes. Tests run `select` and `apply` on an in-memory platform unlike GitHub ([`src/testing/`](../../src/testing/)).

| Interface | Covers | GitHub implementation |
| --- | --- | --- |
| `Platform` ([`src/platform/platform.ts`](../../src/platform/platform.ts)) | Tasks and their state labels, comments on issues and on change requests, change requests and their reviews, who is a maintainer, the account Codeman writes as, files and commits, links and references. | [`src/platform/github/platform.ts`](../../src/platform/github/platform.ts): the REST and GraphQL APIs, through the App's token. |
| `CiResults` | Runs of CI on a commit, their jobs, logs and artifacts. | [`src/platform/github/ci.ts`](../../src/platform/github/ci.ts): GitHub Actions. |
| `Conventions` ([`src/platform/conventions.ts`](../../src/platform/conventions.ts)) | The Markdown dialect (mentions and references to break), the comment size limit, where CI configuration lives, the rules that protect it, and what the agent is told about writing and reviewing it. | [`src/platform/github/conventions.ts`](../../src/platform/github/conventions.ts). |
| `Runtime` ([`src/runtime/runtime.ts`](../../src/runtime/runtime.ts)) | Inputs and outputs of a step, logs, the run's summary, secret masking, the workspace, the run's ID, attempt and link, the repository, and the job's OIDC token. | [`src/runtime/github-actions.ts`](../../src/runtime/github-actions.ts). |

Every adapter must guarantee:

- **Ordered IDs.** Comment and review IDs are numbers that grow with time within an issue or change request: Codeman marks requests as handled by the highest ID it has read. A platform without them, such as reviewer votes, synthesizes them.
- **An identity nobody else has.** `self()` names an account only Codeman can post as. The task record and the run history are read only from its comments.
- **A real maintainer check.** `isMaintainer` reads the platform's permissions (write access or more), never what a user or a comment claims.
- **Comments kept as written.** The task record lives in a hidden HTML comment inside the status comment, so the platform must keep Markdown as written, HTML comments included, up to its `commentLimit`, which must be at least 65,536 characters: the agent's output limits are set for it.
- **Atomic, guarded commits.** `commit` writes all changes at once, without running git on the agent's files, and fails without writing if the branch moved since the base commit.
- **Safe Markdown.** The dialect matches every mention and reference the platform renders. This is a security boundary: a reference it misses lets the agent notify or link anyone.
- **Unambiguous key names.** OpenRouter keys are named `codeman/<owner>/<repo>/<issue>/<run>`. An owner of several segments, such as a group path, must not make one repository's name a prefix of another's. Pods carry the owner, lowercase, in `CODEMAN_ORGANIZATION`, compared whole.

The [security model](../security/overview.md) relies on GitHub Actions: credentials scoped to each job, secrets masked at runtime, and runs started by comments and reviews. Another runtime must provide each of these or an equivalent, and the security document must be reviewed for it before Codeman runs there.
