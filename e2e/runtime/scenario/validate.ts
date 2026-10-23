import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { STATES, stateLabel } from "../../../src/state.ts";
import { LAYOUT } from "../../../src/store/layout.ts";
import { ROLES, type Role } from "../../fakes/github/world.ts";
import { HttpError } from "../../fakes/http.ts";
import { isIssueRef, scriptOf } from "../../fakes/llm/script.ts";
import { type CatalogGpu, catalogGpuOf } from "../../fakes/runpod/catalog.ts";
import { type EndpointSetup, endpointOf } from "../../fakes/runpod/serverless.ts";
import {
  ACTION_KINDS,
  type Action,
  type Agent,
  type App,
  COMMENT_KINDS,
  type CommentMatch,
  type CommitMatch,
  DISPATCH_INPUTS,
  type EngineMatch,
  EVENTS,
  type Expectation,
  FAKE_LISTS,
  FAKES,
  type FakeMatch,
  type FakeName,
  type Fault,
  type HttpFault,
  type Installation,
  JOBS,
  type Lags,
  type LedgerMatch,
  type OpenRouterWorld,
  type Organization,
  type Pattern,
  type PodMatch,
  PROFILES,
  PROVIDER_SECRETS,
  type ProviderSecret,
  type PullRequestMatch,
  RelativeTime,
  type Repository,
  RUN_CHAIN_RUNS,
  RUNNERS,
  type RunpodWorld,
  type Scenario,
  type StoreMatch,
  type Target,
  type TeeWorld,
  type World,
} from "./schema.ts";

/**
 * Turns a scenario file's parsed YAML into a `Scenario`, or throws `Invalid` with the path of the
 * first field at fault, such as `actions[3].expect.labels`. Refs are checked in order: an action
 * may name only issues and pods that earlier actions defined, and a `parallel` branch only those
 * defined before it or earlier in the same branch.
 */

/** Where a value is in the file: keys and list indexes from the document's root. */
export type Path = readonly (string | number)[];

export class Invalid extends Error {
  readonly path: Path;

  constructor(path: Path, message: string) {
    super(message);
    this.path = path;
  }
}

/** `actions[3].expect.labels`. */
export function formatPath(path: Path): string {
  let text = "";
  for (const part of path) {
    if (typeof part === "number") text += `[${part}]`;
    else text += text === "" ? part : `.${part}`;
  }
  return text;
}

export interface ValidateOptions {
  /** The scenario's ID, its path under `e2e/scenarios/` without `.yaml`. */
  id: string;
  file: string;
  /** Where fixtures are: `e2e/fixtures/`. */
  fixtures: string;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const TAG = /^[a-z0-9][a-z0-9-]*$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const REPOSITORY = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/;
const FIXTURE = /^[a-z0-9][a-z0-9._-]*$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SETTINGS_VARIABLE = "CODEMAN_SETTINGS";
const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const TIME = /^now(?:([+-])(\d+(?:\.\d+)?(?:ms|s|m|h|d)))?$/;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const POD_STATUSES = ["PROVISIONING", "STARTING", "RUNNING", "EXITED", "ERROR", "TERMINATED"];
const LEVELS = ["read", "write", "admin"];
const ACTIONS_BOT = "github-actions[bot]";

/** What an action may name: users, repositories, and the refs defined so far. */
interface Context {
  world: World;
  users: ReadonlySet<string>;
  /** Issue refs, with their repository. */
  issues: Map<string, string>;
  pods: Set<string>;
}

export function validateScenario(value: unknown, options: ValidateOptions): Scenario {
  const fields = record(
    value,
    [],
    ["name", "tags", "runner", "profiles", "timeout", "world", "agent", "actions"],
  );
  required(fields, [], ["name", "world", "actions"]);
  // In the file's order, so the first error is the first field at fault.
  const name = text(fields.name, ["name"]);
  const tags = fields.tags === undefined ? [] : unique(tagsOf(fields.tags, ["tags"]), ["tags"]);
  const runner =
    fields.runner === undefined ? "simulator" : choice(fields.runner, ["runner"], RUNNERS);
  const profiles =
    fields.profiles === undefined
      ? []
      : unique(
          list(fields.profiles, ["profiles"], (item, at) => choice(item, at, PROFILES)),
          ["profiles"],
        );
  const timeoutMs =
    fields.timeout === undefined ? DEFAULT_TIMEOUT_MS : duration(fields.timeout, ["timeout"]);
  const world = worldOf(fields.world, ["world"], options);
  const context: Context = {
    world,
    users: new Set(world.users.map((login) => login.toLowerCase())),
    issues: new Map(),
    pods: new Set(),
  };
  // The actions first: the agent's script may name only the issues they open.
  const actions = actionsOf(fields.actions, ["actions"], context);
  const agent = agentOf(fields.agent, ["agent"], context);
  return {
    file: options.file,
    id: options.id,
    name,
    tags,
    runner,
    profiles,
    timeoutMs,
    world,
    agent,
    actions,
  };
}

function tagsOf(value: unknown, path: Path): string[] {
  return list(value, path, (item, at) => {
    const tag = text(item, at);
    if (!TAG.test(tag)) fail(at, "expected a tag: lowercase letters, digits and '-'");
    return tag;
  });
}

// The world

function worldOf(value: unknown, path: Path, options: ValidateOptions): World {
  const fields = record(value, path, [
    "users",
    "organizations",
    "repositories",
    "app",
    "runpod",
    "openrouter",
  ]);
  required(fields, path, ["repositories"]);
  const users = new Map<string, string>();
  const addUser = (login: string) => {
    if (!users.has(login.toLowerCase())) users.set(login.toLowerCase(), login);
  };
  const userList = (item: unknown, at: Path) => unique(list(item, at, login), at);
  if (fields.users !== undefined) {
    for (const one of userList(fields.users, [...path, "users"])) addUser(one);
  }

  const organizations = list(fields.organizations ?? [], [...path, "organizations"], (item, at) => {
    const org = record(item, at, ["name", "owners", "members", "settings", "variables", "secrets"]);
    required(org, at, ["name"]);
    const organization: Organization = {
      name: login(org.name, [...at, "name"]),
      owners: org.owners === undefined ? [] : userList(org.owners, [...at, "owners"]),
      members: org.members === undefined ? [] : userList(org.members, [...at, "members"]),
      settings:
        org.settings === undefined ? undefined : settingsOf(org.settings, [...at, "settings"]),
      variables: variablesOf(org.variables, [...at, "variables"]),
      secrets: org.secrets === undefined ? undefined : secretsOf(org.secrets, [...at, "secrets"]),
    };
    for (const one of [...organization.owners, ...organization.members]) addUser(one);
    return organization;
  });
  const orgNames = new Set<string>();
  organizations.forEach((organization, index) => {
    const key = organization.name.toLowerCase();
    if (orgNames.has(key)) {
      fail([...path, "organizations", index, "name"], `${organization.name} is declared twice`);
    }
    orgNames.add(key);
  });

  const repositories = list(fields.repositories, [...path, "repositories"], (item, at) => {
    const repo = record(item, at, [
      "name",
      "fixture",
      "maintainers",
      "collaborators",
      "private",
      "drafts",
      "settings",
      "variables",
      "secrets",
      "submodules",
      "agent-minutes",
    ]);
    required(repo, at, ["name", "fixture"]);
    const name = text(repo.name, [...at, "name"]);
    const parts = REPOSITORY.exec(name);
    if (!parts?.[1]) fail([...at, "name"], "expected a repository: owner/name");
    const owner = parts[1];
    const maintainers =
      repo.maintainers === undefined ? [] : userList(repo.maintainers, [...at, "maintainers"]);
    const collaborators: Record<string, Role> = {};
    for (const [user, role] of entries(repo.collaborators ?? {}, [...at, "collaborators"])) {
      const where = [...at, "collaborators", user];
      collaborators[login(user, where)] = choice(role, where, ROLES);
    }
    for (const one of [...maintainers, ...Object.keys(collaborators)]) addUser(one);
    if (!orgNames.has(owner.toLowerCase())) addUser(owner);
    return {
      name,
      owner,
      fixture: fixtureOf(repo.fixture, [...at, "fixture"], options.fixtures),
      maintainers,
      collaborators,
      private: repo.private === undefined ? true : boolean(repo.private, [...at, "private"]),
      drafts: repo.drafts === undefined ? true : boolean(repo.drafts, [...at, "drafts"]),
      settings:
        repo.settings === undefined ? undefined : settingsOf(repo.settings, [...at, "settings"]),
      variables: variablesOf(repo.variables, [...at, "variables"]),
      secrets: repo.secrets === undefined ? undefined : secretsOf(repo.secrets, [...at, "secrets"]),
      submodules: submodulesOf(repo.submodules, [...at, "submodules"]),
      agentMinutes:
        repo["agent-minutes"] === undefined
          ? undefined
          : positiveWhole(repo["agent-minutes"], [...at, "agent-minutes"]),
    } satisfies Repository;
  });
  if (repositories.length === 0) {
    fail([...path, "repositories"], "expected at least one repository");
  }
  const repoNames = new Set<string>();
  repositories.forEach((repository, index) => {
    if (repoNames.has(repository.name.toLowerCase())) {
      fail([...path, "repositories", index, "name"], `${repository.name} is declared twice`);
    }
    repoNames.add(repository.name.toLowerCase());
  });
  for (const organization of organizations) {
    if (users.has(organization.name.toLowerCase())) {
      const index = organizations.indexOf(organization);
      fail(
        [...path, "organizations", index, "name"],
        `${organization.name} is both a user and an organization`,
      );
    }
  }

  const world: World = {
    users: [...users.values()],
    organizations,
    repositories,
    app: { slug: "codeman", installations: undefined },
    runpod: fields.runpod === undefined ? undefined : runpodOf(fields.runpod, [...path, "runpod"]),
    openrouter:
      fields.openrouter === undefined
        ? undefined
        : openRouterOf(fields.openrouter, [...path, "openrouter"]),
  };
  if (fields.app !== undefined) world.app = appOf(fields.app, [...path, "app"], world);
  return world;
}

function fixtureOf(value: unknown, path: Path, root: string): string {
  const name = text(value, path);
  if (!FIXTURE.test(name)) {
    fail(path, "expected a fixture's name: lowercase letters, digits, '.', '_' and '-'");
  }
  const directory = join(root, name);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    fail(path, `no fixture ${name} in e2e/fixtures/`);
  }
  return directory;
}

/** `CODEMAN_SETTINGS`: the settings file's text, or a mapping written as that text. */
function settingsOf(value: unknown, path: Path): string {
  if (typeof value === "string") return value;
  record(value, path);
  return stringify(value);
}

function variablesOf(value: unknown, path: Path): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [name, item] of entries(value ?? {}, path)) {
    const at = [...path, name];
    if (!VARIABLE.test(name) || name.startsWith("GITHUB_")) {
      fail(at, "expected a variable name: letters, digits and '_', not starting with GITHUB_");
    }
    if (name === SETTINGS_VARIABLE) fail(at, "set CODEMAN_SETTINGS with settings");
    variables[name] = stringOrEmpty(item, at);
  }
  return variables;
}

function secretsOf(value: unknown, path: Path): ProviderSecret[] {
  const names = Object.keys(PROVIDER_SECRETS) as ProviderSecret[];
  return unique(
    list(value, path, (item, at) => choice(item, at, names)),
    path,
  );
}

function appOf(value: unknown, path: Path, world: World): App {
  const fields = record(value, path, ["slug", "installations"]);
  const slug = fields.slug === undefined ? "codeman" : text(fields.slug, [...path, "slug"]);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail([...path, "slug"], "expected an App slug");
  const installations =
    fields.installations === undefined
      ? undefined
      : list(fields.installations, [...path, "installations"], (item, at) =>
          installationOf(item, at, world),
        );
  return { slug, installations };
}

function installationOf(value: unknown, path: Path, world: World): Installation {
  const fields = record(value, path, ["owner", "repositories", "permissions"]);
  required(fields, path, ["owner"]);
  const owner = text(fields.owner, [...path, "owner"]);
  const owned = world.repositories.filter(
    (repository) => repository.owner.toLowerCase() === owner.toLowerCase(),
  );
  if (owned.length === 0) fail([...path, "owner"], `no repository of the world is ${owner}'s`);
  let repositories: string[] | "all" = "all";
  if (fields.repositories !== undefined && fields.repositories !== "all") {
    repositories = list(fields.repositories, [...path, "repositories"], (item, at) => {
      const name = text(item, at);
      if (
        !owned.some(
          (repository) => repository.name.toLowerCase() === `${owner}/${name}`.toLowerCase(),
        )
      ) {
        fail(at, `no repository ${owner}/${name} in the world`);
      }
      return name;
    });
  }
  let permissions: Installation["permissions"];
  if (fields.permissions !== undefined) {
    permissions = {};
    for (const [name, level] of entries(fields.permissions, [...path, "permissions"])) {
      permissions[name] = choice(level, [...path, "permissions", name], LEVELS) as "read";
    }
  }
  return { owner, repositories, permissions };
}

function runpodOf(value: unknown, path: Path): RunpodWorld {
  const fields = record(value, path, ["catalog", "endpoints", "tee"]);
  return {
    tee: fields.tee === undefined ? undefined : teeOf(fields.tee, [...path, "tee"]),
    catalog:
      fields.catalog === undefined
        ? undefined
        : list(
            fields.catalog,
            [...path, "catalog"],
            (item, at): CatalogGpu => fakeShape(at, () => catalogGpuOf(item)),
          ),
    endpoints: list(
      fields.endpoints ?? [],
      [...path, "endpoints"],
      (item, at): EndpointSetup => fakeShape(at, () => endpointOf(item)),
    ),
  };
}

/** `{ path: sha }`: each a path in the repository and a full commit SHA. */
function submodulesOf(value: unknown, path: Path): Record<string, string> {
  const submodules: Record<string, string> = {};
  for (const [file, sha] of entries(value ?? {}, path)) {
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(file) || file.split("/").includes("..")) {
      fail([...path, file], "expected a relative path");
    }
    const commit = text(sha, [...path, file]);
    if (!/^[0-9a-f]{40}$/.test(commit)) fail([...path, file], "expected a full commit SHA");
    submodules[file] = commit;
  }
  return submodules;
}

/** A whole number of at least 1. */
function positiveWhole(value: unknown, path: Path): number {
  if (!Number.isInteger(value) || (value as number) < 1) fail(path, "a whole number of at least 1");
  return value as number;
}

/** `meet: { issues, timeout }`: at least 2 issues; 2 minutes by default. */
function teeOf(value: unknown, path: Path): TeeWorld {
  const fields = record(value, path, ["meet"]);
  if (fields.meet === undefined) return { meet: undefined };
  const at = [...path, "meet"];
  const meet = record(fields.meet, at, ["issues", "timeout"]);
  required(meet, at, ["issues"]);
  const issues = meet.issues;
  if (!Number.isInteger(issues) || (issues as number) < 2) {
    fail([...at, "issues"], "a whole number of at least 2");
  }
  return {
    meet: {
      issues: issues as number,
      timeoutMs: meet.timeout === undefined ? 120_000 : duration(meet.timeout, [...at, "timeout"]),
    },
  };
}

/** A shape a fake validates itself, with its message at this path. */
function fakeShape<T>(path: Path, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return fail(path, (error.body as { message?: string }).message ?? "invalid");
  }
}

function openRouterOf(value: unknown, path: Path): OpenRouterWorld {
  const fields = record(value, path, ["credits", "prices", "lags"]);
  let prices: OpenRouterWorld["prices"];
  if (fields.prices !== undefined) {
    const given = record(fields.prices, [...path, "prices"], ["prompt", "completion"]);
    required(given, [...path, "prices"], ["prompt", "completion"]);
    prices = {
      prompt: amount(given.prompt, [...path, "prices", "prompt"]),
      completion: amount(given.completion, [...path, "prices", "completion"]),
    };
  }
  return {
    credits:
      fields.credits === undefined ? undefined : amount(fields.credits, [...path, "credits"]),
    prices,
    lags: fields.lags === undefined ? undefined : lagsOf(fields.lags, [...path, "lags"]),
  };
}

/** `usage` and `analytics`: a duration, or `hold` until settled. */
function lagsOf(value: unknown, path: Path): Lags {
  const fields = record(value, path, ["usage", "analytics"]);
  const lag = (item: unknown, at: Path) => (item === "hold" ? null : duration(item, at));
  const lags: Lags = {};
  if (fields.usage !== undefined) lags.usageMs = lag(fields.usage, [...path, "usage"]);
  if (fields.analytics !== undefined) {
    lags.analyticsMs = lag(fields.analytics, [...path, "analytics"]);
  }
  if (Object.keys(lags).length === 0) fail(path, "expected usage or analytics");
  return lags;
}

// The agent

function agentOf(value: unknown, path: Path, context: Context): Agent {
  if (value === undefined) return { source: {}, script: {} };
  const source = record(value, path);
  for (const ref of Object.keys(source)) {
    if (isIssueRef(ref) && !context.issues.has(ref)) {
      fail([...path, ref], `no open-issue defines the issue ref ${ref}`);
    }
  }
  try {
    return { source, script: scriptOf(source) };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    // The script's own validator names fields from `$`, the section's root.
    const message = (error.body as { message?: string }).message ?? "";
    const found = /^\$(\S*): (.*?)\.?$/.exec(message);
    if (!found) return fail(path, message);
    const parts: (string | number)[] = [];
    for (const part of (found[1] ?? "").matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)) {
      parts.push(part[2] === undefined ? (part[1] ?? "") : Number(part[2]));
    }
    return fail([...path, ...parts], found[2] ?? message);
  }
}

// Actions

function actionsOf(value: unknown, path: Path, context: Context): Action[] {
  const actions = list(value, path, (item, at) => actionOf(item, at, context));
  if (actions.length === 0) fail(path, "expected at least one action");
  return actions;
}

function actionOf(value: unknown, path: Path, context: Context): Action {
  const [kind, body] = oneOf(value, path, ACTION_KINDS);
  const at = [...path, kind];
  switch (kind) {
    case "open-issue": {
      const fields = record(body, at, ["ref", "as", "repo", "title", "body", "labels"]);
      required(fields, at, ["ref", "as", "title"]);
      const repo = repoOf(fields.repo, [...at, "repo"], context);
      const ref = text(fields.ref, [...at, "ref"]);
      if (!isIssueRef(ref)) {
        fail([...at, "ref"], "expected an issue ref: letters, digits, '.', '_' and '-'");
      }
      if (context.issues.has(ref)) fail([...at, "ref"], `the issue ref ${ref} is already defined`);
      const action: Action = {
        kind,
        as: userOf(fields.as, [...at, "as"], context),
        repo,
        ref,
        title: text(fields.title, [...at, "title"]),
        body: fields.body === undefined ? "" : stringOrEmpty(fields.body, [...at, "body"]),
        labels: fields.labels === undefined ? [] : labelsOf(fields.labels, [...at, "labels"]),
      };
      context.issues.set(ref, repo);
      return action;
    }
    case "comment": {
      const fields = record(body, at, ["issue", "pull", "as", "body"]);
      required(fields, at, ["as", "body"]);
      const target = targetOf(fields, at, context);
      return {
        kind,
        ...target,
        repo: repoOfIssue(target.issue, context),
        as: userOf(fields.as, [...at, "as"], context),
        body: text(fields.body, [...at, "body"]),
      };
    }
    case "label":
    case "unlabel": {
      const fields = record(body, at, ["issue", "pull", "as", "label"]);
      required(fields, at, ["as", "label"]);
      const target = targetOf(fields, at, context);
      return {
        kind,
        ...target,
        repo: repoOfIssue(target.issue, context),
        as: userOf(fields.as, [...at, "as"], context),
        label: labelOf(fields.label, [...at, "label"]),
      };
    }
    case "review": {
      const fields = record(body, at, ["pull", "as", "state", "body", "comments"]);
      required(fields, at, ["pull", "as", "state"]);
      const pull = issueRef(fields.pull, [...at, "pull"], context);
      return {
        kind,
        pull,
        repo: repoOfIssue(pull, context),
        as: userOf(fields.as, [...at, "as"], context),
        state: choice(fields.state, [...at, "state"], ["approve", "request-changes", "comment"]),
        body: fields.body === undefined ? undefined : text(fields.body, [...at, "body"]),
        comments: list(fields.comments ?? [], [...at, "comments"], (item, where) => {
          const comment = record(item, where, ["path", "line", "body"]);
          required(comment, where, ["path", "body"]);
          return {
            path: text(comment.path, [...where, "path"]),
            line:
              comment.line === undefined ? undefined : integer(comment.line, [...where, "line"], 1),
            body: text(comment.body, [...where, "body"]),
          };
        }),
      };
    }
    case "close":
    case "reopen": {
      const fields = record(body, at, ["issue", "pull", "as"]);
      required(fields, at, ["as"]);
      const target = targetOf(fields, at, context);
      return {
        kind,
        ...target,
        repo: repoOfIssue(target.issue, context),
        as: userOf(fields.as, [...at, "as"], context),
      };
    }
    case "push": {
      const fields = record(body, at, [
        "as",
        "repo",
        "branch",
        "task",
        "files",
        "message",
        "base",
        "force",
        "age",
      ]);
      required(fields, at, ["as", "files"]);
      exclusive(fields, at, ["branch", "task"], true);
      let branch: { name: string } | { task: string };
      let repo: string;
      if (fields.task !== undefined) {
        if (fields.repo !== undefined) fail([...at, "repo"], "the task's ref names its repository");
        const task = issueRef(fields.task, [...at, "task"], context);
        branch = { task };
        repo = repoOfIssue(task, context);
      } else {
        branch = { name: text(fields.branch, [...at, "branch"]) };
        repo = repoOf(fields.repo, [...at, "repo"], context);
      }
      const files: Record<string, string | null> = {};
      for (const [file, content] of entries(fields.files, [...at, "files"])) {
        files[file] = content === null ? null : stringOrEmpty(content, [...at, "files", file]);
      }
      return {
        kind,
        as: userOf(fields.as, [...at, "as"], context),
        repo,
        branch,
        files,
        message:
          fields.message === undefined ? undefined : text(fields.message, [...at, "message"]),
        base: fields.base === undefined ? undefined : text(fields.base, [...at, "base"]),
        force: fields.force === undefined ? false : boolean(fields.force, [...at, "force"]),
        ageMs: fields.age === undefined ? 0 : duration(fields.age, [...at, "age"]),
      };
    }
    case "set-variable": {
      const fields = record(body, at, ["org", "repo", "name", "value"]);
      exclusive(fields, at, ["org", "repo"], true);
      if (!("value" in fields)) fail([...at, "value"], "missing: a value, or null to delete it");
      let scope: { org: string } | { repo: string };
      if (fields.org !== undefined) {
        const org = text(fields.org, [...at, "org"]);
        if (
          !context.world.organizations.some((one) => one.name.toLowerCase() === org.toLowerCase())
        ) {
          fail([...at, "org"], `no organization ${org} in the world`);
        }
        scope = { org };
      } else scope = { repo: repoOf(fields.repo, [...at, "repo"], context) };
      const name =
        fields.name === undefined ? SETTINGS_VARIABLE : text(fields.name, [...at, "name"]);
      if (!VARIABLE.test(name)) fail([...at, "name"], "expected a variable name");
      const value =
        fields.value === null
          ? null
          : name === SETTINGS_VARIABLE
            ? settingsOf(fields.value, [...at, "value"])
            : stringOrEmpty(fields.value, [...at, "value"]);
      return { kind, scope, name, value };
    }
    case "seed": {
      const fields = record(body, at, ["doc", "age", "data"]);
      required(fields, at, ["doc", "data"]);
      const ageMs = fields.age === undefined ? 0 : duration(fields.age, [...at, "age"]);
      return {
        kind,
        doc: storePath(fields.doc, [...at, "doc"], "doc"),
        ageMs,
        data: record(times(fields.data, [...at, "data"], ageMs), [...at, "data"]),
      };
    }
    case "run": {
      const fields = record(body, at, ["repo", "event", "inputs", "max-runs"]);
      required(fields, at, ["event"]);
      const event = choice(fields.event, [...at, "event"], EVENTS);
      const inputs: Record<string, string> = {};
      if (fields.inputs !== undefined) {
        if (event !== "workflow_dispatch") {
          fail([...at, "inputs"], "only workflow_dispatch has inputs");
        }
        for (const [name, item] of entries(fields.inputs, [...at, "inputs"])) {
          const where = [...at, "inputs", name];
          if (!DISPATCH_INPUTS.includes(name)) {
            fail(where, `expected one of the workflow's inputs: ${DISPATCH_INPUTS.join(", ")}`);
          }
          inputs[name] = scalarText(item, where);
        }
      }
      return {
        kind,
        repo: repoOf(fields.repo, [...at, "repo"], context),
        event,
        inputs,
        maxRuns:
          fields["max-runs"] === undefined
            ? RUN_CHAIN_RUNS
            : integer(fields["max-runs"], [...at, "max-runs"], 0),
      };
    }
    case "advance": {
      const fields = record(body, at, ["repo", "until", "max-runs"]);
      required(fields, at, ["until", "max-runs"]);
      return {
        kind,
        repo: repoOf(fields.repo, [...at, "repo"], context),
        until: expectationOf(fields.until, [...at, "until"], context),
        maxRuns: integer(fields["max-runs"], [...at, "max-runs"], 1),
      };
    }
    case "parallel":
      return parallelOf(body, at, context);
    case "fault":
      return faultOf(body, at, context);
    case "apply": {
      if (typeof body === "string") {
        return { kind, mode: choice(body, at, ["skip", "fail"]), issue: undefined };
      }
      const fields = record(body, at, ["mode", "issue"]);
      required(fields, at, ["mode"]);
      return {
        kind,
        mode: choice(fields.mode, [...at, "mode"], ["skip", "fail"]),
        issue:
          fields.issue === undefined
            ? undefined
            : issueRef(fields.issue, [...at, "issue"], context),
      };
    }
    case "wait": {
      const fields = record(body, at, ["until", "timeout", "for"]);
      // A plain pause, such as a second between two users' actions that GitHub times apart.
      if (fields.for !== undefined) {
        if (fields.until !== undefined || fields.timeout !== undefined) {
          fail(at, "takes either for, or until and timeout");
        }
        return { kind, until: undefined, timeoutMs: duration(fields.for, [...at, "for"]) };
      }
      required(fields, at, ["until", "timeout"]);
      return {
        kind,
        until: expectationOf(fields.until, [...at, "until"], context),
        timeoutMs: duration(fields.timeout, [...at, "timeout"]),
      };
    }
    case "expect":
      return { kind, ...expectationOf(body, at, context) };
  }
}

/** Branches see the refs defined before; after it, every branch's new refs are defined. */
function parallelOf(value: unknown, path: Path, context: Context): Action {
  const added = new Map<string, string>();
  const pods = new Set<string>();
  const branches = list(value, path, (item, at) => {
    const branch: Context = {
      ...context,
      issues: new Map(context.issues),
      pods: new Set(context.pods),
    };
    const actions = actionsOf(item, at, branch);
    for (const [ref, repo] of branch.issues) {
      if (context.issues.has(ref)) continue;
      if (added.has(ref)) fail(at, `the issue ref ${ref} is defined by another branch too`);
      added.set(ref, repo);
    }
    for (const ref of branch.pods) {
      if (context.pods.has(ref)) continue;
      if (pods.has(ref)) fail(at, `the pod ref ${ref} is defined by another branch too`);
      pods.add(ref);
    }
    return actions;
  });
  if (branches.length < 2) fail(path, "expected two or more lists of actions");
  for (const [ref, repo] of added) context.issues.set(ref, repo);
  for (const ref of pods) context.pods.add(ref);
  return { kind: "parallel", branches };
}

const FAULT_TARGETS = [...FAKES, "pod", "job", "firestore", "clear"] as const;

function faultOf(value: unknown, path: Path, context: Context): Fault {
  const [target, body] = oneOf(value, path, FAULT_TARGETS);
  const at = [...path, target];
  const kind = "fault" as const;
  const own = typeof body === "object" && body !== null && !("path" in body);
  switch (target) {
    case "runpod":
      if (own) {
        const fields = record(body, at, ["pod-start", "low-balance", "hold-queues", "pod-age"]);
        const runpod: {
          podStart?: "never" | "fail";
          lowBalance?: boolean;
          holdQueues?: boolean | string[];
          podAgeMs?: number;
        } = {};
        if (fields["pod-age"] !== undefined) {
          runpod.podAgeMs = duration(fields["pod-age"], [...at, "pod-age"]);
        }
        if (fields["pod-start"] !== undefined) {
          runpod.podStart = choice(fields["pod-start"], [...at, "pod-start"], ["never", "fail"]);
        }
        if (fields["low-balance"] !== undefined) {
          runpod.lowBalance = boolean(fields["low-balance"], [...at, "low-balance"]);
        }
        const hold = fields["hold-queues"];
        if (hold !== undefined) {
          runpod.holdQueues =
            typeof hold === "boolean" ? hold : list(hold, [...at, "hold-queues"], text);
        }
        if (Object.keys(runpod).length === 0) {
          fail(
            at,
            "expected pod-start, low-balance, hold-queues or pod-age, or an HTTP fault's path",
          );
        }
        return { kind, target, runpod };
      }
      break;
    case "google":
      if (own) {
        const fields = record(body, at, ["refuse-repositories", "disabled-accounts", "expiry"]);
        const google: {
          refuseRepositories?: string[];
          disabledAccounts?: string[];
          expirySeconds?: number;
        } = {};
        if (fields["refuse-repositories"] !== undefined) {
          google.refuseRepositories = list(
            fields["refuse-repositories"],
            [...at, "refuse-repositories"],
            (item, where) => repoOf(item, where, context),
          );
        }
        if (fields["disabled-accounts"] !== undefined) {
          google.disabledAccounts = list(
            fields["disabled-accounts"],
            [...at, "disabled-accounts"],
            text,
          );
        }
        if (fields.expiry !== undefined) {
          google.expirySeconds = Math.floor(duration(fields.expiry, [...at, "expiry"]) / 1000);
        }
        if (Object.keys(google).length === 0) {
          fail(
            at,
            "expected refuse-repositories, disabled-accounts or expiry, or an HTTP fault's path",
          );
        }
        return { kind, target, google };
      }
      break;
    case "openrouter":
      if (own) {
        const fields = record(body, at, ["lags"]);
        required(fields, at, ["lags"]);
        return { kind, target, openrouter: { lags: lagsOf(fields.lags, [...at, "lags"]) } };
      }
      break;
    case "pod": {
      const fields = record(body, at, ["pod", "action"]);
      required(fields, at, ["pod", "action"]);
      return {
        kind,
        target,
        pod: podRef(fields.pod, [...at, "pod"], context),
        action: choice(fields.action, [...at, "action"], ["restart", "exit", "fail"]),
      };
    }
    case "job": {
      const fields = record(body, at, ["name", "issue", "conclusion", "times"]);
      required(fields, at, ["name"]);
      return {
        kind,
        target,
        job: choice(fields.name, [...at, "name"], JOBS),
        issue:
          fields.issue === undefined
            ? undefined
            : issueRef(fields.issue, [...at, "issue"], context),
        conclusion:
          fields.conclusion === undefined
            ? "failure"
            : choice(fields.conclusion, [...at, "conclusion"], ["failure", "cancelled"]),
        times: fields.times === undefined ? undefined : integer(fields.times, [...at, "times"], 1),
      };
    }
    case "firestore":
      return { kind, target, down: choice(body, at, ["down", "up"]) === "down" };
    case "clear":
      return {
        kind,
        target,
        fakes:
          body === "all"
            ? [...FAKES]
            : unique(
                list(body, at, (item, where) => choice(item, where, FAKES)),
                at,
              ),
      };
  }
  return { kind, target: "http", fake: target, http: httpFaultOf(body, at) };
}

/** The shared fault of e2e/fakes/http.ts. */
function httpFaultOf(value: unknown, path: Path): HttpFault {
  const fields = record(value, path, [
    "method",
    "path",
    "status",
    "body",
    "delay",
    "drop",
    "times",
  ]);
  required(fields, path, ["path"]);
  const route = text(fields.path, [...path, "path"]);
  if (!route.startsWith("/")) fail([...path, "path"], "expected a route pattern starting with '/'");
  const fault: HttpFault = {
    method:
      fields.method === undefined ? undefined : choice(fields.method, [...path, "method"], METHODS),
    path: route,
    status:
      fields.status === undefined ? undefined : integer(fields.status, [...path, "status"], 100),
    body: fields.body,
    delayMs: fields.delay === undefined ? undefined : duration(fields.delay, [...path, "delay"]),
    drop: fields.drop === undefined ? false : boolean(fields.drop, [...path, "drop"]),
    times: fields.times === undefined ? undefined : integer(fields.times, [...path, "times"], 1),
  };
  if (fault.status !== undefined && fault.status > 599) {
    fail([...path, "status"], "expected an HTTP status");
  }
  if (fault.status === undefined && fault.delayMs === undefined && !fault.drop) {
    fail(path, "expected status, delay or drop");
  }
  return fault;
}

// Expectations

const EXPECT_FIELDS = [
  "issue",
  "labels",
  "no-labels",
  "comments",
  "commits",
  "pull-request",
  "store",
  "ledger",
  "fakes",
  "pods",
  "engine",
  "violations",
];
const ISSUE_CHECKS = ["labels", "no-labels", "comments", "commits", "pull-request"];

function expectationOf(value: unknown, path: Path, context: Context): Expectation {
  const fields = record(value, path, EXPECT_FIELDS);
  if (!Object.keys(fields).some((name) => name !== "issue")) {
    fail(path, `expected a check: ${EXPECT_FIELDS.filter((name) => name !== "issue").join(", ")}`);
  }
  const issue =
    fields.issue === undefined ? undefined : issueRef(fields.issue, [...path, "issue"], context);
  for (const name of ISSUE_CHECKS) {
    if (fields[name] !== undefined && issue === undefined) {
      fail([...path, name], "checks an issue: name it with issue");
    }
  }
  const at = (name: string) => [...path, name];
  return {
    issue,
    labels: fields.labels === undefined ? undefined : labelsOf(fields.labels, at("labels")),
    noLabels:
      fields["no-labels"] === undefined
        ? undefined
        : labelsOf(fields["no-labels"], at("no-labels")),
    comments:
      fields.comments === undefined
        ? undefined
        : list(fields.comments, at("comments"), (item, where) =>
            commentMatchOf(item, where, context),
          ),
    commits:
      fields.commits === undefined ? undefined : commitMatchOf(fields.commits, at("commits")),
    pullRequest:
      fields["pull-request"] === undefined
        ? undefined
        : fields["pull-request"] === "none"
          ? "none"
          : pullMatchOf(fields["pull-request"], at("pull-request")),
    store: fields.store === undefined ? undefined : list(fields.store, at("store"), storeMatchOf),
    ledger:
      fields.ledger === undefined ? undefined : ledgerOf(fields.ledger, at("ledger"), context),
    fakes: fields.fakes === undefined ? undefined : fakeMatchesOf(fields.fakes, at("fakes")),
    pods:
      fields.pods === undefined
        ? undefined
        : list(fields.pods, at("pods"), (item, where) => podMatchOf(item, where, context)),
    engine:
      fields.engine === undefined ? undefined : engineOf(fields.engine, at("engine"), context),
    violations:
      fields.violations === undefined
        ? undefined
        : choice(fields.violations, at("violations"), ["none"]),
  };
}

function commentMatchOf(value: unknown, path: Path, context: Context): CommentMatch {
  const fields = record(value, path, ["kind", "contains", "by", "count"]);
  let by: string | undefined;
  if (fields.by !== undefined) {
    by = text(fields.by, [...path, "by"]);
    const bots = [`${context.world.app.slug}[bot]`, ACTIONS_BOT];
    if (!bots.includes(by) && !context.users.has(by.toLowerCase())) {
      fail([...path, "by"], `${by} is no user of the world nor ${bots.join(" or ")}`);
    }
  }
  return {
    kind: fields.kind === undefined ? "any" : choice(fields.kind, [...path, "kind"], COMMENT_KINDS),
    contains:
      fields.contains === undefined
        ? []
        : typeof fields.contains === "string"
          ? [text(fields.contains, [...path, "contains"])]
          : list(fields.contains, [...path, "contains"], text),
    by,
    count: fields.count === undefined ? undefined : countOf(fields.count, [...path, "count"]),
  };
}

function commitMatchOf(value: unknown, path: Path): CommitMatch {
  const fields = record(value, path, ["branch", "count", "files", "no-files", "message"]);
  return {
    branch: fields.branch === undefined ? undefined : text(fields.branch, [...path, "branch"]),
    count: fields.count === undefined ? undefined : countOf(fields.count, [...path, "count"]),
    files: list(fields.files ?? [], [...path, "files"], text),
    noFiles: list(fields["no-files"] ?? [], [...path, "no-files"], text),
    message: fields.message === undefined ? undefined : text(fields.message, [...path, "message"]),
  };
}

function pullMatchOf(value: unknown, path: Path): PullRequestMatch {
  const fields = record(value, path, ["ready", "state", "files"]);
  return {
    ready: fields.ready === undefined ? undefined : boolean(fields.ready, [...path, "ready"]),
    state:
      fields.state === undefined
        ? undefined
        : choice(fields.state, [...path, "state"], ["open", "closed"]),
    files: list(fields.files ?? [], [...path, "files"], text),
  };
}

function storeMatchOf(value: unknown, path: Path): StoreMatch {
  const fields = record(value, path, ["doc", "absent", "fields", "collection", "where", "count"]);
  exclusive(fields, path, ["doc", "collection"], true);
  if (fields.doc !== undefined) {
    for (const name of ["where", "count"]) {
      if (fields[name] !== undefined) fail([...path, name], "checks a collection, not a doc");
    }
    const absent =
      fields.absent === undefined ? false : boolean(fields.absent, [...path, "absent"]);
    if (absent && fields.fields !== undefined) {
      fail([...path, "fields"], "an absent doc has no fields");
    }
    return {
      doc: storePath(fields.doc, [...path, "doc"], "doc"),
      absent,
      fields:
        fields.fields === undefined ? undefined : patternFields(fields.fields, [...path, "fields"]),
    };
  }
  for (const name of ["absent", "fields"]) {
    if (fields[name] !== undefined) fail([...path, name], "checks a doc, not a collection");
  }
  return {
    collection: storePath(fields.collection, [...path, "collection"], "collection"),
    where: fields.where === undefined ? undefined : patternFields(fields.where, [...path, "where"]),
    count: fields.count === undefined ? undefined : countOf(fields.count, [...path, "count"]),
  };
}

function ledgerOf(value: unknown, path: Path, context: Context): LedgerMatch {
  const fields = record(value, path, [
    "cost-at-most",
    "cost-at-least",
    "runs",
    "split-on",
    "split-pod",
  ]);
  if (Object.keys(fields).length === 0) {
    fail(path, "expected cost-at-most, cost-at-least, runs, split-on or split-pod");
  }
  const split = fields["split-on"];
  if (split !== undefined && (typeof split !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(split))) {
    fail([...path, "split-on"], "expected a Serverless endpoint's ID");
  }
  return {
    splitOn: split as string | undefined,
    splitPod:
      fields["split-pod"] === undefined
        ? undefined
        : podRef(fields["split-pod"], [...path, "split-pod"], context),
    costAtMost:
      fields["cost-at-most"] === undefined
        ? undefined
        : amount(fields["cost-at-most"], [...path, "cost-at-most"]),
    costAtLeast:
      fields["cost-at-least"] === undefined
        ? undefined
        : amount(fields["cost-at-least"], [...path, "cost-at-least"]),
    runs: fields.runs === undefined ? undefined : countOf(fields.runs, [...path, "runs"]),
  };
}

function fakeMatchesOf(value: unknown, path: Path): FakeMatch[] {
  const matches: FakeMatch[] = [];
  for (const [fake, lists] of entries(value, path)) {
    const at = [...path, fake];
    choice(fake, at, FAKES);
    for (const [name, check] of entries(lists, at)) {
      const where = [...at, name];
      choice(name, where, FAKE_LISTS[fake as FakeName]);
      const fields = record(check ?? {}, where, ["where", "count"]);
      matches.push({
        fake: fake as FakeName,
        list: name,
        where:
          fields.where === undefined ? undefined : patternFields(fields.where, [...where, "where"]),
        count: fields.count === undefined ? undefined : countOf(fields.count, [...where, "count"]),
      });
    }
  }
  if (matches.length === 0) fail(path, "expected a fake's list");
  return matches;
}

function podMatchOf(value: unknown, path: Path, context: Context): PodMatch {
  const fields = record(value, path, ["ref", "pod", "status", "where", "count"]);
  exclusive(fields, path, ["ref", "pod"], false);
  if (fields.count !== undefined && (fields.ref !== undefined || fields.pod !== undefined)) {
    fail([...path, "count"], "counts pods: not with ref or pod, which name one");
  }
  let ref: string | undefined;
  if (fields.ref !== undefined) {
    ref = text(fields.ref, [...path, "ref"]);
    if (!isIssueRef(ref)) {
      fail([...path, "ref"], "expected a pod ref: letters, digits, '.', '_' and '-'");
    }
    if (context.pods.has(ref)) fail([...path, "ref"], `the pod ref ${ref} is already defined`);
    context.pods.add(ref);
  }
  return {
    ref,
    pod: fields.pod === undefined ? undefined : podRef(fields.pod, [...path, "pod"], context),
    status:
      fields.status === undefined
        ? undefined
        : choice(fields.status, [...path, "status"], POD_STATUSES),
    where: fields.where === undefined ? undefined : patternFields(fields.where, [...path, "where"]),
    count: fields.count === undefined ? undefined : countOf(fields.count, [...path, "count"]),
  };
}

function engineOf(value: unknown, path: Path, context: Context): EngineMatch {
  const fields = record(value, path, ["pod", "gateway", "ollama", "vllm", "tee"]);
  const source = (name: string) =>
    fields[name] === undefined ? undefined : patternFields(fields[name], [...path, name]);
  const engine: EngineMatch = {
    pod: fields.pod === undefined ? undefined : podRef(fields.pod, [...path, "pod"], context),
    gateway: source("gateway"),
    ollama: source("ollama"),
    vllm: source("vllm"),
    tee: source("tee"),
  };
  if (!engine.gateway && !engine.ollama && !engine.vllm && !engine.tee) {
    fail(path, "expected gateway, ollama, vllm or tee");
  }
  return engine;
}

/**
 * A value's pattern: a scalar, `{ at-least, at-most }`, `{ contains }` (a text or texts), a
 * mapping of fields, or a list.
 */
function patternOf(value: unknown, path: Path): Pattern {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return { kind: "equals", value: value as string | number | boolean | null };
  }
  if (Array.isArray(value)) {
    return { kind: "list", items: value.map((item, index) => patternOf(item, [...path, index])) };
  }
  const fields = record(value, path);
  const names = Object.keys(fields);
  if (names.length > 0 && names.every((name) => name === "at-least" || name === "at-most")) {
    return rangeOf(fields, path);
  }
  if (names.length === 1 && names[0] === "contains") {
    const given = fields.contains;
    const texts = Array.isArray(given)
      ? given.map((item, index) => text(item, [...path, "contains", index]))
      : [text(given, [...path, "contains"])];
    if (texts.length === 0) fail([...path, "contains"], "expected a text or a list of texts");
    return { kind: "contains", texts };
  }
  if (names.length === 1 && names[0] === "not") {
    return { kind: "not", pattern: patternOf(fields.not, [...path, "not"]) };
  }
  return { kind: "object", fields: patternFields(fields, path) };
}

function patternFields(value: unknown, path: Path): Record<string, Pattern> {
  const fields: Record<string, Pattern> = {};
  for (const [name, item] of entries(value, path)) fields[name] = patternOf(item, [...path, name]);
  return fields;
}

function rangeOf(fields: Record<string, unknown>, path: Path): Pattern {
  const bound = (name: string) => {
    const item = fields[name];
    if (item === undefined) return undefined;
    if (typeof item !== "number" || !Number.isFinite(item)) {
      fail([...path, name], "expected a number");
    }
    return item;
  };
  return { kind: "range", atLeast: bound("at-least"), atMost: bound("at-most") };
}

/** A count: a whole number, or a range of them. */
function countOf(value: unknown, path: Path): Pattern {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const fields = record(value, path, ["at-least", "at-most"]);
    for (const [name, item] of Object.entries(fields)) integer(item, [...path, name], 0);
    return rangeOf(fields, path);
  }
  return { kind: "equals", value: integer(value, path, 0) };
}

// Store paths, from src/store/layout.ts with `*` for each ID.

const STORE_DOCS = [
  LAYOUT.organization("*"),
  LAYOUT.run("*", "*"),
  LAYOUT.event("*", "*"),
  `${LAYOUT.organizationPods("*")}/*`,
  LAYOUT.pod("*", "*"),
  LAYOUT.boardEntry("*", "*"),
  LAYOUT.batch("*", "*"),
  LAYOUT.endpointRun("*", "*", "*"),
  LAYOUT.context("*"),
].map((pattern) => pattern.split("/"));
const STORE_COLLECTIONS = STORE_DOCS.map((segments) => segments.slice(0, -1));

function storePath(value: unknown, path: Path, kind: "doc" | "collection"): string {
  const given = text(value, path);
  const segments = given.split("/");
  const patterns = kind === "doc" ? STORE_DOCS : STORE_COLLECTIONS;
  const matches = patterns.some(
    (pattern) =>
      pattern.length === segments.length &&
      pattern.every((part, index) =>
        part === "*" ? segments[index] !== "" : part === segments[index],
      ),
  );
  if (!matches) {
    fail(
      path,
      `expected a ${kind} of the store: ${patterns.map((pattern) => pattern.join("/")).join(", ")}`,
    );
  }
  return given;
}

/** `now`, `now-<duration>` and `now+<duration>` in seed data, as written `age` ago. */
function times(value: unknown, path: Path, ageMs: number): unknown {
  if (typeof value === "string") {
    const found = TIME.exec(value);
    if (!found) return value;
    const offset =
      found[2] === undefined ? 0 : duration(found[2], path) * (found[1] === "-" ? -1 : 1);
    return new RelativeTime(offset - ageMs);
  }
  if (Array.isArray(value)) return value.map((item, index) => times(item, [...path, index], ageMs));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, times(item, [...path, name], ageMs)]),
    );
  }
  return value;
}

// Names and refs

function repoOf(value: unknown, path: Path, context: Context): string {
  const repositories = context.world.repositories;
  if (value === undefined) {
    const only = repositories.length === 1 ? repositories[0] : undefined;
    if (!only) fail(path, "missing: the world has several repositories, so name one");
    return only.name;
  }
  const name = text(value, path);
  const found = repositories.find(
    (repository) => repository.name.toLowerCase() === name.toLowerCase(),
  );
  if (!found) fail(path, `no repository ${name} in the world`);
  return found.name;
}

function repoOfIssue(ref: string, context: Context): string {
  return context.issues.get(ref) ?? "";
}

function userOf(value: unknown, path: Path, context: Context): string {
  const name = text(value, path);
  if (!context.users.has(name.toLowerCase())) fail(path, `${name} is no user of the world`);
  return name;
}

function issueRef(value: unknown, path: Path, context: Context): string {
  const ref = text(value, path);
  if (!context.issues.has(ref)) {
    fail(path, `the issue ref ${ref} is not defined before this action: open-issue defines refs`);
  }
  return ref;
}

function podRef(value: unknown, path: Path, context: Context): string {
  const ref = text(value, path);
  if (!context.pods.has(ref)) {
    fail(
      path,
      `the pod ref ${ref} is not defined before this action: a pods check's ref defines it`,
    );
  }
  return ref;
}

/** An issue, or the pull request of the task it names: exactly one of `issue` and `pull`. */
function targetOf(fields: Record<string, unknown>, path: Path, context: Context): Target {
  exclusive(fields, path, ["issue", "pull"], true);
  const pull = fields.pull !== undefined;
  const name = pull ? "pull" : "issue";
  return { issue: issueRef(fields[name], [...path, name], context), pull };
}

function labelsOf(value: unknown, path: Path): string[] {
  return unique(list(value, path, labelOf), path);
}

/** A label; one in Codeman's namespace must be a state label (src/state.ts). */
function labelOf(value: unknown, path: Path): string {
  const label = text(value, path);
  if (label.startsWith("codeman:") && !STATES.some((state) => stateLabel(state) === label)) {
    fail(path, `${label} is no Codeman label: ${STATES.map(stateLabel).join(", ")}`);
  }
  return label;
}

function login(value: unknown, path: Path): string {
  const name = text(value, path);
  if (!LOGIN.test(name)) fail(path, "expected a login: letters, digits and '-'");
  return name;
}

// Primitives

function fail(path: Path, message: string): never {
  throw new Invalid(path, message);
}

/** A mapping; with `allowed`, any other key is an error. */
function record(value: unknown, path: Path, allowed?: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected a mapping");
  }
  if (allowed) {
    for (const name of Object.keys(value)) {
      if (!allowed.includes(name)) {
        fail([...path, name], `unknown field; expected one of ${allowed.join(", ")}`);
      }
    }
  }
  return value as Record<string, unknown>;
}

function required(fields: Record<string, unknown>, path: Path, names: readonly string[]): void {
  for (const name of names) {
    if (fields[name] === undefined || fields[name] === null) fail([...path, name], "missing");
  }
}

/** At most one of `names`, or exactly one when `one`. */
function exclusive(
  fields: Record<string, unknown>,
  path: Path,
  names: readonly string[],
  one: boolean,
): void {
  const given = names.filter((name) => fields[name] !== undefined);
  if (given.length > 1) {
    fail([...path, given[1] ?? ""], `not with ${given[0]}: one of ${names.join(", ")}`);
  }
  if (one && given.length === 0) fail(path, `expected one of ${names.join(", ")}`);
}

/** `{ kind: body }` with one key among `kinds`. */
function oneOf<K extends string>(value: unknown, path: Path, kinds: readonly K[]): [K, unknown] {
  if (typeof value === "string" && (kinds as readonly string[]).includes(value)) {
    fail(path, `expected { ${value}: ... }`);
  }
  const fields = record(value, path);
  const names = Object.keys(fields);
  const kind = names[0];
  if (names.length !== 1 || kind === undefined) {
    fail(path, `expected one key among ${kinds.join(", ")}`);
  }
  if (!(kinds as readonly string[]).includes(kind)) {
    fail([...path, kind], `unknown; expected one of ${kinds.join(", ")}`);
  }
  return [kind as K, fields[kind]];
}

function entries(value: unknown, path: Path): [string, unknown][] {
  return Object.entries(record(value, path));
}

function list<T>(value: unknown, path: Path, item: (value: unknown, path: Path) => T): T[] {
  if (!Array.isArray(value)) fail(path, "expected a list");
  return value.map((one, index) => item(one, [...path, index]));
}

function unique<T>(values: T[], path: Path): T[] {
  values.forEach((value, index) => {
    if (values.indexOf(value) !== index) fail([...path, index], `${String(value)} is listed twice`);
  });
  return values;
}

function text(value: unknown, path: Path): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "expected a non-empty string (quote numbers)");
  }
  return value;
}

function stringOrEmpty(value: unknown, path: Path): string {
  if (typeof value !== "string") fail(path, "expected a string (quote numbers)");
  return value;
}

/** A string, number or boolean, as text: a workflow input. */
function scalarText(value: unknown, path: Path): string {
  if (!["string", "number", "boolean"].includes(typeof value)) fail(path, "expected a scalar");
  return String(value);
}

function boolean(value: unknown, path: Path): boolean {
  if (typeof value !== "boolean") fail(path, "expected true or false");
  return value;
}

function integer(value: unknown, path: Path, min: number): number {
  if (!Number.isInteger(value) || (value as number) < min) {
    fail(path, `expected a whole number from ${min}`);
  }
  return value as number;
}

/** USD, or USD per token. */
function amount(value: unknown, path: Path): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(path, "expected a number from 0");
  }
  return value;
}

function choice<const T extends string>(value: unknown, path: Path, values: readonly T[]): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    fail(path, `expected one of ${values.join(", ")}`);
  }
  return value as T;
}

/** `500ms`, `90s`, `25m`, `2h`, `1d`. */
function duration(value: unknown, path: Path): number {
  const found = typeof value === "string" ? DURATION.exec(value) : null;
  if (!found) fail(path, "expected a duration, such as 500ms, 90s, 25m, 2h or 1d");
  return Math.round(Number(found[1]) * (UNITS[found[2] ?? ""] ?? 0));
}
