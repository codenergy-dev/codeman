/**
 * What the pod check prints: lines of allowlisted fields only, so that a public repository's log
 * shows no pod's ID, URL or environment, no token or key, and no response's headers or body
 * (plan to run the e2e suite on GitHub's runners, "Secrets and what a public repository shows").
 *
 * - A field's value is a number, a boolean, or a text that its key's pattern accepts; any other
 *   value prints as `withheld`.
 * - Every secret and identifier the run learns is registered with `hide` as soon as it exists:
 *   in GitHub Actions, it is also masked (`::add-mask::`), and a line that holds one is withheld
 *   whole.
 */

/** A line's fields, in order. Undefined fields are left out. */
export type Fields = Record<string, string | number | boolean | undefined>;

/** The texts each field may hold. A key that is not here takes numbers and booleans only. */
const TEXT_FIELDS: Readonly<Record<string, RegExp>> = {
  result: /^(pass|fail|stopped|unavailable|blocked|infrastructure)$/,
  provider: /^(runpod|salad)$/,
  checks: /^(ollama|vllm|blocked|unfit|probe)(,(ollama|vllm|blocked|unfit|probe)){0,4}$/,
  engine: /^(ollama|vllm)$/,
  /** A Runpod GPU ID, or a Salad GPU class's name, such as `RTX 3090 (24 GB)`. */
  gpu: /^[A-Za-z0-9][A-Za-z0-9 .()-]{0,63}$/,
  model: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/,
  commit: /^[0-9a-f]{40}$/,
  /** A Node.js version, as `process.version` gives it. */
  node: /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  source: /^(settings|cache|search)$/,
  cloud: /^(secure|community)$/,
  availability: /^(NONE|LOW|MEDIUM|HIGH|unknown)$/,
  error: /^[A-Za-z]{1,40}$/,
  advisories: /^[A-Za-z0-9-]{1,40}(,[A-Za-z0-9-]{1,40}){0,19}$/,
  /** Codeman's own sentences only, cleaned by `cleanMessage`. */
  message: /^[\x20-\x7e]{1,400}$/,
  /** The names of a problem body's top-level keys, never their values. */
  keys: /^[A-Za-z_][A-Za-z0-9_-]{0,40}(,[A-Za-z_][A-Za-z0-9_-]{0,40}){0,19}$/,
  /** A problem's `type`: a URL of a host and a path, with no query. */
  type: /^https?:\/\/[A-Za-z0-9.-]{1,100}(\/[A-Za-z0-9._~/#-]{0,200})?$/,
  /** A media type, without its parameters. */
  content_type: /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/,
  /** What the Salad probe found Salad refuses (`ProbeCause` in e2e/live/salad.ts). */
  cause: /^(none|unknown|any-command|item-content|total-chars|item-count|item-length|throttled)$/,
  /** Whether a Salad cost counts only the instances' running time, or their whole life. */
  cost_basis: /^(billed|upper_bound|mixed)$/,
  /** A problem's `traceId`, as a W3C `traceparent` or hexadecimal digits and hyphens. */
  trace_id: /^[0-9a-f-]{16,64}$/,
  /** The name of a word the probe tried, such as `curl-output`; never the word. */
  word: /^[a-z0-9]{1,20}(-[a-z0-9]{1,20}){0,3}$/,
  /** The indexes of the command's items the probe found refused alone. */
  refused_items: /^\d{1,3}(,\d{1,3}){0,99}$/,
  /** The indexes of an item's tokens, or runs of them as `<first>-<last>`, found refused. */
  refused_tokens: /^\d{1,3}(-\d{1,3})?(,\d{1,3}(-\d{1,3})?){0,99}$/,
  /** The names of the words found refused. */
  refused_words:
    /^[a-z0-9]{1,20}(-[a-z0-9]{1,20}){0,3}(,[a-z0-9]{1,20}(-[a-z0-9]{1,20}){0,3}){0,19}$/,
  /** A size Salad's limit lies in, as `<taken>-<refused>`. */
  limit: /^\d{1,6}-\d{1,6}$/,
  /** The check's own sentences, from its code. */
  reason: /^[A-Za-z][A-Za-z0-9 ,.;:()`'_/-]{0,300}$/,
};

/** Values shorter than this are never registered: masking them would hide common words. */
const MIN_HIDDEN = 6;

export class Report {
  readonly #write: (line: string) => void;
  readonly #actions: boolean;
  readonly #hidden = new Set<string>();

  /** `actions`: running in GitHub Actions (`GITHUB_ACTIONS=true`), whose runner reads masks. */
  constructor(write: (line: string) => void, actions: boolean) {
    this.#write = write;
    this.#actions = actions;
  }

  /**
   * Registers a value no line may show: a secret, or a pod's ID, URL or nonce. In GitHub Actions
   * it is masked first, before anything could print it.
   */
  hide(value: string | undefined): void {
    if (value === undefined || value.length < MIN_HIDDEN || this.#hidden.has(value)) return;
    // A mask command is one line; a value with a line break would end it early.
    for (const part of value.split(/[\r\n]+/)) {
      if (part.length < MIN_HIDDEN || this.#hidden.has(part)) continue;
      this.#hidden.add(part);
      if (this.#actions) this.#write(`::add-mask::${part}`);
    }
  }

  /** Prints `[pod-check] <event> key=value ...`, or the event alone when a value is hidden. */
  line(event: string, fields: Fields = {}): void {
    const parts = Object.entries(fields)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
      .map(([key, value]) => `${key}=${formatted(key, value)}`);
    const text = [`[pod-check] ${event}`, ...parts].join(" ");
    this.#write(this.#shows(text) ? text : `[pod-check] ${event} withheld=true`);
  }

  /** Whether a line holds nothing hidden, and only printable ASCII. */
  #shows(text: string): boolean {
    if (/[^\x20-\x7e]/.test(text)) return false;
    for (const value of this.#hidden) if (text.includes(value)) return false;
    return true;
  }

  /**
   * A message of Codeman's, such as the fit's, with every hidden value, URL and character outside
   * printable ASCII removed, and cut to 400 characters.
   */
  cleanMessage(text: string): string {
    let clean = text;
    for (const value of this.#hidden) clean = clean.split(value).join("[hidden]");
    clean = clean
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
      .replace(/[^\x20-\x7e]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return clean.length > 400 ? `${clean.slice(0, 397)}...` : clean;
  }
}

/** A field's value as the line writes it: texts with spaces are quoted. */
function formatted(key: string, value: string | number | boolean): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "withheld";
  }
  const pattern = TEXT_FIELDS[key];
  if (!pattern?.test(value)) return "withheld";
  return /[\s"=]/.test(value) ? JSON.stringify(value) : value;
}
