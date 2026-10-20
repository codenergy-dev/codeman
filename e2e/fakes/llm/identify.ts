import { createHash } from "node:crypto";
import { HARNESS_PROMPT, OUTPUT_FILE, TASK_FILE } from "../../../src/prompt.ts";
import { ROUTED_STAGES, type Stage } from "../../../src/stages.ts";
import type { ChatMessage, ChatRequest } from "../openrouter/chat.ts";
import { MARKER } from "./script.ts";

/**
 * Which conversation a chat request belongs to, from its content alone: no gateway passes a
 * token upstream. OpenCode starts with Codeman's harness prompt, which only points to the task
 * file, so a conversation's first turn is the same for every run: the model reads the task file.
 * From then on the task file is in the conversation, as the read's tool result:
 *
 * - the issue's marker names the scenario and the issue;
 * - the task's first heading names the stage (src/prompt.ts);
 * - the nonce of its quoted blocks, random per task file, tells one run of the stage from the
 *   next, so the model counts rounds by the nonces it sees;
 * - the last user message is the harness prompt, or Codeman's fix prompt for the fix pass;
 * - the turn is the number of tool results since that message: each scripted turn makes one
 *   tool call.
 */

export type Phase = "main" | "fix";

export type Identified =
  /** A conversation's first turn: the model reads the task file. */
  | { kind: "start"; workdir: string | undefined }
  /** A turn of a known conversation. */
  | {
      kind: "turn";
      scenario: string;
      issue: string;
      stage: Stage;
      /** The task file's nonce, or a digest of it: one per run of the stage. */
      run: string;
      phase: Phase;
      /** Tool results since the last user message: 1 for the turn after the task file's read. */
      turn: number;
      workdir: string | undefined;
      /** What the last tool call returned, for the log. */
      lastResult: string | undefined;
    }
  /** OpenCode's title request: no tools, and its own prompt. */
  | { kind: "title" }
  | { kind: "unknown"; reason: string };

/** The stage a task file's first heading names. */
const HEADING =
  /# Codeman task: (?:(plan) issue|choose the next stages of issue|(\w+) stage of issue) #\d+/;
const NONCE = /<<<ISSUE BODY ([0-9a-f]+)/;
const WORKDIR = /Working directory: (\S[^\n]*)/;
const FIX = `Codeman cannot use ${OUTPUT_FILE} as it is`;
/** OpenCode's title request starts with this user message (session/prompt.ts, `ensureTitle`). */
const TITLE = "Generate a title for this conversation:";

/** The text of a message's content: a string, or its text parts. */
export function textOf(message: ChatMessage | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof part === "object" && part !== null && typeof part.text === "string"
            ? part.text
            : JSON.stringify(part),
      )
      .join("");
  }
  return content === undefined || content === null ? "" : JSON.stringify(content);
}

export function identify(request: ChatRequest): Identified {
  const messages = request.messages;
  const tools = request.tools ?? [];
  if (tools.length === 0 && messages.some((message) => textOf(message).startsWith(TITLE))) {
    return { kind: "title" };
  }
  const workdir = messages
    .filter((message) => message.role === "system")
    .map((message) => WORKDIR.exec(textOf(message))?.[1]?.trim())
    .find((found) => found !== undefined);
  const last = messages.findLastIndex((message) => message.role === "user");
  if (last < 0) return { kind: "unknown", reason: "The request has no user message." };
  const prompt = textOf(messages[last]);
  const phase: Phase | undefined = prompt.includes(FIX)
    ? "fix"
    : prompt.includes(HARNESS_PROMPT)
      ? "main"
      : undefined;
  if (!phase) {
    return { kind: "unknown", reason: "The last user message is not Codeman's harness prompt." };
  }
  const after = messages.slice(last + 1);
  const results = after.filter((message) => message.role === "tool");
  if (phase === "main" && results.length === 0) return { kind: "start", workdir };

  const text = messages
    .filter((message) => message.role === "tool")
    .map(textOf)
    .find((content) => MARKER.test(content) && HEADING.test(content));
  if (text === undefined) {
    return {
      kind: "unknown",
      reason: `No tool result holds ${TASK_FILE} with the e2e marker: the issue's body lacks it.`,
    };
  }
  const [, scenario = "", issue = ""] = MARKER.exec(text) ?? [];
  const heading = HEADING.exec(text);
  // Planning names itself in group 1, a routed stage in group 2; routing has neither.
  const stage = (heading?.[1] ?? heading?.[2] ?? "route") as Stage;
  if (stage !== "plan" && stage !== "route" && !ROUTED_STAGES.includes(stage)) {
    return { kind: "unknown", reason: `The task file names an unknown stage, "${stage}".` };
  }
  const run = NONCE.exec(text)?.[1] ?? createHash("sha256").update(text).digest("hex").slice(0, 16);
  return {
    kind: "turn",
    scenario,
    issue,
    stage,
    run,
    phase,
    turn: results.length,
    workdir,
    lastResult: results.length > 0 ? textOf(results.at(-1)) : undefined,
  };
}
