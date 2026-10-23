import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permissions } from "../fakes/github/auth.ts";
import type { Role } from "../fakes/github/world.ts";
import type { Fakes } from "./fakes.ts";
import { INTERNAL } from "./fakes.ts";
import type { RemoteGitHub } from "./github.ts";
import { PROVIDER_SECRETS, type Scenario, secretsOf, type World } from "./scenario/schema.ts";

/**
 * Builds a scenario's world on fakes that were just reset: its users, organizations and
 * repositories (each from its fixture, with Codeman's workflow templates), Codeman's own public
 * repository at the commit `CODEMAN_COMMIT_SHA` names, the App and its installations, the
 * Google side that admits the scenario's owners, Runpod's and OpenRouter's setups, and the agent's
 * script on the scripted model. Each scenario gets its own Firestore project, so no document of
 * an earlier scenario is in its store.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TEMPLATES = join(ROOT, "templates");

/** Codeman's repository, as the templates check it out and compare its commit. */
export const CODEMAN = { owner: "codenergy-dev", name: "codeman" };

/** The App's permissions on an installation, as docs/installation/setup.md lists them. */
export const APP_PERMISSIONS: Permissions = {
  contents: "write",
  issues: "write",
  pull_requests: "write",
  workflows: "write",
  actions: "write",
  metadata: "read",
};

/** The fake providers' keys, as the scenario's secrets give them. */
export const PROVIDER_KEYS: Record<string, string> = {
  CODEMAN_OPENROUTER_MANAGEMENT_KEY: "e2e-openrouter-management-key",
  CODEMAN_RUNPOD_API_KEY: "e2e-runpod-api-key",
  CODEMAN_RUNPOD_SERVERLESS_KEY: "e2e-runpod-serverless-key",
};

const PROVIDER =
  "projects/123456789/locations/global/workloadIdentityPools/codeman/providers/github";

/** What the world gives the simulator, and the scenario's own names. */
export interface BuiltWorld {
  project: string;
  serviceAccount: string;
  appClientId: string;
  codemanSha: string;
  /** Variables by organization (lowercase) and by repository (lowercase `owner/name`). */
  orgVariables: Map<string, Record<string, string>>;
  repoVariables: Map<string, Record<string, string>>;
  secrets(repository: string): Record<string, string>;
  vars(repository: string): Record<string, string>;
}

export async function buildWorld(
  scenario: Scenario,
  github: RemoteGitHub,
  fakes: Fakes,
): Promise<BuiltWorld> {
  const world = scenario.world;
  const project = `e2e-${randomBytes(6).toString("hex")}`;
  const serviceAccount = `codeman@${project}.iam.gserviceaccount.com`;
  const encryption = randomBytes(32).toString("base64url");

  const organizations = new Set(world.organizations.map((one) => one.name.toLowerCase()));
  for (const login of world.users) await github.addUser(login);
  for (const organization of world.organizations) {
    await github.addOrganization({
      login: organization.name,
      owners: organization.owners,
      members: organization.members,
    });
  }
  await github.addOrganization({ login: CODEMAN.owner, owners: [], members: [] });
  const codeman = await github.addRepository({
    owner: CODEMAN.owner,
    name: CODEMAN.name,
    private: false,
    drafts: true,
    files: { "README.md": "Codeman, as the e2e suite's fake GitHub holds it.\n" },
    collaborators: {},
  });
  const codemanSha = await github.resolve(codeman.fullName, codeman.defaultBranch);
  if (!codemanSha) throw new Error("Codeman's repository on the fake has no commit.");

  const workflows = {
    ".github/workflows/codeman.yml": readFileSync(join(TEMPLATES, "codeman.yml"), "utf8"),
    ".github/workflows/codeman-task.yml": readFileSync(join(TEMPLATES, "codeman-task.yml"), "utf8"),
  };
  const workflowsOf = (repository: Scenario["world"]["repositories"][number]) =>
    repository.agentMinutes === undefined
      ? workflows
      : {
          ...workflows,
          ".github/workflows/codeman-task.yml": withAgentMinutes(
            workflows[".github/workflows/codeman-task.yml"],
            repository.agentMinutes,
          ),
        };
  const ownerIds = new Set<string>();
  for (const repository of world.repositories) {
    const collaborators: Record<string, Role> = { ...repository.collaborators };
    for (const login of repository.maintainers) collaborators[login] = "maintain";
    const info = await github.addRepository({
      owner: repository.owner,
      name: repository.name.split("/")[1] ?? repository.name,
      private: repository.private,
      drafts: repository.drafts,
      files: { ...fixtureFiles(repository.fixture), ...workflowsOf(repository) },
      ...(Object.keys(repository.submodules).length > 0
        ? { submodules: repository.submodules }
        : {}),
      collaborators,
    });
    ownerIds.add(String(info.ownerId));
  }

  const { clientId, privateKey } = await github.registerApp(world.app.slug);
  const installations =
    world.app.installations ??
    [...new Set(world.repositories.map((repository) => repository.owner))].map((owner) => ({
      owner,
      repositories: "all" as const,
      permissions: undefined,
    }));
  for (const installation of installations) {
    await github.install({
      app: world.app.slug,
      owner: installation.owner,
      repositories: installation.repositories,
      permissions: installation.permissions ?? APP_PERMISSIONS,
    });
  }

  await fakes.google.json("PUT", "/google/setup", {
    provider: PROVIDER,
    serviceAccounts: [serviceAccount],
    condition: { ownerIds: [...ownerIds] },
  });
  await setUpProviders(world, fakes);
  await fakes.llm.control("PUT", `/llm/scripts/${scenario.id}`, { body: scenario.agent.source });

  const orgVariables = new Map<string, Record<string, string>>();
  for (const organization of world.organizations) {
    orgVariables.set(organization.name.toLowerCase(), {
      ...organization.variables,
      ...(organization.settings !== undefined ? { CODEMAN_SETTINGS: organization.settings } : {}),
    });
  }
  const repoVariables = new Map<string, Record<string, string>>();
  for (const repository of world.repositories) {
    repoVariables.set(repository.name.toLowerCase(), {
      ...repository.variables,
      ...(repository.settings !== undefined ? { CODEMAN_SETTINGS: repository.settings } : {}),
    });
  }
  const base = {
    CODEMAN_COMMIT_SHA: codemanSha,
    CODEMAN_GITHUB_APP_CLIENT_ID: clientId,
    CODEMAN_FIREBASE_PROJECT: project,
    CODEMAN_WORKLOAD_IDENTITY_PROVIDER: PROVIDER,
    CODEMAN_SERVICE_ACCOUNT: serviceAccount,
  };
  const repositoryOf = (name: string) => {
    const found = world.repositories.find((one) => one.name.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error(`${name} is no repository of the scenario.`);
    return found;
  };
  return {
    project,
    serviceAccount,
    appClientId: clientId,
    codemanSha,
    orgVariables,
    repoVariables,
    vars(name) {
      const repository = repositoryOf(name);
      const owner = repository.owner.toLowerCase();
      // A repository's variable wins over its organization's of the same name, as on GitHub.
      return {
        ...base,
        ...(organizations.has(owner) ? orgVariables.get(owner) : {}),
        ...repoVariables.get(repository.name.toLowerCase()),
      };
    },
    secrets(name) {
      const repository = repositoryOf(name);
      const secrets: Record<string, string> = {
        CODEMAN_GITHUB_APP_PRIVATE_KEY: privateKey,
        CODEMAN_KEY_ENCRYPTION_SECRET: encryption,
      };
      for (const provider of secretsOf(world, repository)) {
        const secret = PROVIDER_SECRETS[provider];
        secrets[secret] = PROVIDER_KEYS[secret] ?? "";
      }
      return secrets;
    },
  };
}

async function setUpProviders(world: World, fakes: Fakes): Promise<void> {
  const runpod = world.runpod;
  await fakes.runpod.json("PUT", "/runpod/setup", {
    keys: [PROVIDER_KEYS.CODEMAN_RUNPOD_API_KEY, PROVIDER_KEYS.CODEMAN_RUNPOD_SERVERLESS_KEY],
    ...(runpod?.catalog ? { catalog: runpod.catalog } : {}),
    endpoints: runpod?.endpoints ?? [],
  });
  const openrouter = world.openrouter;
  if (openrouter?.credits !== undefined) {
    await fakes.openrouter.json("PUT", "/openrouter/credits", { credits: openrouter.credits });
  }
  if (openrouter?.prices)
    await fakes.openrouter.json("PUT", "/openrouter/prices", openrouter.prices);
  if (openrouter?.lags) await fakes.openrouter.json("PUT", "/openrouter/lags", openrouter.lags);
}

/** A fixture's files, as text, by their path under it. */
/**
 * The task workflow with the agent's time limit a repository chose: the `agent-minutes` input of
 * its Codeman step, which a repository may lower in its copy (action.yml). Fails if the template
 * no longer has the one line it replaces.
 */
export function withAgentMinutes(template: string, minutes: number): string {
  const line = /^(\s+agent-minutes: )\d+$/m;
  if (!line.test(template)) {
    throw new Error("templates/codeman-task.yml has no agent-minutes line to replace.");
  }
  return template.replace(line, `$1${minutes}`);
}

export function fixtureFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(directory, path).split(sep).join("/")] = readFileSync(path, "utf8");
  }
  return files;
}

/** The internal origin the OIDC request URL takes, as `getIDToken` appends `&audience=`. */
export const OIDC_REQUEST_URL = `${INTERNAL.google}/oidc/token?api-version=2.0`;
