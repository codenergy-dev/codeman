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
