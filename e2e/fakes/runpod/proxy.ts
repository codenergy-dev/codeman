import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { FakeRequest } from "../http.ts";

/** Headers that belong to one connection, not to the request: a proxy does not forward them. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/**
 * Forwards a request to `target` (an origin plus the path, with the query added) and streams the
 * answer back as it comes, as Server-Sent Events need. A target that does not answer is a 502.
 */
export function forward(
  target: string,
  request: FakeRequest,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(target);
  const search = request.query.toString();
  if (search) url.search = search;
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
  }
  if (request.body.length > 0) headers["content-length"] = String(request.body.length);
  return new Promise((resolve) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = send(url, { method: request.method, headers }, (answer: IncomingMessage) => {
      const back: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value !== undefined && !HOP_BY_HOP.has(name)) back[name] = value;
      }
      response.writeHead(answer.statusCode ?? 502, back);
      response.flushHeaders();
      answer.pipe(response);
      answer.once("end", () => resolve());
      answer.once("error", () => {
        response.destroy();
        resolve();
      });
    });
    upstream.once("error", () => {
      if (!response.headersSent) {
        response
          .writeHead(502, { "content-type": "text/plain; charset=utf-8" })
          .end("Bad Gateway: the pod did not answer.");
      } else response.destroy();
      resolve();
    });
    // A client that leaves stops the pod's answer too, as a cancelled stream should.
    response.once("close", () => upstream.destroy());
    upstream.end(request.body);
  });
}
