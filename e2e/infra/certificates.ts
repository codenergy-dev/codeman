import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeCertificates } from "../fakes/github/tls.ts";

/**
 * Makes the e2e session's test CA and the fake GitHub's certificate, once, for the Compose file's
 * `certificates` service: `node e2e/infra/certificates.ts <ca dir> <tls dir> <host> ...`.
 *
 * - `<ca dir>/ca.crt` is the CA's certificate, the only file jobs and pods mount.
 * - `<tls dir>/server.key` and `server.crt` are the fake GitHub's key and certificate.
 *
 * Files already there are kept while the certificate is the CA's, matches its key, names every
 * host and both stay valid for another day; otherwise both are made again (tls.ts: a week).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const [caDir, tlsDir, ...hosts] = process.argv.slice(2);
if (!caDir || !tlsDir || hosts.length === 0) {
  throw new Error("Usage: node e2e/infra/certificates.ts <ca dir> <tls dir> <host> ...");
}
const files = {
  ca: join(caDir, "ca.crt"),
  key: join(tlsDir, "server.key"),
  cert: join(tlsDir, "server.crt"),
};

if (current()) {
  console.log(`Keeping the test CA in ${files.ca}: valid, and its certificate names ${hosts}.`);
} else {
  const made = makeCertificates(hosts);
  write(files.key, made.key, 0o600);
  write(files.cert, made.cert, 0o644);
  write(files.ca, made.ca, 0o644);
  console.log(`Made a test CA in ${files.ca}, and a certificate for ${hosts} in ${tlsDir}.`);
}

function current(): boolean {
  try {
    const ca = new X509Certificate(readFileSync(files.ca));
    const cert = new X509Certificate(readFileSync(files.cert));
    const key = createPrivateKey(readFileSync(files.key));
    const until = Date.now() + DAY_MS;
    return (
      cert.verify(ca.publicKey) &&
      cert.checkPrivateKey(key) &&
      ca.validToDate.getTime() > until &&
      cert.validToDate.getTime() > until &&
      hosts.every(
        (host) =>
          (/^[\d.]+$|:/.test(host) ? cert.checkIP(host) : cert.checkHost(host)) !== undefined,
      )
    );
  } catch {
    return false;
  }
}

/** Writes through a temporary file, so a reader never sees half a PEM. */
function write(path: string, content: string, mode: number): void {
  const partial = `${path}.partial`;
  writeFileSync(partial, content, { mode });
  renameSync(partial, path);
}
