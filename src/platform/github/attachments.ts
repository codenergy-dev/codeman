import type {
  AttachmentLink,
  Attachments,
  Download,
  DownloadProblem,
  Expansion,
  TextRef,
} from "../platform.ts";
import type { RepositoryRef } from "../types.ts";
import type { Octokit } from "./platform.ts";

/**
 * Files attached to GitHub issues, comments and reviews, and assets of releases. See
 * docs/plans/2026-11-26-give-the-agent-the-issue-attachments.md#how-attachments-download and
 * docs/plans/2026-11-26-download-attachments-from-releases.md.
 *
 * An attachment's link is tried first, with the job's token sent to github.com only. GitHub refuses
 * every token a script can hold a private repository's attachments, so a refused link is looked for
 * again in the text's rendered HTML, whose signed addresses download without a token: images have
 * them, other files do not. A release asset downloads through the REST API, which the job's token
 * reads.
 */
export class GitHubAttachments implements Attachments {
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #html: (where: TextRef) => Promise<string | undefined>;
  readonly #rendered = new Map<string, { at: number; html: Promise<string | undefined> }>();
  readonly #releases = new Map<string, Promise<ReleaseResult>>();

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

  async expand(link: AttachmentLink, signal: AbortSignal): Promise<Expansion> {
    if (link.kind !== "release") return { ok: true, links: [link] };
    const ref = releaseRef(link.url);
    if (!ref) return { ok: false, problem: "failed", detail: "not a link to a release" };
    const release = await this.#release(ref, signal);
    if (!release.ok) return release;
    const links = release.assets.map(
      (asset): AttachmentLink => ({
        kind: "release-asset",
        url: asset.browser_download_url,
        id: String(asset.id),
        name: asset.name,
      }),
    );
    return { ok: true, links };
  }

  async download(
    link: AttachmentLink,
    where: TextRef,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Download> {
    if (link.kind === "release-asset") return this.#releaseAsset(link, maxBytes, signal);
    if (link.kind === "release") return failed("failed", "a release, not one file");
    const direct = await this.#get(link.url, maxBytes, signal);
    if (direct.ok || direct.problem !== "refused") return direct;
    const html = await this.#renderedHtml(where);
    const signed = html
      ? signedAddresses(html).find((url) => url !== link.url && url.includes(link.id))
      : undefined;
    const viaHtml = signed ? await this.#get(signed, maxBytes, signal) : undefined;
    if (viaHtml && (viaHtml.ok || viaHtml.problem === "too-large")) return viaHtml;
    // GitHub's own refusal, not a redirect away from it.
    const byGitHub = direct.detail?.startsWith("HTTP ") || direct.detail === SIGN_IN;
    return byGitHub ? { ...direct, reference: PRIVATE_ATTACHMENTS_REFERENCE } : direct;
  }

  /** An asset of a release, by its name, through the API. */
  async #releaseAsset(link: AttachmentLink, maxBytes: number, signal: AbortSignal) {
    const ref = releaseRef(link.url);
    if (!ref?.asset) return failed("failed", "not a link to a release asset");
    const release = await this.#release(ref, signal);
    if (!release.ok) return failed(release.problem, release.detail);
    const asset = release.assets.find(({ name }) => name === ref.asset);
    if (!asset) {
      return failed("refused", `the release ${release.tag} has no asset named ${ref.asset}`);
    }
    if (asset.size > maxBytes) return failed("too-large");
    const download = await this.#get(asset.url, maxBytes, signal, "application/octet-stream");
    return download.ok ? { ...download, name: asset.name } : download;
  }

  /** A published release, by its tag or the latest, read once per run. */
  #release(ref: ReleaseRef, signal: AbortSignal): Promise<ReleaseResult> {
    const key = `${ref.owner}/${ref.repo}@${ref.tag ?? ""}`.toLowerCase();
    let release = this.#releases.get(key);
    if (!release) {
      release = this.#readRelease(ref, signal);
      this.#releases.set(key, release);
    }
    return release;
  }

  async #readRelease(ref: ReleaseRef, signal: AbortSignal): Promise<ReleaseResult> {
    const which = ref.tag === undefined ? "the latest release" : `the release ${ref.tag}`;
    if (ref.tag?.startsWith("untagged-")) {
      return {
        ok: false,
        problem: "refused",
        detail: `${which} is a draft, which the job cannot read: publish it`,
      };
    }
    const path = ref.tag === undefined ? "latest" : `tags/${encodeURIComponent(ref.tag)}`;
    const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/${path}`;
    const response = await this.#get(url, MAX_RELEASE_BYTES, signal, "application/vnd.github+json");
    if (!response.ok) {
      return response.problem === "refused"
        ? {
            ok: false,
            problem: "refused",
            detail: `no published release the job can read: ${which} of ${ref.owner}/${ref.repo} (${response.detail ?? "refused"})`,
          }
        : { ok: false, problem: "failed", detail: response.detail ?? "the release was too large" };
    }
    try {
      const data = JSON.parse(response.data.toString("utf8")) as {
        tag_name?: unknown;
        assets?: unknown;
      };
      const assets = Array.isArray(data.assets) ? data.assets.filter(isReleaseAsset) : [];
      return { ok: true, tag: String(data.tag_name ?? ref.tag ?? "latest"), assets };
    } catch {
      return { ok: false, problem: "failed", detail: "the release was not valid JSON" };
    }
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

  /**
   * Follows redirects by hand, to GitHub's hosts only, with the token on github.com and
   * api.github.com only.
   */
  async #get(
    url: string,
    maxBytes: number,
    signal: AbortSignal,
    accept?: string,
  ): Promise<Download> {
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
        return failed("refused", SIGN_IN);
      }
      let response: Response;
      try {
        const headers: Record<string, string> = TOKEN_HOSTS.has(target.hostname)
          ? { authorization: `Bearer ${this.#token}` }
          : {};
        if (accept && target.hostname === "api.github.com") headers.accept = accept;
        response = await this.#fetch(target.href, { headers, redirect: "manual", signal });
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
const SIGN_IN = "GitHub asked to sign in";
/** A release's JSON, with its list of assets: up to 1000 of them. */
const MAX_RELEASE_BYTES = 10 * 1024 * 1024;
/** The hosts the job's token goes to. */
const TOKEN_HOSTS = new Set(["github.com", "api.github.com"]);

/** Why a private repository's attachments do not download: a community discussion of it. */
export const PRIVATE_ATTACHMENTS_REFERENCE = "https://github.com/orgs/community/discussions/162417";

/** A release, by its tag or the latest, and one of its assets by name, when the link has one. */
interface ReleaseRef {
  owner: string;
  repo: string;
  tag?: string | undefined;
  asset?: string | undefined;
}

interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  /** The API's address of the asset. */
  url: string;
  browser_download_url: string;
}

type ReleaseResult =
  | { ok: true; tag: string; assets: ReleaseAsset[] }
  | { ok: false; problem: "refused" | "failed"; detail?: string | undefined };

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  if (typeof value !== "object" || value === null) return false;
  const asset = value as Partial<ReleaseAsset>;
  return (
    typeof asset.id === "number" &&
    typeof asset.name === "string" &&
    typeof asset.size === "number" &&
    typeof asset.url === "string" &&
    asset.url.startsWith("https://api.github.com/") &&
    typeof asset.browser_download_url === "string"
  );
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NAME = "[^\\s\"'<>()\\[\\]`]+";

/**
 * GitHub's attachment links: files and assets under `user-attachments`, their older forms under
 * a repository, and images on `user-images` and `private-user-images.githubusercontent.com`. And
 * links to releases, which `releaseRef` sorts out.
 */
const LINK = new RegExp(
  `https://(?:github\\.com/(?:user-attachments|[\\w.-]+/[\\w.-]+)/(?:files/\\d+/${NAME}|assets/(?:\\d+/)?${UUID})|(?:private-)?user-images\\.githubusercontent\\.com/${NAME}|github\\.com/[\\w.-]+/[\\w.-]+/releases/${NAME})`,
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
  const release = releaseRef(url);
  if (release) {
    const tag = release.tag ?? "latest";
    return release.asset
      ? {
          kind: "release-asset",
          url,
          id: `${release.owner}/${release.repo}@${tag}/${release.asset}`,
          name: release.asset,
        }
      : { kind: "release", url, id: `${release.owner}/${release.repo}@${tag}` };
  }
  const file = /\/files\/(\d+)\/([^/]+)$/.exec(parsed.pathname);
  if (parsed.hostname === "github.com" && file?.[1] && file[2]) {
    return { kind: "attachment", url, id: file[1], name: decoded(file[2]) };
  }
  const asset = new RegExp(`/assets/(?:\\d+/)?(${UUID})$`, "i").exec(parsed.pathname);
  if (parsed.hostname === "github.com" && asset?.[1]) {
    return { kind: "attachment", url, id: asset[1].toLowerCase() };
  }
  if (parsed.hostname.endsWith("user-images.githubusercontent.com")) {
    const name = parsed.pathname.split("/").pop() ?? "";
    return name ? { kind: "attachment", url, id: name, name: decoded(name) } : undefined;
  }
  return undefined;
}

/**
 * A link to a release or one of its assets: `…/releases/download/<tag>/<name>`,
 * `…/releases/latest/download/<name>`, `…/releases/tag/<tag>` or `…/releases/latest`. A tag may
 * have slashes. Any other page of releases is not one.
 */
export function releaseRef(url: string): ReleaseRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return undefined;
  const parts = parsed.pathname.split("/").filter(Boolean).map(decoded);
  const [owner, repo, releases, ...rest] = parts;
  if (!owner || !repo || releases !== "releases" || rest.some((part) => !part)) return undefined;
  const [first, ...more] = rest;
  if (first === "latest" && more.length === 0) return { owner, repo };
  if (first === "latest" && more.length === 2 && more[0] === "download") {
    return { owner, repo, asset: more[1] };
  }
  if (first === "tag" && more.length > 0) return { owner, repo, tag: more.join("/") };
  if (first === "download" && more.length > 1) {
    return { owner, repo, tag: more.slice(0, -1).join("/"), asset: more.at(-1) };
  }
  return undefined;
}

/** The hosts GitHub serves attachments and release assets from, and redirects them to. */
export function isGitHubHost(host: string): boolean {
  return (
    host === "github.com" ||
    host === "api.github.com" ||
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
