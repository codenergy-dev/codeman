import type { Platform } from "./platform/platform.ts";
import { slugify } from "./text.ts";

/** Where a repository keeps the documentation of the third-party services it relies on. */
export const WEB_DIR = "docs/web/";
/** Instructions for fetching pages: generic ones, and one per third party that needs them. */
export const WEB_TOOLS_DIR = `${WEB_DIR}tools/`;
/** Codeman's generic tool, read from the action's own checkout, for repositories without one. */
export const GENERIC_TOOL = new URL("../docs/web/tools/fetch-markdown.md", import.meta.url);
/** Pages fetched longer ago than this are listed on the task's panel. */
export const OLD_PAGE_DAYS = 30;
/** Characters of a page or tool's title, which names its file. */
const SLUG_CHARS = 80;

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PAGE_FIELDS = new Set(["title", "url", "created_at", "updated_at", "tool", "license"]);
const TOOL_FIELDS = new Set(["title", "url", "created_at", "updated_at"]);

export function isWebPath(path: string): boolean {
  return path.startsWith(WEB_DIR);
}

/**
 * The fields of a Markdown file's front matter: `key: value` lines between two `---` lines at
 * its start. Undefined when it has none, or a line that is not a field.
 */
export function frontMatter(text: string): Map<string, string> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return undefined;
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!field?.[1]) return undefined;
    fields.set(field[1], (field[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  return fields;
}

/** An ISO 8601 timestamp with seconds and an offset, such as `2026-10-02T21:52:00-03:00`. */
export function isTimestamp(value: string | undefined): value is string {
  return value !== undefined && ISO_8601.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Why a page or tool under `docs/web/` does not follow the format, in Codeman's own words; or
 * undefined when it does. `toolExists` tells whether a page's `tool` is in the repository.
 */
export function webFileProblem(
  path: string,
  text: string,
  toolExists: (path: string) => boolean,
): string | undefined {
  const segments = path.slice(WEB_DIR.length).split("/");
  const tool = path.startsWith(WEB_TOOLS_DIR);
  if (!path.endsWith(".md") || segments.length !== 2) {
    return `pages go in ${WEB_DIR}<third-party>/<slug>.md, and tools in ${WEB_TOOLS_DIR}<slug>.md`;
  }
  const fields = frontMatter(text);
  if (!fields) return "it has no front matter of `key: value` lines";
  const allowed = tool ? TOOL_FIELDS : PAGE_FIELDS;
  const unknown = [...fields.keys()].filter((name) => !allowed.has(name));
  if (unknown.length > 0) return `unknown front matter fields: ${unknown.join(", ")}`;
  const title = fields.get("title");
  if (!title) return "title is missing";
  const slug = slugify(title, SLUG_CHARS);
  if (segments[1] !== `${slug}.md`) return `its file name must be ${slug}.md, from its title`;
  const url = fields.get("url");
  if ((url !== undefined || !tool) && !/^https?:\/\/\S+$/.test(url ?? "")) {
    return "url must be an http or https URL";
  }
  const created = fields.get("created_at");
  const updated = fields.get("updated_at");
  if (!isTimestamp(created) || !isTimestamp(updated)) {
    return "created_at and updated_at must be ISO 8601 timestamps with seconds and an offset";
  }
  if (Date.parse(updated) < Date.parse(created)) return "updated_at is before created_at";
  if (tool) return undefined;
  const source = fields.get("tool") ?? "";
  if (!source.startsWith(WEB_TOOLS_DIR) || !source.endsWith(".md") || !toolExists(source)) {
    return `tool must name a file in ${WEB_TOOLS_DIR} that exists`;
  }
  if (fields.has("license") && !fields.get("license")) return "license must not be empty";
  return undefined;
}

/** What the record keeps of each page, so unchanged files are not read again. */
export interface WebPage {
  /** The file's blob. */
  sha: string;
  /** Its `updated_at`; undefined when its front matter cannot be read. */
  updatedAt?: string | undefined;
}

/**
 * The pages under `docs/web/` at `ref`, tools left out, with when each was last fetched. Pages
 * whose blob is in `known` keep what was read before; only the others are read.
 */
export async function webPages(
  repo: Pick<Platform, "filesUnder" | "readFile">,
  ref: string,
  known: Readonly<Record<string, WebPage>> = {},
): Promise<Record<string, WebPage>> {
  const files = await repo.filesUnder(ref, WEB_DIR);
  const pages: Record<string, WebPage> = {};
  for (const [path, file] of files) {
    if (!path.endsWith(".md") || path.startsWith(WEB_TOOLS_DIR)) continue;
    const before = known[path];
    if (before?.sha === file.sha) {
      pages[path] = before;
      continue;
    }
    const text = await repo.readFile(ref, path);
    const updatedAt = text === undefined ? undefined : frontMatter(text)?.get("updated_at");
    pages[path] = { sha: file.sha, updatedAt: isTimestamp(updatedAt) ? updatedAt : undefined };
  }
  return pages;
}

/** A page fetched more than OLD_PAGE_DAYS days ago, or whose date cannot be read. */
export interface OldPage {
  path: string;
  /** Days since it was fetched; undefined when its front matter cannot be read. */
  days?: number | undefined;
}

/** The pages to list on the panel, oldest first, those without a date last. */
export function oldPages(
  pages: Readonly<Record<string, WebPage>> | undefined,
  now: Date,
): OldPage[] {
  const old: OldPage[] = [];
  for (const [path, page] of Object.entries(pages ?? {})) {
    if (page.updatedAt === undefined) {
      old.push({ path });
      continue;
    }
    const days = Math.floor((now.getTime() - Date.parse(page.updatedAt)) / 86_400_000);
    if (days > OLD_PAGE_DAYS) old.push({ path, days });
  }
  return old.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.path.localeCompare(b.path));
}
