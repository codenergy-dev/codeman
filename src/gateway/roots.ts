import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rootCertificates } from "node:tls";

/**
 * The engine trusts the roots of the gateway's own Node.js, not its image's: vLLM 0.32.0's image
 * holds `certifi` and a system store that still trust the compromised `emSign ECC Root CA - G3`,
 * which Node.js 24.22.1 removed (decision 10 of the plan to start pods from official engine
 * images). Each TLS client of the engines reads one of these variables
 * (docs/development/dependencies.md#the-engines-trusted-roots):
 *
 * - `SSL_CERT_FILE` and `SSL_CERT_DIR`: Go's `crypto/x509` (Ollama), OpenSSL's defaults (Python's
 *   `ssl`), `httpx2` (`huggingface_hub`) and `rustls-native-certs` (`hf_xet`). Go and OpenSSL
 *   read both a default file and a default directory, `/etc/ssl/certs`, so both are replaced.
 * - `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE`: `requests`, which ignores the others for
 *   `certifi`, and the curl tool.
 */
export const ROOTS_VARIABLES = [
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
] as const;

/** The variables that point an engine at the roots, in a file alone in its directory. */
export type RootsEnvironment = Record<(typeof ROOTS_VARIABLES)[number], string>;

/** The roots as one PEM file: each certificate, in order, on its own lines. */
export function rootsPem(roots: readonly string[] = rootCertificates): string {
  return roots.map((root) => `${root}\n`).join("");
}

/**
 * The bootstrap's working area, as bootstrap.ts's `BOOTSTRAP_VARIABLES.home` names it; not
 * imported, which would bundle the bootstrap's script into the gateway. A test compares them.
 */
export const HOME_VARIABLE = "CODEMAN_BOOTSTRAP_HOME";

/**
 * The directory of the roots, in the gateway's working area: the bootstrap's, whose files the
 * engine, run by the same user, can read.
 */
export function rootsDirectory(env: Readonly<Record<string, string | undefined>>): string {
  return join(env[HOME_VARIABLE] || "/tmp/codeman", "roots");
}

/**
 * Writes the roots to `roots.pem`, alone in `directory`, which is emptied first so that `SSL_CERT_DIR`
 * names nothing else, and returns the variables that point at it.
 */
export async function writeRoots(
  directory: string,
  roots: readonly string[] = rootCertificates,
): Promise<RootsEnvironment> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const file = join(directory, "roots.pem");
  await writeFile(file, rootsPem(roots), { mode: 0o644 });
  return {
    SSL_CERT_FILE: file,
    SSL_CERT_DIR: directory,
    REQUESTS_CA_BUNDLE: file,
    CURL_CA_BUNDLE: file,
  };
}

/** The variables of the pod's environment that the roots replace, as `NAME=value`. */
export function replacedRoots(
  base: Readonly<Record<string, string | undefined>>,
  roots: RootsEnvironment,
): string[] {
  return ROOTS_VARIABLES.filter((name) => base[name] && base[name] !== roots[name]).map(
    (name) => `${name}=${base[name]}`,
  );
}
