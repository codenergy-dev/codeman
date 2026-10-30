import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createHttp, type Server } from "node:http";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, before, test } from "node:test";
import {
  BOOTSTRAP_VARIABLES,
  bootstrapCommand,
  bootstrapEnvironment,
  commandProblems,
  podBootstrap,
  SALAD_COMMAND_LIMITS,
} from "./bootstrap.ts";

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const NODE_NAME = "node-v24.0.0-linux-x64";

/** The executable `name` on the test's own PATH, or undefined. */
function tool(name: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    try {
      accessSync(join(directory, name), constants.X_OK);
      return join(directory, name);
    } catch {
      // Not there.
    }
  }
  return undefined;
}

/** What each run of the command shares: files served, a TLS certificate, a scratch directory. */
interface Fixture {
  root: string;
  files: Map<string, Buffer>;
  requests: string[];
  http: string;
  https: string | undefined;
  certificate: string | undefined;
  node: Buffer;
  gateway: Buffer;
}

let fixture: Fixture;
const servers: Server[] = [];

/**
 * A Node.js tarball whose `bin/node` runs the test's own Node.js, or, tampered, one that leaves a
 * mark; a gateway that prints its process, and a tampered one that leaves a mark.
 */
before(async () => {
  const root = await mkdtemp(join(tmpdir(), "codeman-bootstrap-"));
  const tarball = async (name: string, node: string) => {
    const directory = join(root, "build", name);
    await mkdir(join(directory, NODE_NAME, "bin"), { recursive: true });
    await writeFile(join(directory, NODE_NAME, "bin", "node"), node);
    await chmod(join(directory, NODE_NAME, "bin", "node"), 0o755);
    await writeFile(join(directory, NODE_NAME, "README.md"), "Not extracted.\n");
    execFileSync("tar", ["-czf", join(root, `${name}.tar.gz`), "-C", directory, NODE_NAME], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    return readFileSync(join(root, `${name}.tar.gz`));
  };
  const node = await tarball("genuine", `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  const tamperedNode = await tarball("tampered", '#!/bin/sh\necho TAMPERED >"$MARK"\n');
  const gateway = Buffer.from(
    [
      'process.on("SIGTERM", () => { console.log("gateway got SIGTERM"); process.exit(0); });',
      "console.log(JSON.stringify({ gateway: true, pid: process.pid, argv: process.argv.slice(1), url: process.env.CODEMAN_BOOTSTRAP_GATEWAY_URL }));",
      'if (process.env.WAIT) setInterval(() => {}, 1000); else process.exit(Number(process.env.EXIT ?? "0"));',
    ].join("\n"),
  );
  const files = new Map<string, Buffer>([
    [`/${NODE_NAME}.tar.gz`, node],
    [`/tampered/${NODE_NAME}.tar.gz`, tamperedNode],
    ["/gateway.js", gateway],
    [
      "/tampered/gateway.js",
      Buffer.from('require("node:fs").writeFileSync(process.env.MARK, "TAMPERED");'),
    ],
  ]);
  const requests: string[] = [];
  const handler = (
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ) => {
    const path = request.url ?? "/";
    requests.push(path);
    // A release host's download, which redirects to the file.
    if (path.startsWith("/redirect/")) {
      response.writeHead(302, { location: path.slice("/redirect".length) }).end();
      return;
    }
    const body = files.get(path);
    if (!body) response.writeHead(404).end();
    else response.writeHead(200, { "content-length": body.length }).end(body);
  };
  const listen = async (server: Server) => {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  };
  const http = `http://127.0.0.1:${await listen(createHttp(handler))}`;
  // openssl_get speaks HTTPS only: a certificate for localhost, which openssl trusts through
  // SSL_CERT_FILE.
  let https: string | undefined;
  let certificate: string | undefined;
  if (tool("openssl")) {
    certificate = join(root, "cert.pem");
    const key = join(root, "key.pem");
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certificate].concat(
        ["-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
      ),
      { stdio: "ignore" },
    );
    const server = createHttps(
      { key: readFileSync(key), cert: readFileSync(certificate) },
      handler,
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
    https = `https://localhost:${(server.address() as AddressInfo).port}`;
  }
  fixture = { root, files, requests, http, https, certificate, node, gateway };
});

after(async () => {
  for (const server of servers) server.close();
  await rm(fixture.root, { recursive: true, force: true });
});

let runs = 0;

/** A PATH holding only these tools, besides those every image has. */
async function shim(tools: readonly string[]): Promise<string> {
  const directory = join(fixture.root, `path-${++runs}`);
  await mkdir(directory);
  for (const name of ["tar", "gzip", "rm", "mkdir", "mv", "cut", "tail", ...tools]) {
    const found = tool(name);
    assert.ok(found, `${name} is on the test's PATH`);
    await symlink(found, join(directory, name));
  }
  return directory;
}

interface Run {
  code: number | null;
  output: string;
  pid: number | undefined;
  home: string;
  mark: string;
}

/** Runs the real command with `sh`, as a provider would, with a PATH of only these tools. */
async function run(
  tools: readonly string[],
  options: {
    node?: { url: string; sha256: string };
    gateway?: { url: string; sha256: string };
    env?: Record<string, string>;
    onOutput?: (output: string, child: ChildProcess) => void;
  } = {},
): Promise<Run> {
  const home = join(fixture.root, `home-${++runs}`);
  const mark = join(fixture.root, `mark-${runs}`);
  const { command, env } = podBootstrap({
    node: options.node ?? {
      url: `${fixture.http}/${NODE_NAME}.tar.gz`,
      sha256: sha256(fixture.node),
    },
    gateway: options.gateway ?? {
      url: `${fixture.http}/gateway.js`,
      sha256: sha256(fixture.gateway),
    },
  });
  const child = spawn(command[0] as string, command.slice(1), {
    env: {
      ...env,
      PATH: await shim(tools),
      [BOOTSTRAP_VARIABLES.home]: home,
      MARK: mark,
      ...(fixture.certificate ? { SSL_CERT_FILE: fixture.certificate } : {}),
      ...options.env,
    },
  });
  let output = "";
  const read = (chunk: Buffer) => {
    output += chunk.toString();
    options.onOutput?.(output, child);
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  return { code, output, pid: child.pid, home, mark };
}

/** The line the test gateway prints, or undefined when it did not run. */
function gatewayLine(output: string): { pid: number; argv: string[]; url: string } | undefined {
  const line = output.split("\n").find((one) => one.startsWith('{"gateway":true'));
  return line ? JSON.parse(line) : undefined;
}

test("the command fits Salad's limits, and Runpod's form is the same command", () => {
  const command = bootstrapCommand();
  assert.ok(command.length <= SALAD_COMMAND_LIMITS.items, `${command.length} items`);
  for (const item of command) {
    assert.ok(item.length >= 1 && item.length <= SALAD_COMMAND_LIMITS.itemCharacters, item);
    assert.ok(!/[\r\n]/.test(item), item);
  }
  assert.deepEqual(commandProblems(command), []);
  const bootstrap = podBootstrap({
    node: { url: `https://nodejs.org/dist/v24.0.0/${NODE_NAME}.tar.gz`, sha256: "A".repeat(64) },
    gateway: { url: "https://example.com/gateway.js", sha256: "b".repeat(64) },
  });
  assert.deepEqual([...bootstrap.entrypoint, ...bootstrap.cmd], command);
  assert.deepEqual(bootstrap.command, command);
  assert.deepEqual(bootstrap.entrypoint, ["/bin/sh"]);
  assert.equal(bootstrap.env.CODEMAN_BOOTSTRAP_NODE_SHA256, "a".repeat(64), "lowercased");
  assert.equal(bootstrap.env.CODEMAN_BOOTSTRAP_GATEWAY_URL, "https://example.com/gateway.js");
  assert.ok(!command.join("\n").includes("example.com"), "the command is the same for every pod");
});

test("a command beyond Salad's limits is refused, naming each problem", () => {
  assert.deepEqual(commandProblems(Array.from({ length: 101 }, () => "x")), [
    "101 items, above Salad's 100",
  ]);
  assert.deepEqual(commandProblems(["sh", "", "x".repeat(1001), "a\nb"]), [
    "item 1 is empty",
    "item 2 has 1001 characters, above Salad's 1000",
    "item 3 spans several lines",
  ]);
  const large = commandProblems(Array.from({ length: 50 }, () => "x".repeat(3000)));
  assert.match(large.at(-1) ?? "", /^\d+ bytes, above Runpod's request of 102400$/);
});

test("an artifact that is not usable is refused before any pod", () => {
  const node = {
    url: `https://nodejs.org/dist/v24.0.0/${NODE_NAME}.tar.gz`,
    sha256: "a".repeat(64),
  };
  const gateway = { url: "https://example.com/gateway.js", sha256: "b".repeat(64) };
  assert.throws(
    () => bootstrapEnvironment({ node, gateway: { ...gateway, sha256: "b".repeat(63) } }),
    /The gateway's SHA-256 must be 64 hex digits/,
  );
  assert.throws(
    () => bootstrapEnvironment({ node: { ...node, url: "ftp://nodejs.org/x.tar.gz" }, gateway }),
    /Node.js's URL must be HTTP or HTTPS/,
  );
  assert.throws(
    () => bootstrapEnvironment({ node, gateway: { ...gateway, url: "https://example.com/a b" } }),
    /must be HTTP or HTTPS, without spaces/,
  );
  assert.throws(
    () =>
      bootstrapEnvironment({
        node: { ...node, url: "https://nodejs.org/dist/v24.0.0/node-v24.0.0-linux-arm64.tar.gz" },
        gateway,
      }),
    /must name a linux-x64 \.tar\.gz/,
  );
});

test("with curl, it downloads, checks with sha256sum, and the gateway replaces it as the process", async (t) => {
  if (!tool("curl") || !tool("sha256sum")) return t.skip("no curl or sha256sum");
  const result = await run(["curl", "sha256sum", "wget", "python3", "openssl"].filter(tool), {
    gateway: { url: `${fixture.http}/redirect/gateway.js`, sha256: sha256(fixture.gateway) },
  });
  assert.equal(result.code, 0, result.output);
  assert.match(
    result.output,
    /\[bootstrap\] Downloading http:\/\/127\.0\.0\.1:\d+\/node-v24\.0\.0-linux-x64\.tar\.gz with curl\./,
  );
  assert.match(result.output, /Checked .* with sha256sum\./);
  const gateway = gatewayLine(result.output);
  assert.ok(gateway, result.output);
  assert.equal(gateway.pid, result.pid, "the gateway is the command's own process");
  assert.deepEqual(gateway.argv, [join(result.home, "gateway.mjs")]);
  assert.equal(gateway.url, `${fixture.http}/redirect/gateway.js`, "redirects are followed");
  assert.ok(
    !existsSync(join(result.home, "node.tar.gz")) && !existsSync(join(result.home, "unpack")),
  );
});

test("without curl, it downloads with wget", async (t) => {
  if (!tool("wget") || !tool("sha256sum")) return t.skip("no wget");
  const result = await run(["wget", "sha256sum", "python3", "openssl"].filter(tool));
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /with wget\./);
  assert.ok(gatewayLine(result.output));
});

test("without curl or wget, python3 downloads and checks", async (t) => {
  if (!tool("python3")) return t.skip("no python3");
  const result = await run(["python3"]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /with python3\.\n[\s\S]*Checked .* with python3\./);
  assert.ok(gatewayLine(result.output));
});

test("with only openssl, it downloads over HTTPS without redirects, and checks with openssl", async (t) => {
  if (!fixture.https) return t.skip("no openssl");
  const result = await run(["openssl"], {
    node: { url: `${fixture.https}/${NODE_NAME}.tar.gz`, sha256: sha256(fixture.node) },
  });
  assert.equal(result.code, 0, result.output);
  assert.match(
    result.output,
    /Downloading https:\/\/localhost:\d+\/node-v24\.0\.0-linux-x64\.tar\.gz with openssl\./,
  );
  assert.match(result.output, /Checked .* with openssl\./);
  assert.ok(gatewayLine(result.output));
  const redirected = await run(["openssl"], {
    node: { url: `${fixture.https}/redirect/${NODE_NAME}.tar.gz`, sha256: sha256(fixture.node) },
  });
  assert.equal(redirected.code, 1);
  assert.match(redirected.output, /answered 'HTTP\/1\.1 302 Found/);
  assert.match(redirected.output, /Could not download https:\/\/localhost:\d+\/redirect\//);
  const plain = await run(["openssl"]);
  assert.equal(plain.code, 1);
  assert.match(
    plain.output,
    /Only openssl to download http:\/\/127\.0\.0\.1:\d+\/node-v24\.0\.0-linux-x64\.tar\.gz, which is not HTTPS\./,
  );
});

test("without a downloader, or a way to check, it stops before anything runs", async (t) => {
  const none = await run([]);
  assert.equal(none.code, 1);
  assert.match(none.output, /No curl, wget, python3 or openssl to download/);
  if (!tool("curl")) return t.skip("no curl");
  const unchecked = await run(["curl"]);
  assert.equal(unchecked.code, 1);
  assert.match(unchecked.output, /No sha256sum, openssl or python3 to check/);
  assert.equal(gatewayLine(unchecked.output), undefined);
});

test("a tampered Node.js tarball is refused: nothing in it runs, and the gateway is never fetched", async (t) => {
  if (!tool("curl") || !tool("sha256sum")) return t.skip("no curl or sha256sum");
  const before = fixture.requests.length;
  const result = await run(["curl", "sha256sum"], {
    node: { url: `${fixture.http}/tampered/${NODE_NAME}.tar.gz`, sha256: sha256(fixture.node) },
  });
  assert.equal(result.code, 1);
  assert.match(
    result.output,
    /\[bootstrap\] Refused http:\/\/127\.0\.0\.1:\d+\/tampered\/node-v24\.0\.0-linux-x64\.tar\.gz: its SHA-256 is '[0-9a-f]{64}', not [0-9a-f]{64}\./,
  );
  assert.ok(!existsSync(result.mark), "the tampered node never ran");
  assert.ok(
    !existsSync(join(result.home, "node")) && !existsSync(join(result.home, "node.tar.gz")),
  );
  assert.ok(!fixture.requests.slice(before).some((path) => path.includes("gateway")));
});

test("a tampered gateway is refused, never written nor run; a missing one stops too", async (t) => {
  if (!tool("curl") || !tool("sha256sum")) return t.skip("no curl or sha256sum");
  const result = await run(["curl", "sha256sum"], {
    gateway: { url: `${fixture.http}/tampered/gateway.js`, sha256: sha256(fixture.gateway) },
  });
  assert.equal(result.code, 1);
  assert.match(
    result.output,
    /\[bootstrap\] Refused http:\/\/127\.0\.0\.1:\d+\/tampered\/gateway\.js: its SHA-256 is [0-9a-f]{64}, not [0-9a-f]{64}\./,
  );
  assert.ok(!existsSync(result.mark), "the tampered gateway never ran");
  assert.ok(!existsSync(join(result.home, "gateway.mjs")));
  assert.ok(!result.output.includes("Starting the gateway"));
  const missing = await run(["curl", "sha256sum"], {
    gateway: { url: `${fixture.http}/missing.js`, sha256: sha256(fixture.gateway) },
  });
  assert.equal(missing.code, 1);
  assert.match(
    missing.output,
    /Could not download http:\/\/127\.0\.0\.1:\d+\/missing\.js: it answered 404\./,
  );
});

test("without process.execve, the gateway runs as a child that gets the pod's signals", async (t) => {
  if (!tool("curl") || !tool("sha256sum")) return t.skip("no curl or sha256sum");
  const preload = join(fixture.root, "no-execve.cjs");
  await writeFile(preload, "delete process.execve;\n");
  let signaled = false;
  const result = await run(["curl", "sha256sum"], {
    env: { NODE_OPTIONS: `--require ${preload}`, WAIT: "1" },
    onOutput: (output, child) => {
      if (!signaled && gatewayLine(output)) {
        signaled = true;
        child.kill("SIGTERM");
      }
    },
  });
  assert.equal(result.code, 0, result.output);
  const gateway = gatewayLine(result.output);
  assert.ok(gateway && gateway.pid !== result.pid, "a child of the command");
  assert.match(result.output, /gateway got SIGTERM/);
});

test("the gateway's exit code is the command's", async (t) => {
  if (!tool("curl") || !tool("sha256sum")) return t.skip("no curl or sha256sum");
  const result = await run(["curl", "sha256sum"], { env: { EXIT: "3" } });
  assert.equal(result.code, 3, result.output);
});
