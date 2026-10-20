import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A test certificate authority per session, and a server certificate it signs, for the fakes'
 * HTTPS. Node can make keys but not X.509 certificates, so this runs the `openssl` command: ECDSA
 * P-256 keys, valid for a week. Git, `gh` and Node then trust the CA by `GIT_SSL_CAINFO`, the
 * system store, or `NODE_EXTRA_CA_CERTS`.
 */

export interface Certificates {
  /** The CA's certificate, PEM: what clients trust. */
  ca: string;
  /** The server's key and certificate, PEM, as `listen({ tls })` takes them. */
  key: string;
  cert: string;
}

/** Whether the `openssl` command runs here. */
export function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * A CA and a certificate for `hosts`: names, such as `github-e2e.localhost`, and IP addresses,
 * such as `127.0.0.1`.
 */
export function makeCertificates(hosts: readonly string[]): Certificates {
  if (hosts.length === 0) throw new Error("A certificate needs at least one host.");
  const dir = mkdtempSync(join(tmpdir(), "codeman-e2e-tls-"));
  const file = (name: string) => join(dir, name);
  const openssl = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  try {
    const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
    openssl([
      "req",
      "-x509",
      ...ec,
      "-keyout",
      file("ca.key"),
      "-out",
      file("ca.crt"),
      "-days",
      "7",
      "-subj",
      "/CN=Codeman e2e test CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ]);
    openssl([
      "req",
      "-new",
      ...ec,
      "-keyout",
      file("server.key"),
      "-out",
      file("server.csr"),
      "-subj",
      `/CN=${hosts[0]}`,
    ]);
    const names = hosts.map((host) => (/^[\d.]+$|:/.test(host) ? `IP:${host}` : `DNS:${host}`));
    writeFileSync(
      file("server.ext"),
      `basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${names.join(",")}\n`,
    );
    openssl([
      "x509",
      "-req",
      "-in",
      file("server.csr"),
      "-CA",
      file("ca.crt"),
      "-CAkey",
      file("ca.key"),
      "-set_serial",
      `0x${randomBytes(16).toString("hex")}`,
      "-days",
      "7",
      "-extfile",
      file("server.ext"),
      "-out",
      file("server.crt"),
    ]);
    return {
      ca: readFileSync(file("ca.crt"), "utf8"),
      key: readFileSync(file("server.key"), "utf8"),
      cert: readFileSync(file("server.crt"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
