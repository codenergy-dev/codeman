import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { test } from "node:test";
import { frontMatter } from "./webdocs.ts";

/**
 * A link checker for the repository's own references: relative Markdown links in `README.md`,
 * `AGENTS.md` and `docs/`, and `docs/<path>.md#<anchor>` named in the code, the templates, the
 * pod image and `action.yml`, including the templates' URLs on GitHub. Each must name a file
 * that exists, and its anchor a heading of that file, by GitHub's rules.
 */

/** Reads a file of the tree; undefined when it is not in the tree. */
type Read = (path: string) => string | undefined;

interface Tree {
  paths: ReadonlySet<string>;
  read: Read;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FENCE = /^\s*(```|~~~)/;
const CODE_SPAN = /(`+)[\s\S]*?\1/g;
const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'))?`;
const INLINE_LINK = new RegExp(String.raw`!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?${TITLE}\s*\)`, "g");
const DEFINITION = new RegExp(String.raw`^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?${TITLE}\s*$`);
const CODE_REFERENCE = /(?<![\w./-])docs\/[\w./-]+?\.md(?:#[\w-]+)?/g;
const GITHUB_URL =
  /https:\/\/github\.com\/codenergy-dev\/codeman\/blob\/main\/([\w./-]+(?:#[\w-]+)?)/g;
const CODE_DIRS = ["src/", "templates/", "docker/"];
const CODE_FILES = ["action.yml"];

/** The lines of a Markdown file outside fenced code blocks, with their numbers. */
function proseLines(markdown: string): { line: number; text: string }[] {
  const lines: { line: number; text: string }[] = [];
  let fenced = false;
  markdown.split(/\r?\n/).forEach((text, index) => {
    if (FENCE.test(text)) fenced = !fenced;
    else if (!fenced) lines.push({ line: index + 1, text });
  });
  return lines;
}

/** GitHub's anchor for a heading: lowercase, punctuation removed, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** The anchors of a Markdown file's headings, with `-1`, `-2` for repeats, and its HTML ids. */
function anchors(markdown: string): Set<string> {
  const found = new Set<string>();
  const seen = new Map<string, number>();
  for (const { text } of proseLines(markdown)) {
    const heading = /^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(text);
    if (heading) {
      const base = slug(heading[1] ?? "");
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      found.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const id of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) found.add(id[1] ?? "");
  }
  return found;
}

/** The targets of a Markdown file's links, outside code blocks and code spans. */
function links(markdown: string): { line: number; target: string }[] {
  return proseLines(markdown).flatMap(({ line, text }) => {
    const prose = text.replace(CODE_SPAN, "");
    const definition = DEFINITION.exec(prose);
    const targets = [...prose.matchAll(INLINE_LINK)].map((match) => match[1] ?? "");
    if (definition?.[1]) targets.push(definition[1]);
    return targets.map((target) => ({ line, target }));
  });
}

/** Why `reference` (a path from the repository's root, with an optional anchor) is broken. */
function problem(tree: Tree, reference: string): string | undefined {
  const [path = "", anchor] = reference.split("#", 2);
  if (path.startsWith("../") || path === "..") return "points outside the repository";
  const isDirectory = [...tree.paths].some((file) =>
    file.startsWith(`${path.replace(/\/$/, "")}/`),
  );
  if (!tree.paths.has(path) && !isDirectory) return "no such file";
  if (!anchor || !path.endsWith(".md")) return undefined;
  if (!anchors(tree.read(path) ?? "").has(decodeURIComponent(anchor))) return "no such heading";
  return undefined;
}

/** The broken links of one Markdown file, as `path:line: target: why`. */
function brokenLinks(tree: Tree, file: string): string[] {
  return links(tree.read(file) ?? "").flatMap(({ line, target }) => {
    if (SCHEME.test(target) || target.startsWith("/")) return [];
    const [path = "", anchor] = target.split("#", 2);
    const resolved = path
      ? posix.normalize(posix.join(posix.dirname(file), decodeURIComponent(path)))
      : file;
    const why = problem(tree, anchor === undefined ? resolved : `${resolved}#${anchor}`);
    return why ? [`${file}:${line}: ${target}: ${why}`] : [];
  });
}

/** The broken references to the docs in a file of code, as `path:line: reference: why`. */
function brokenReferences(tree: Tree, file: string): string[] {
  return (tree.read(file) ?? "").split(/\r?\n/).flatMap((text, index) => {
    const references = [
      ...[...text.matchAll(CODE_REFERENCE)].map((match) => match[0]),
      ...[...text.matchAll(GITHUB_URL)].map((match) => match[1] ?? ""),
    ];
    return references.flatMap((reference) => {
      const why = problem(tree, reference);
      return why ? [`${file}:${index + 1}: ${reference}: ${why}`] : [];
    });
  });
}

/** Whether a file's links are checked: Codeman's own Markdown, but not full copies of pages. */
function isChecked(tree: Tree, path: string): boolean {
  if (path !== "README.md" && path !== "AGENTS.md" && !path.startsWith("docs/")) return false;
  if (!path.endsWith(".md")) return false;
  return !(path.startsWith("docs/web/") && frontMatter(tree.read(path) ?? "")?.has("license"));
}

function isCode(path: string): boolean {
  if (path.endsWith(".test.ts")) return false;
  return CODE_FILES.includes(path) || CODE_DIRS.some((dir) => path.startsWith(dir));
}

/** Every broken link and reference of a tree. */
function check(tree: Tree): string[] {
  return [...tree.paths].flatMap((path) => [
    ...(isChecked(tree, path) ? brokenLinks(tree, path) : []),
    ...(isCode(path) ? brokenReferences(tree, path) : []),
  ]);
}

function fixture(files: Record<string, string>): Tree {
  return { paths: new Set(Object.keys(files)), read: (path) => files[path] };
}

/** The repository's files: tracked or new, never ignored ones, and never `logs/`. */
function repository(): Tree {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".", ":(exclude)logs"],
    { encoding: "utf8" },
  );
  const paths = new Set(listed.split("\0").filter((path) => path && existsSync(path)));
  const cache = new Map<string, string>();
  const read: Read = (path) => {
    if (!paths.has(path)) return undefined;
    if (!cache.has(path)) cache.set(path, readFileSync(path, "utf8"));
    return cache.get(path);
  };
  return { paths, read };
}

test("anchors follow GitHub's rules", () => {
  const markdown = [
    "# Codeman's docs",
    "## 1. Code the agent wrote runs with the repository's secrets",
    "## `runpod-pod`",
    "### Shared pods",
    "## Shared pods",
    "## A [linked](x.md) heading ##",
    "```",
    "# not a heading",
    "```",
    '<a id="custom"></a>',
  ].join("\n");
  assert.deepEqual(
    [...anchors(markdown)],
    [
      "codemans-docs",
      "1-code-the-agent-wrote-runs-with-the-repositorys-secrets",
      "runpod-pod",
      "shared-pods",
      "shared-pods-1",
      "a-linked-heading",
      "custom",
    ],
  );
});

test("links skip code blocks and code spans", () => {
  const markdown = [
    "See [a](a.md#x) and `[b](b.md)`, ![c](c.png 'title') and [`d`](d.md \"D\").",
    "```md",
    "[e](e.md)",
    "```",
    "[f]: f.md",
  ].join("\n");
  assert.deepEqual(links(markdown), [
    { line: 1, target: "a.md#x" },
    { line: 1, target: "c.png" },
    { line: 1, target: "d.md" },
    { line: 5, target: "f.md" },
  ]);
});

test("a link to a missing file or heading is broken; one that resolves is not", () => {
  const tree = fixture({
    "docs/README.md": [
      "[ok](settings/reference.md#layers) [dir](settings/) [self](#index) [src](../src/a.ts#L1)",
      "[web](https://example.com) [site](/en/actions)",
      "[missing file](settings/old.md) [missing heading](settings/reference.md#gone)",
      "[outside](../../x.md)",
      "# Index",
    ].join("\n"),
    "docs/settings/reference.md": "# Settings\n\n## Layers\n",
    "src/a.ts": "",
  });
  assert.deepEqual(brokenLinks(tree, "docs/README.md"), [
    "docs/README.md:3: settings/old.md: no such file",
    "docs/README.md:3: settings/reference.md#gone: no such heading",
    "docs/README.md:4: ../../x.md: points outside the repository",
  ]);
});

test("references in code and the templates' URLs must name a file and heading", () => {
  const tree = fixture({
    "src/a.ts":
      "// See docs/settings/reference.md#layers and docs/old.md.\n// docs/settings/reference.md#gone",
    "templates/t.yml":
      "# https://github.com/codenergy-dev/codeman/blob/main/docs/settings/reference.md\n# https://github.com/codenergy-dev/codeman/blob/main/docs/old.md#x",
    "src/a.test.ts": "docs/fixture.md",
    "docs/settings/reference.md": "# Settings\n\n## Layers\n",
  });
  assert.deepEqual(check(tree), [
    "src/a.ts:1: docs/old.md: no such file",
    "src/a.ts:2: docs/settings/reference.md#gone: no such heading",
    "templates/t.yml:2: docs/old.md#x: no such file",
  ]);
});

test("full copies of third-party pages keep their source's links", () => {
  const tree = fixture({
    "docs/web/a/copy.md": "---\nlicense: MIT\n---\n[x](./gpu.mdx)",
    "docs/web/a/ours.md": "---\ntitle: Ours\n---\n[x](./gpu.mdx)",
  });
  assert.deepEqual(check(tree), ["docs/web/a/ours.md:4: ./gpu.mdx: no such file"]);
});

test("every link and reference to the repository's docs resolves", () => {
  assert.deepEqual(check(repository()), []);
});
