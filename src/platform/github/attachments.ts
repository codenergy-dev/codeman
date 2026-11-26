import type {
  AttachmentLink,
  Attachments,
  Download,
  DownloadProblem,
  TextRef,
} from "../platform.ts";
import type { RepositoryRef } from "../types.ts";
import type { Octokit } from "./platform.ts";

/**
 * Files attached to GitHub issues, comments and reviews. See
 * docs/plans/2026-11-26-give-the-agent-the-issue-attachments.md#how-attachments-download.
 *
 * A link is tried first, with the job's token sent to github.com only. GitHub refuses installation
 * tokens a private repository's attachments, so a refused link is looked for again in the text's
 * rendered HTML, whose signed addresses download without a token.
 */
export class GitHubAttachments implements Attachments {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #html: (where: TextRef) => Promise<string | undefined>;
  readonly #rendered = new Map<string, { at: number; html: Promise<string | undefined> }>();

  constructor(options: {
    token: string;
    fetch?: typeof fetch;
    /** The text's HTML, as GitHub renders it, with its signed addresses. */
    html: (where: TextRef) => Promise<string | undefined>;
  }) {
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#html = options.html;
  }

  find(text: string): AttachmentLink[] {
    const links = new Map<string, AttachmentLink>();
    for (const match of text.matchAll(LINK)) {
      const url = match[0].replace(TRAILING, "");
      const link = attachmentLink(url);
      if (link && !links.has(url)) links.set(url, link);
    }
    return [...links.values()];
  }

  async download(
    link: AttachmentLink,
    where: TextRef,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Download> {
    const direct = await this.#get(link.url, maxBytes, signal);
    if (direct.ok || direct.problem !== "refused") return direct;
    const html = await this.#renderedHtml(where);
    const signed = html
      ? signedAddresses(html).find((url) => url !== link.url && url.includes(link.id))
      : undefined;
    if (!signed) return direct;
    const viaHtml = await this.#get(signed, maxBytes, signal);
    return viaHtml.ok || viaHtml.problem === "too-large" ? viaHtml : direct;
  }

  /** The rendered HTML, read again after a minute: its signed addresses last five. */
  #renderedHtml(where: TextRef): Promise<string | undefined> {
    const key = JSON.stringify(where);
    const cached = this.#rendered.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.html;
    const html = this.#html(where).catch(() => undefined);
    this.#rendered.set(key, { at: Date.now(), html });
    return html;
  }

  /** Follows redirects by hand, to GitHub's hosts only, with the token on github.com only. */
  async #get(url: string, maxBytes: number, signal: AbortSignal): Promise<Download> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let target: URL;
      try {
        target = new URL(current);
      } catch {
        return failed("failed", "an invalid address");
      }
      if (target.protocol !== "https:" || !isGitHubHost(target.hostname)) {
        return failed("refused", `redirected to ${target.hostname}, which is not GitHub's`);
      }
      if (target.hostname === "github.com" && target.pathname.startsWith("/login")) {
        return failed("refused", "GitHub asked to sign in");
      }
      let response: Response;
      try {
        response = await this.#fetch(target.href, {
          headers:
            target.hostname === "github.com" ? { authorization: `Bearer ${this.#token}` } : {},
          redirect: "manual",
          signal,
        });
      } catch (error) {
        return failed("failed", signal.aborted ? "out of time" : errorText(error));
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, target).href;
        continue;
      }
      if (response.status === 200) return read(response, maxBytes, target, signal);
      await response.body?.cancel();
      return [401, 403, 404].includes(response.status)
        ? failed("refused", `HTTP ${response.status}`)
        : failed("failed", `HTTP ${response.status}`);
    }
    return failed("failed", "too many redirects");
  }
}

/** The text's HTML from GitHub's REST API, in its `full` media type. */
export function renderedHtml(
  client: Octokit,
  repository: RepositoryRef,
): (where: TextRef) => Promise<string | undefined> {
  const scope = { owner: repository.owner, repo: repository.name, mediaType: { format: "full" } };
  return async (where) => {
    switch (where.kind) {
      case "issue":
        return (await client.rest.issues.get({ ...scope, issue_number: where.number })).data
          .body_html;
      case "comment":
        return (await client.rest.issues.getComment({ ...scope, comment_id: where.id })).data
          .body_html;
      case "review":
        return (
          await client.rest.pulls.getReview({
            ...scope,
            pull_number: where.changeRequest,
            review_id: where.id,
          })
        ).data.body_html;
      case "review-comment":
        return (await client.rest.pulls.getReviewComment({ ...scope, comment_id: where.id })).data
          .body_html;
    }
  };
}

const MAX_REDIRECTS = 5;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NAME = "[^\\s\"'<>()\\[\\]`]+";

/**
 * GitHub's attachment links: files and assets under `user-attachments`, their older forms under
 * a repository, and images on `user-images` and `private-user-images.githubusercontent.com`.
 */
const LINK = new RegExp(
  `https://(?:github\\.com/(?:user-attachments|[\\w.-]+/[\\w.-]+)/(?:files/\\d+/${NAME}|assets/(?:\\d+/)?${UUID})|(?:private-)?user-images\\.githubusercontent\\.com/${NAME})`,
  "gi",
);

/** Punctuation that ends a sentence after a link, rather than the link. */
const TRAILING = /[.,;:!?*_~]+$/;

function attachmentLink(url: string): AttachmentLink | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const file = /\/files\/(\d+)\/([^/]+)$/.exec(parsed.pathname);
  if (parsed.hostname === "github.com" && file?.[1] && file[2]) {
    return { url, id: file[1], name: decoded(file[2]) };
  }
  const asset = new RegExp(`/assets/(?:\\d+/)?(${UUID})$`, "i").exec(parsed.pathname);
  if (parsed.hostname === "github.com" && asset?.[1]) return { url, id: asset[1].toLowerCase() };
  if (parsed.hostname.endsWith("user-images.githubusercontent.com")) {
    const name = parsed.pathname.split("/").pop() ?? "";
    return name ? { url, id: name, name: decoded(name) } : undefined;
  }
  return undefined;
}

/** The hosts GitHub serves attachments from, and redirects them to. */
export function isGitHubHost(host: string): boolean {
  return (
    host === "github.com" ||
    host.endsWith(".githubusercontent.com") ||
    /^github-production-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(host)
  );
}

/** Addresses on GitHub's hosts in the `href` and `src` attributes of rendered HTML. */
export function signedAddresses(html: string): string[] {
  const addresses: string[] = [];
  for (const match of html.matchAll(/\s(?:href|src)="(https:\/\/[^"]+)"/g)) {
    const url = (match[1] ?? "").replaceAll("&amp;", "&");
    try {
      if (isGitHubHost(new URL(url).hostname)) addresses.push(url);
    } catch {
      // Not an address.
    }
  }
  return addresses;
}

/** Reads a body of at most `maxBytes`, stopping as soon as it is over. */
async function read(
  response: Response,
  maxBytes: number,
  url: URL,
  signal: AbortSignal,
): Promise<Download> {
  const length = Number(response.headers.get("content-length") ?? Number.NaN);
  if (length > maxBytes) {
    await response.body?.cancel();
    return failed("too-large");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        return failed("too-large");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    return failed("failed", signal.aborted ? "out of time" : errorText(error));
  }
  return {
    ok: true,
    data: Buffer.concat(chunks),
    name: dispositionName(response.headers.get("content-disposition")) ?? urlName(url),
  };
}

/** The file name a `Content-Disposition` header, or a signed URL's parameter for it, gives. */
function dispositionName(header: string | null): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  if (extended) return decoded(extended);
  const plain = /filename="?([^";]+)"?/.exec(header)?.[1];
  return plain?.trim() || undefined;
}

function urlName(url: URL): string | undefined {
  const fromQuery = dispositionName(url.searchParams.get("response-content-disposition"));
  if (fromQuery) return fromQuery;
  const last = url.pathname.split("/").pop();
  return last ? decoded(last) : undefined;
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function failed(problem: DownloadProblem, detail?: string): Download {
  return { ok: false, problem, ...(detail ? { detail } : {}) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
