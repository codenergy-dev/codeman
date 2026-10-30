/**
 * Serves a directory over HTTP, read-only, as a release's download host stands in for it: GET
 * and HEAD of its files, nothing else. Logs each request with its status and duration.
 *
 * Usage: node experiments/multi-service-pods/bootstrap/serve.ts <directory> [port]
 *   port  8765 by default. Listens on every interface, so containers reach it at
 *         host.docker.internal.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";

const [directory, portText = "8765"] = process.argv.slice(2);
if (!directory) {
  console.error("Usage: node serve.ts <directory> [port]");
  process.exit(2);
}
const root = resolve(directory);

createServer(async (request, response) => {
  const started = Date.now();
  const done = (status: number) =>
    console.log(`${request.method} ${request.url} ${status} ${Date.now() - started} ms`);
  // Only the directory's own files, by their bare name: no paths, no traversal.
  const name = basename(decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/"));
  if ((request.method !== "GET" && request.method !== "HEAD") || name.startsWith(".")) {
    response.writeHead(404).end();
    return done(404);
  }
  const file = join(root, name);
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) {
    response.writeHead(404).end();
    return done(404);
  }
  response.writeHead(200, {
    "content-length": info.size,
    "content-type": "application/octet-stream",
  });
  if (request.method === "HEAD") {
    response.end();
    return done(200);
  }
  createReadStream(file)
    .pipe(response)
    .on("finish", () => done(200));
}).listen(Number(portText), "0.0.0.0", () => {
  console.log(`Serving ${root} on port ${portText}.`);
});
