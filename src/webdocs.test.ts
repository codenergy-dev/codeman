import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { frontMatter, GENERIC_TOOL, oldPages, webFileProblem, webPages } from "./webdocs.ts";

const page = (fields: Record<string, string>, body = "# Page\n") =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n\n${body}`;

const valid = {
  title: "List API keys",
  url: "https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys",
  created_at: "2026-10-02T21:52:00-03:00",
  updated_at: "2026-10-02T21:52:00-03:00",
  tool: "docs/web/tools/openrouter.md",
};
const tools = new Set(["docs/web/tools/openrouter.md"]);
const exists = (path: string) => tools.has(path);
const PATH = "docs/web/openrouter/list-api-keys.md";

test("reads front matter fields, quoted or not", () => {
  const fields = frontMatter('---\ntitle: "Config: JSON"\nurl: https://x.test\n---\nBody');
  assert.equal(fields?.get("title"), "Config: JSON");
  assert.equal(fields?.get("url"), "https://x.test");
  assert.equal(frontMatter("# No front matter"), undefined);
  assert.equal(frontMatter("---\nnot a field\n---\n"), undefined);
});

test("a page with every field, named after its title, is valid", () => {
  assert.equal(webFileProblem(PATH, page(valid), exists), undefined);
  assert.equal(webFileProblem(PATH, page({ ...valid, license: "MIT" }), exists), undefined);
  const tool = page({
    title: "OpenRouter",
    url: "https://openrouter.ai/docs",
    created_at: valid.created_at,
    updated_at: valid.updated_at,
  });
  assert.equal(webFileProblem("docs/web/tools/openrouter.md", tool, exists), undefined);
  const generic = page({
    title: "Fetch Markdown",
    created_at: valid.created_at,
    updated_at: valid.updated_at,
  });
  assert.equal(
    webFileProblem("docs/web/tools/fetch-markdown.md", generic, exists),
    undefined,
    "a generic tool has no url",
  );
});

test("a page that breaks the format says why", () => {
  const cases: [string, string, RegExp][] = [
    ["docs/web/list-api-keys.md", page(valid), /pages go in docs\/web\/<third-party>\/<slug>\.md/],
    ["docs/web/openrouter/keys/list.md", page(valid), /pages go in/],
    [PATH, "# No front matter", /no front matter/],
    [PATH, page({ ...valid, author: "x" }), /unknown front matter fields: author/],
    [PATH, page({ ...valid, title: "" }), /title is missing/],
    ["docs/web/openrouter/keys.md", page(valid), /file name must be list-api-keys\.md/],
    [PATH, page({ ...valid, url: "javascript:alert(1)" }), /url must be an http or https URL/],
    [PATH, page({ ...valid, created_at: "2026-10-02" }), /ISO 8601 timestamps with seconds/],
    [
      PATH,
      page({ ...valid, updated_at: "2026-10-01T00:00:00Z" }),
      /updated_at is before created_at/,
    ],
    [PATH, page({ ...valid, tool: "docs/web/tools/missing.md" }), /tool must name a file/],
    [PATH, page({ ...valid, license: "" }), /license must not be empty/],
  ];
  for (const [path, text, problem] of cases) {
    assert.match(webFileProblem(path, text, exists) ?? "", problem, path);
  }
  const tool = page({ ...valid, title: "OpenRouter" });
  assert.match(
    webFileProblem("docs/web/tools/openrouter.md", tool, exists) ?? "",
    /unknown front matter fields: tool/,
    "a tool names no tool",
  );
});

test("Codeman's own catalog follows the format", () => {
  const root = new URL("../docs/web/", import.meta.url).pathname;
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".md"),
  );
  assert.ok(files.length > 10);
  const present = (path: string) => existsSync(join(root, "..", "..", path));
  for (const file of files) {
    const path = `docs/web/${file}`;
    assert.equal(
      webFileProblem(path, readFileSync(join(root, file), "utf8"), present),
      undefined,
      path,
    );
  }
  assert.ok(readFileSync(GENERIC_TOOL, "utf8").startsWith("---\ntitle: Fetch Markdown\n"));
});

test("lists pages fetched over 30 days ago, oldest first, and those without a date", () => {
  const now = new Date("2026-12-01T00:00:00Z");
  const old = oldPages(
    {
      "docs/web/a/fresh.md": { sha: "1", updatedAt: "2026-11-20T00:00:00Z" },
      "docs/web/a/old.md": { sha: "2", updatedAt: "2026-10-01T00:00:00Z" },
      "docs/web/b/older.md": { sha: "3", updatedAt: "2026-09-01T00:00:00Z" },
      "docs/web/b/broken.md": { sha: "4" },
    },
    now,
  );
  assert.deepEqual(old, [
    { path: "docs/web/b/older.md", days: 91 },
    { path: "docs/web/a/old.md", days: 61 },
    { path: "docs/web/b/broken.md" },
  ]);
  assert.deepEqual(oldPages(undefined, now), []);
});

test("reads only the pages whose blob changed, and leaves tools out", async () => {
  const reads: string[] = [];
  const files = new Map([
    ["docs/web/a/kept.md", { sha: "same", mode: "100644" as const }],
    ["docs/web/a/new.md", { sha: "new", mode: "100644" as const }],
    ["docs/web/a/broken.md", { sha: "broken", mode: "100644" as const }],
    ["docs/web/tools/fetch-markdown.md", { sha: "tool", mode: "100644" as const }],
    ["docs/web/a/notes.txt", { sha: "txt", mode: "100644" as const }],
  ]);
  const repo = {
    filesUnder: async () => files,
    readFile: async (_ref: string, path: string) => {
      reads.push(path);
      return path.endsWith("new.md") ? page(valid) : "no front matter";
    },
  };
  const pages = await webPages(repo, "main", {
    "docs/web/a/kept.md": { sha: "same", updatedAt: "2026-01-01T00:00:00Z" },
  });
  assert.deepEqual(reads.sort(), ["docs/web/a/broken.md", "docs/web/a/new.md"]);
  assert.deepEqual(pages, {
    "docs/web/a/kept.md": { sha: "same", updatedAt: "2026-01-01T00:00:00Z" },
    "docs/web/a/new.md": { sha: "new", updatedAt: valid.updated_at },
    "docs/web/a/broken.md": { sha: "broken", updatedAt: undefined },
  });
});
