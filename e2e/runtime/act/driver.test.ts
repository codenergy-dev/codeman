import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { type ActCommandSpec, ActRefused, actCommand, shellQuote, valuesFile } from "./driver.ts";

/** A command spec whose files and working directory exist, as the runner writes them. */
function spec(changes: Partial<ActCommandSpec> = {}): ActCommandSpec {
  const dir = mkdtempSync(join(tmpdir(), "codeman-e2e-act-driver-"));
  const workdir = join(dir, "run");
  mkdirSync(join(workdir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(workdir, ".github", "workflows", "codeman.yml"), "on: push\n");
  const files = {
    event: join(dir, "event.json"),
    env: join(dir, "env.yaml"),
    secrets: join(dir, "secrets.yaml"),
    vars: join(dir, "vars.yaml"),
  };
  for (const path of Object.values(files)) writeFileSync(path, "{}\n");
  const state = {
    home: join(dir, "home"),
    configHome: join(dir, "config"),
    cacheHome: join(dir, "cache"),
    tmp: join(dir, "tmp"),
  };
  return {
    act: "/usr/local/bin/act",
    workdir,
    workflow: ".github/workflows/codeman.yml",
    event: "issues",
    files,
    token: "ghs_fake0123456789",
    env: {
      GITHUB_SERVER_URL: "https://github-e2e.localhost",
      GITHUB_API_URL: "https://github-e2e.localhost/api/v3",
      GITHUB_GRAPHQL_URL: "https://github-e2e.localhost/api/graphql",
      GITHUB_RUN_ID: "9001",
    },
    actor: "alice",
    defaultBranch: "main",
    image: "codeman-e2e-runner:local",
    network: "codeman-e2e-jobs",
    containerOptions: ["--volume", "codeman-e2e-ca:/etc/codeman-e2e:ro"],
    actionCache: join(dir, "actions"),
    state,
    dockerHost: "unix:///var/run/docker.sock",
    ...changes,
  };
}

/** The value after `flag` in argv, and every value after it when it repeats. */
function values(argv: string[], flag: string): string[] {
  return argv.flatMap((arg, index) => (arg === flag ? [argv[index + 1] ?? ""] : []));
}

test("act's command passes the fake token, its own three files, offline and hardened", () => {
  const given = spec();
  const command = actCommand(given);
  assert.equal(command.binary, "/usr/local/bin/act");
  assert.equal(command.cwd, given.workdir);
  assert.equal(command.argv[0], "issues");
  assert.deepEqual(values(command.argv, "--secret"), ["GITHUB_TOKEN=ghs_fake0123456789"]);
  assert.deepEqual(values(command.argv, "--env-file"), [given.files.env]);
  assert.deepEqual(values(command.argv, "--secret-file"), [given.files.secrets]);
  assert.deepEqual(values(command.argv, "--var-file"), [given.files.vars]);
  assert.deepEqual(values(command.argv, "--eventpath"), [given.files.event]);
  for (const flag of [
    "--rm",
    "--pull=false",
    "--no-cache-server",
    "--action-offline-mode",
    "--no-skip-checkout",
    "--json",
  ]) {
    assert.ok(command.argv.includes(flag), flag);
  }
  assert.deepEqual(values(command.argv, "--container-daemon-socket"), ["-"]);
  assert.deepEqual(values(command.argv, "--action-cache-path"), [given.actionCache]);
  assert.deepEqual(values(command.argv, "--network"), ["codeman-e2e-jobs"]);
  assert.deepEqual(values(command.argv, "--platform"), ["ubuntu-latest=codeman-e2e-runner:local"]);
  assert.deepEqual(values(command.argv, "--artifact-server-addr"), ["127.0.0.1"]);
  assert.deepEqual(values(command.argv, "--cache-server-addr"), ["127.0.0.1"]);
  // act's own artifact server never starts, and no other GitHub host is named.
  assert.ok(!command.argv.some((arg) => arg.startsWith("--artifact-server-path")));
  assert.ok(!command.argv.some((arg) => arg.startsWith("--github-instance")));
  assert.equal(
    values(command.argv, "--container-options")[0],
    "--init --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined --volume codeman-e2e-ca:/etc/codeman-e2e:ro",
  );
  assert.ok(
    values(command.argv, "--env").includes("GITHUB_SERVER_URL=https://github-e2e.localhost"),
  );
});

test("act's process inherits nothing: no token, no gh on its PATH, its own home and caches", () => {
  const saved = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
  process.env.GITHUB_TOKEN = "ghp_the_developers_own";
  process.env.GH_TOKEN = "gho_the_developers_own";
  try {
    const given = spec();
    const { env } = actCommand(given);
    assert.deepEqual(Object.keys(env).sort(), [
      "ACT_DISABLE_VERSION_CHECK",
      "DOCKER_HOST",
      "HOME",
      "PATH",
      "TMPDIR",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
    ]);
    assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
    assert.equal(env.HOME, given.state.home);
    assert.equal(env.XDG_CONFIG_HOME, given.state.configHome);
    assert.equal(env.XDG_CACHE_HOME, given.state.cacheHome);
    assert.equal(env.ACT_DISABLE_VERSION_CHECK, "1");
    assert.ok(!JSON.stringify(env).includes("the_developers_own"));
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("act does not start without the fake GitHub's token", () => {
  for (const token of ["", " ", "two words"]) {
    assert.throws(
      () => actCommand(spec({ token })),
      (error: unknown) => {
        assert.ok(error instanceof ActRefused);
        assert.match(error.message, /no GITHUB_TOKEN of the fake GitHub/);
        return true;
      },
    );
  }
});

test("act does not start without each of its env, secret, variable and event files", () => {
  for (const name of ["env", "secrets", "vars", "event"] as const) {
    const given = spec();
    rmSync(given.files[name]);
    assert.throws(
      () => actCommand(given),
      new RegExp(`its ${name} file is missing .*act would read the working directory's`),
    );
    const unnamed = spec();
    assert.throws(
      () =>
        actCommand({
          ...unnamed,
          files: { ...unnamed.files, [name]: undefined as unknown as string },
        }),
      new RegExp(`its ${name} file is missing \\(none given\\)`),
    );
  }
});

test("act's files may not be in its working directory, which it copies into each job", () => {
  const given = spec();
  const inside = join(given.workdir, ".github", "workflows", "secrets.yaml");
  writeFileSync(inside, "{}\n");
  assert.throws(
    () => actCommand({ ...given, files: { ...given.files, secrets: inside } }),
    /its secrets file is inside the working directory/,
  );
});

test("act's working directory holds .github/workflows/ only", () => {
  for (const name of [".env", ".secrets", ".vars", ".actrc", ".input", "notes.txt"]) {
    const given = spec();
    writeFileSync(join(given.workdir, name), "GITHUB_TOKEN=real\n");
    assert.throws(() => actCommand(given), /must hold .github\/workflows\/ only, but it holds/);
  }
  const extra = spec();
  mkdirSync(join(extra.workdir, ".github", "actions"));
  assert.throws(() => actCommand(extra), /\.github\/ must hold workflows\/ only/);
});

test("the jobs reach the fake GitHub's *.localhost host only, never github.com", () => {
  for (const name of ["GITHUB_SERVER_URL", "GITHUB_API_URL", "GITHUB_GRAPHQL_URL"]) {
    const given = spec();
    assert.throws(
      () => actCommand({ ...given, env: { ...given.env, [name]: "https://api.github.com" } }),
      new RegExp(`${name} must name the fake GitHub's \\*\\.localhost host`),
    );
    const missing = { ...given.env };
    delete missing[name];
    assert.throws(() => actCommand({ ...given, env: missing }), /must name the fake GitHub/);
  }
});

test("no token goes on act's command line but GITHUB_TOKEN's secret, and no job gets the Docker socket", () => {
  for (const name of ["GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "ACTIONS_RUNTIME_TOKEN"]) {
    const given = spec();
    assert.throws(
      () => actCommand({ ...given, env: { ...given.env, [name]: "x" } }),
      new RegExp(`${name} would show on act's command line`),
    );
  }
  assert.throws(
    () =>
      actCommand(spec({ containerOptions: ["-v", "/var/run/docker.sock:/var/run/docker.sock"] })),
    /no job may get the Docker socket/,
  );
});

test("the env, secret and variable files keep newlines and dollars, as act reads YAML", () => {
  const values = { KEY: "-----BEGIN KEY-----\nabc$HOME\n-----END KEY-----\n", PLAIN: 'a "b"' };
  assert.deepEqual(parse(valuesFile(values)), values);
  assert.equal(shellQuote("seccomp=unconfined"), "seccomp=unconfined");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});
