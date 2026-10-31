import { NODE_RELEASE } from "../../../src/inference/images.ts";
import { fill } from "./nodejs.ts";

/**
 * Fills the nodejs fake's cache from nodejs.org, once: `node e2e/fakes/nodejs/fill.ts <dir>`. The
 * file is `NODE_RELEASE`'s tarball (src/inference/images.ts), which must match its pinned SHA-256
 * before it is stored.
 */

const [dir] = process.argv.slice(2);
if (!dir) throw new Error("Usage: node e2e/fakes/nodejs/fill.ts <dir>");
const downloaded = await fill(dir);
console.log(
  downloaded
    ? `Downloaded ${NODE_RELEASE.url} into ${dir}.`
    : `${dir} already holds ${NODE_RELEASE.url}.`,
);
