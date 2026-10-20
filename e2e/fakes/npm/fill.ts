import { fill, packagesFor } from "./npm.ts";

/**
 * Fills the npm fake's cache from the real registry, once:
 * `node e2e/fakes/npm/fill.ts <dir> [platform ...]`. The platforms are OpenCode's pinned ones,
 * such as `linux-x64`; by default the one Codeman picks on Linux on this machine's architecture,
 * as a container here runs. Each tarball must match its pinned integrity before it is stored.
 */

const [dir, ...platforms] = process.argv.slice(2);
if (!dir) throw new Error("Usage: node e2e/fakes/npm/fill.ts <dir> [platform ...]");
const packages = packagesFor(platforms.length ? platforms : [`linux-${process.arch}`]);
const downloaded = await fill(dir, packages);
const names = packages.map((pkg) => pkg.name).join(", ");
console.log(
  downloaded.length
    ? `Downloaded ${downloaded.join(", ")} into ${dir}.`
    : `${dir} already holds ${names}.`,
);
