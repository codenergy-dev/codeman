/**
 * Collapses untrusted text to a single line before logging it, so it cannot start a line
 * with a workflow command such as `::add-mask::`.
 */
export function oneLine(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Lowercase ASCII words joined by hyphens, for branch and file names. */
export function slugify(text: string, max = 40): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/, "") || "task";
}

/**
 * Renders untrusted text (written by the agent or by users) as inert inline Markdown:
 * one line, no HTML, links, images or formatting, and no @mentions.
 */
export function inlineText(text: string): string {
  return oneLine(text)
    .replace(/[\\`*_{}[\]()<>#+!|~]/g, (char) => `\\${char}`)
    .replace(/@/g, "@\u200b");
}

/** Like `inlineText`, but keeps the text's line breaks, so lists and paragraphs survive. */
export function inertLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => inlineText(line))
    .join("\n");
}

/**
 * Renders untrusted text on one line as safe Markdown: emphasis and code spans work, but not
 * HTML, links that hide their target, images, @mentions or issue references. Links and images
 * become their text followed by the URL, which shows where it goes.
 */
export function safeInline(text: string): string {
  return outsideCode(oneLine(text), neutralize);
}

/**
 * Like `safeInline`, for text with several lines: lists, quotes, tables and code blocks work
 * too. Headings are lowered to level 5, so the text cannot imitate Codeman's own headings, and
 * a code block left open is closed, so it cannot swallow what Codeman writes after it.
 */
export function safeMarkdown(text: string): string {
  const lines: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker?.startsWith(fence) && marker[0] === fence[0]) fence = undefined;
      lines.push(line);
    } else if (marker) {
      fence = marker;
      lines.push(line);
    } else {
      lines.push(safeLine(line));
    }
  }
  if (fence !== undefined) lines.push(fence);
  return lines.join("\n");
}

/** One line outside a code block. */
function safeLine(line: string): string {
  const heading = /^ {0,3}#{1,6}(?=\s|$)/.exec(line);
  if (heading) return `#####${outsideCode(line.slice(heading[0].length), neutralize)}`;
  // A line of `=` or `-` under text would make it a large heading.
  if (/^ {0,3}(=+|-{2,})\s*$/.test(line)) return `\\${line.trimStart()}`;
  return outsideCode(line, neutralize);
}

/** Applies `transform` to the parts of a line outside code spans, which render literally. */
function outsideCode(line: string, transform: (part: string) => string): string {
  let result = "";
  let index = 0;
  while (index < line.length) {
    const open = line.indexOf("`", index);
    if (open === -1) break;
    const ticks = /^`+/.exec(line.slice(open))?.[0] ?? "`";
    const close = line.indexOf(ticks, open + ticks.length);
    if (close === -1) break;
    result += transform(line.slice(index, open)) + line.slice(open, close + ticks.length);
    index = close + ticks.length;
  }
  return result + transform(line.slice(index));
}

/** Text outside code: no HTML, links, images, mentions or issue references. */
function neutralize(text: string): string {
  return text
    .replace(
      /!?\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+[^)]*)?\)/g,
      (_, label: string, url: string) => (url ? `${label} (${url})` : label),
    )
    .replace(/[<[\]]/g, (char) => `\\${char}`)
    .replace(/@/g, "@​")
    .replace(/#(?=\d)/g, "#​");
}
