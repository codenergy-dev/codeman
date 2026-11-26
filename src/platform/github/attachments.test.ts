import assert from "node:assert/strict";
import { test } from "node:test";
import type { TextRef } from "../platform.ts";
import { GitHubAttachments, isGitHubHost, signedAddresses } from "./attachments.ts";

const UUID = "a33d8f86-f1b5-4362-ae4a-d1c7f3680193";
const FILE = "https://github.com/user-attachments/files/25195600/data.csv";
const ASSET = `https://github.com/user-attachments/assets/${UUID}`;
const ISSUE: TextRef = { kind: "issue", number: 7 };

interface Call {
  url: string;
  authorization: string | undefined;
}

/** A fetch that answers from a table of URL prefixes, and records what it was asked. */
function fakeFetch(routes: Record<string, () => Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get("authorization") ?? undefined });
    assert.equal(init?.redirect, "manual", "redirects are followed by hand");
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return route ? (routes[route] as () => Response)() : new Response("", { status: 404 });
  };
  return { fetch: fake as typeof fetch, calls };
}

const redirect = (location: string) => () =>
  new Response("", { status: 302, headers: { location } });
const file =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { status: 200, headers });

function attachments(
  routes: Record<string, () => Response>,
  html: (where: TextRef) => Promise<string | undefined> = async () => undefined,
) {
  const fake = fakeFetch(routes);
  const htmlCalls: TextRef[] = [];
  const subject = new GitHubAttachments({
    token: "job-token",
    fetch: fake.fetch,
    html: (where) => {
      htmlCalls.push(where);
      return html(where);
    },
  });
  return { subject, calls: fake.calls, htmlCalls };
}

const signal = () => new AbortController().signal;

test("finds GitHub's attachment links, in order, once each, and nothing else", () => {
  const { subject } = attachments({});
  const text = [
    `The data: [data.csv](${FILE}).`,
    `<img width="800" alt="Image" src="${ASSET}" />`,
    `Again: ${FILE}, and an older one https://github.com/o/r/files/123/old%20log.txt`,
    "https://github.com/o/r/assets/42/0b9a6b51-1c4a-4f58-9c8e-2c2b1a0e1d11",
    "https://user-images.githubusercontent.com/1/77-shot.png",
    "Not these: https://github.com/o/r/issues/1 https://example.com/user-attachments/files/1/x.csv",
  ].join("\n");
  assert.deepEqual(subject.find(text), [
    { url: FILE, id: "25195600", name: "data.csv" },
    { url: ASSET, id: UUID },
    { url: "https://github.com/o/r/files/123/old%20log.txt", id: "123", name: "old log.txt" },
    {
      url: "https://github.com/o/r/assets/42/0b9a6b51-1c4a-4f58-9c8e-2c2b1a0e1d11",
      id: "0b9a6b51-1c4a-4f58-9c8e-2c2b1a0e1d11",
    },
    {
      url: "https://user-images.githubusercontent.com/1/77-shot.png",
      id: "77-shot.png",
      name: "77-shot.png",
    },
  ]);
});

test("follows GitHub's redirect, with the token on github.com only, and names the file", async () => {
  const signed =
    "https://objects.githubusercontent.com/github-production-repository-file-5c1aeb/1/25195600?X-Amz-Expires=300&response-content-disposition=attachment%3Bfilename%3Ddata.csv";
  const { subject, calls, htmlCalls } = attachments({
    [FILE]: redirect(signed),
    [signed]: file("x,y\n"),
  });
  const [link] = subject.find(FILE);
  assert.ok(link);
  assert.deepEqual(await subject.download(link, ISSUE, 100, signal()), {
    ok: true,
    data: Buffer.from("x,y\n"),
    name: "data.csv",
  });
  assert.deepEqual(calls, [
    { url: FILE, authorization: "Bearer job-token" },
    { url: signed, authorization: undefined },
  ]);
  assert.deepEqual(htmlCalls, [], "the rendered HTML is read only when the link is refused");
});

test("a refused link downloads from the signed address in the text's rendered HTML", async () => {
  const signed = `https://private-user-images.githubusercontent.com/1/2-${UUID}.png?jwt=abc&amp;x=1`;
  const { subject, calls, htmlCalls } = attachments(
    {
      [ASSET]: () => new Response("", { status: 404 }),
      "https://private-user-images.githubusercontent.com/": file("PNG"),
    },
    async () =>
      `<p><a href="${ASSET}">x</a><a target="_blank" href="${signed}"><img src="${signed}"></a></p>`,
  );
  const [link] = subject.find(ASSET);
  assert.ok(link);
  const where: TextRef = { kind: "comment", id: 9 };
  assert.deepEqual(await subject.download(link, where, 100, signal()), {
    ok: true,
    data: Buffer.from("PNG"),
    name: `2-${UUID}.png`,
  });
  assert.deepEqual(htmlCalls, [where]);
  assert.deepEqual(calls[1], {
    url: `https://private-user-images.githubusercontent.com/1/2-${UUID}.png?jwt=abc&x=1`,
    authorization: undefined,
  });
});

test("a refused link without a signed address stays refused", async () => {
  const { subject } = attachments(
    { [FILE]: () => new Response("", { status: 404 }) },
    async () => `<a href="${FILE}">data.csv</a>`,
  );
  const [link] = subject.find(FILE);
  assert.ok(link);
  assert.deepEqual(await subject.download(link, ISSUE, 100, signal()), {
    ok: false,
    problem: "refused",
    detail: "HTTP 404",
  });
});

test("never leaves GitHub's hosts, and a sign-in page is a refusal", async () => {
  const away = attachments({ [FILE]: redirect("https://evil.example/steal") });
  const [link] = away.subject.find(FILE);
  assert.ok(link);
  assert.deepEqual(await away.subject.download(link, ISSUE, 100, signal()), {
    ok: false,
    problem: "refused",
    detail: "redirected to evil.example, which is not GitHub's",
  });
  assert.equal(away.calls.length, 1);

  const login = attachments({ [FILE]: redirect("/login?return_to=x") });
  assert.deepEqual(await login.subject.download(link, ISSUE, 100, signal()), {
    ok: false,
    problem: "refused",
    detail: "GitHub asked to sign in",
  });

  const plain = attachments({ [FILE]: redirect("http://objects.githubusercontent.com/x") });
  assert.equal((await plain.subject.download(link, ISSUE, 100, signal())).ok, false);
});

test("stops reading a file over the limit, declared or not", async () => {
  const [link] = attachments({}).subject.find(FILE);
  assert.ok(link);
  const declared = attachments({ [FILE]: file("12345", { "content-length": "5" }) });
  assert.deepEqual(await declared.subject.download(link, ISSUE, 4, signal()), {
    ok: false,
    problem: "too-large",
  });
  const streamed = attachments({
    [FILE]: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(3));
            controller.enqueue(new Uint8Array(3));
            controller.close();
          },
        }),
      ),
  });
  assert.deepEqual(await streamed.subject.download(link, ISSUE, 4, signal()), {
    ok: false,
    problem: "too-large",
  });
});

test("other failures are reported, not thrown", async () => {
  const [link] = attachments({}).subject.find(FILE);
  assert.ok(link);
  const server = attachments({ [FILE]: () => new Response("", { status: 500 }) });
  assert.deepEqual(await server.subject.download(link, ISSUE, 4, signal()), {
    ok: false,
    problem: "failed",
    detail: "HTTP 500",
  });
  const broken = new GitHubAttachments({
    token: "t",
    fetch: (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch,
    html: async () => undefined,
  });
  assert.deepEqual(await broken.download(link, ISSUE, 4, signal()), {
    ok: false,
    problem: "failed",
    detail: "socket hang up",
  });
});

test("GitHub's hosts, and the addresses in rendered HTML", () => {
  assert.ok(isGitHubHost("github.com"));
  assert.ok(isGitHubHost("objects.githubusercontent.com"));
  assert.ok(isGitHubHost("github-production-user-asset-6210df.s3.amazonaws.com"));
  assert.ok(!isGitHubHost("evil-s3.amazonaws.com"));
  assert.ok(!isGitHubHost("github.com.evil.example"));
  assert.deepEqual(
    signedAddresses(
      '<a href="https://example.com/x"></a><img src="https://objects.githubusercontent.com/a?b=1&amp;c=2">',
    ),
    ["https://objects.githubusercontent.com/a?b=1&c=2"],
  );
});
