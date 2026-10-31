import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rootCertificates } from "node:tls";
import { BOOTSTRAP_VARIABLES } from "./bootstrap.ts";
import { ollamaServeEnvironment } from "./pod.ts";
import {
  HOME_VARIABLE,
  ROOTS_VARIABLES,
  type RootsEnvironment,
  replacedRoots,
  rootsDirectory,
  rootsPem,
  writeRoots,
} from "./roots.ts";
import { vllmServeEnvironment } from "./vllm.ts";

/** The PEM certificates of a file, in order. */
function certificates(pem: string): string[] {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}

/**
 * The root that Node.js 24.22.1 no longer trusts, by the name its store gives it
 * (docs/web/nodejs/node-src-node-root-certs-h-at-955266b.md).
 */
const EMSIGN_G3 = "emSign ECC Root CA - G3";

/** Whether the running Node.js is 24.22.1 or later, the pods' (docs/web/nodejs/node-v24-22-1.md). */
function trustsNoEmsignG3(version = process.versions.node): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return major > 24 || (major === 24 && (minor > 22 || (minor === 22 && patch >= 1)));
}

const ROOTS: RootsEnvironment = {
  SSL_CERT_FILE: "/tmp/codeman/roots/roots.pem",
  SSL_CERT_DIR: "/tmp/codeman/roots",
  REQUESTS_CA_BUNDLE: "/tmp/codeman/roots/roots.pem",
  CURL_CA_BUNDLE: "/tmp/codeman/roots/roots.pem",
};

test("the roots file holds exactly the running Node.js's roots, alone in its directory", async () => {
  const directory = join(await mkdtemp(join(tmpdir(), "codeman-roots-")), "roots");
  try {
    // A file left by an earlier start would be trusted through SSL_CERT_DIR.
    await mkdir(directory);
    await writeFile(join(directory, "stale.pem"), rootCertificates[0] ?? "");
    const roots = await writeRoots(directory);
    const file = join(directory, "roots.pem");
    assert.deepEqual(roots, {
      SSL_CERT_FILE: file,
      SSL_CERT_DIR: directory,
      REQUESTS_CA_BUNDLE: file,
      CURL_CA_BUNDLE: file,
    });
    assert.deepEqual(Object.keys(roots), [...ROOTS_VARIABLES]);
    assert.deepEqual(await readdir(directory), ["roots.pem"]);
    const pem = await readFile(file, "utf8");
    assert.equal(pem, rootsPem(rootCertificates));
    assert.deepEqual(certificates(pem), [...rootCertificates]);
    assert.ok(rootCertificates.length > 100, "Node.js's bundled store");
    // The engine, run by the same user, reads it; nobody can change it but that user.
    assert.equal((await stat(file)).mode & 0o777, 0o644);
    for (const certificate of certificates(pem)) assert.ok(new X509Certificate(certificate));
  } finally {
    await rm(join(directory, ".."), { recursive: true, force: true });
  }
});

test("the roots file has no emSign ECC Root CA - G3 on the pods' Node.js", {
  skip: trustsNoEmsignG3()
    ? false
    : `Node.js ${process.versions.node} still trusts it; pods run 24.22.1`,
}, () => {
  const subjects = certificates(rootsPem()).map((pem) => new X509Certificate(pem).subject);
  assert.ok(subjects.some((subject) => subject.includes("CN=emSign Root CA - G1")));
  assert.ok(!subjects.some((subject) => subject.includes(`CN=${EMSIGN_G3}`)));
});

test("the roots file keeps what the running Node.js trusts, emSign G3 included or not", () => {
  const has = (roots: readonly string[]) =>
    roots.some((pem) => new X509Certificate(pem).subject.includes(`CN=${EMSIGN_G3}`));
  assert.equal(has(certificates(rootsPem())), has(rootCertificates));
  assert.equal(trustsNoEmsignG3("24.21.0"), false);
  assert.equal(trustsNoEmsignG3("24.22.0"), false);
  assert.equal(trustsNoEmsignG3("24.22.1"), true);
  assert.equal(trustsNoEmsignG3("25.0.0"), true);
});

test("the roots go in the bootstrap's working area", () => {
  assert.equal(HOME_VARIABLE, BOOTSTRAP_VARIABLES.home);
  assert.equal(rootsDirectory({}), "/tmp/codeman/roots");
  assert.equal(rootsDirectory({ CODEMAN_BOOTSTRAP_HOME: "" }), "/tmp/codeman/roots");
  assert.equal(rootsDirectory({ CODEMAN_BOOTSTRAP_HOME: "/work" }), "/work/roots");
});

test("both engines get the roots, over what the image's environment set", () => {
  const image = {
    PATH: "/bin",
    SSL_CERT_FILE: "/etc/ssl/custom.pem",
    REQUESTS_CA_BUNDLE: "/tmp/codeman/roots/roots.pem",
  };
  const ollama = ollamaServeEnvironment(image, {}, undefined, ROOTS);
  const vllm = vllmServeEnvironment(image, ROOTS);
  for (const env of [ollama, vllm]) {
    for (const name of ROOTS_VARIABLES) assert.equal(env[name], ROOTS[name], name);
    assert.equal(env.PATH, "/bin");
  }
  assert.deepEqual(replacedRoots(image, ROOTS), ["SSL_CERT_FILE=/etc/ssl/custom.pem"]);
  assert.deepEqual(replacedRoots({ PATH: "/bin" }, ROOTS), []);
});
