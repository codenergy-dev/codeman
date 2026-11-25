/**
 * Ollama's port for the gateway, in front of the real Ollama one port up (see `ollama` here):
 * passes every request unchanged, except `GET /api/ps`, whose models it reports wholly on the GPU
 * (`size_vram` equal to `size`). For the experiment only: a CPU stands in for a GPU.
 *
 * Usage: node vram.ts (the `ollama` wrapper starts it).
 */
import { createServer, request as forward } from "node:http";

createServer((request, response) => {
  const upstream = forward(
    {
      host: "127.0.0.1",
      port: 11435,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (answer) => {
      if (request.url !== "/api/ps" || answer.statusCode !== 200) {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
        return;
      }
      const chunks: Buffer[] = [];
      answer.on("data", (chunk: Buffer) => chunks.push(chunk));
      answer.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          models?: { size?: number; size_vram?: number }[];
        };
        for (const model of body.models ?? []) model.size_vram = model.size;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      });
    },
  );
  upstream.on("error", () => response.writeHead(502).end());
  request.pipe(upstream);
})
  .on("error", () => process.exit(0))
  .listen(11434, "127.0.0.1");
