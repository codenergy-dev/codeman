/**
 * What Codeman must know about a platform besides its API: how its Markdown links people and
 * items, how long a comment may be, and how its CI is configured. Static for each platform.
 */
export interface Conventions {
  /** The platform's name, as the agent reads it, such as `GitHub`. */
  name: string;
  markdown: MarkdownDialect;
  /** The most characters a comment may hold. Codeman's records live in comments. */
  commentLimit: number;
  workflows: WorkflowConventions;
}

/**
 * How text links people and items in the platform's Markdown. Codeman breaks each match in
 * untrusted text with an invisible space after it, so it notifies and links nothing. This is a
 * security boundary: a match the dialect misses lets the agent mention anyone.
 */
export interface MarkdownDialect {
  /** Global; mentions and references in text outside code, such as `@user` or `#12`. */
  references: RegExp;
  /** Global; the same in inert text, whose Markdown punctuation is already escaped. */
  mentions: RegExp;
}

/**
 * Where CI configuration lives and what the agent must know to write it. A workflow the agent
 * writes is staged under `.codeman/workflows/` until a maintainer accepts it.
 */
export interface WorkflowConventions {
  /** The directory of workflow files, ending in `/`, such as `.github/workflows/`. */
  dir: string;
  /** A workflow file the agent may wait for. */
  file: RegExp;
  /** What `file` accepts, for error messages: "files directly under .github/workflows/". */
  fileDescription: string;
  /**
   * The rules that protect CI configuration in the proposed `.codemanignore`, in `.gitignore`
   * syntax, with a comment line before them.
   */
  protect: string;
  /** One path under each rule of `protect`, to tell whether a repository still protects it. */
  probes: readonly string[];
  /** The agent's rules for writing workflows, as Markdown list items, in a routed stage on `branch`. */
  agentRules(branch: string): string;
  /** How review checks staged workflows: one numbered step's text. */
  reviewCheck: string;
}
