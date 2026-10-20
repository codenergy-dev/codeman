import { GITHUB } from "../../../src/platform/github/conventions.ts";
import {
  HARNESS_PROMPT,
  planPrompt,
  routePrompt,
  stagePrompt,
  TASK_FILE,
} from "../../../src/prompt.ts";
import { DEFAULTS } from "../../../src/settings.ts";
import type { RoutedStage } from "../../../src/stages.ts";
import type { TaskContext } from "../../../src/tasks.ts";
import type { ChatMessage, ChatRequest, ToolCall } from "../openrouter/chat.ts";
import { marker } from "./script.ts";

/**
 * For the tests: OpenCode's side of a conversation with the scripted model, without OpenCode.
 * Requests look like those of OpenCode 1.18.32 through `@ai-sdk/openai-compatible`: a system
 * prompt with the `<env>` block (session/system.ts), the harness prompt, the tools offered, and
 * each tool call followed by its `tool` message. The task file is a real Codeman prompt.
 */

export const WORKDIR = "/home/codeman-agent/work";

export const TOOL_NAMES = ["bash", "read", "glob", "grep", "edit", "write", "task", "skill"];

export function tools(names: readonly string[] = TOOL_NAMES) {
  return names.map((name) => ({
    type: "function",
    function: { name, description: `The ${name} tool.`, parameters: { type: "object" } },
  }));
}

const SYSTEM = `You are opencode, an interactive CLI tool.
Here is some useful information about the environment you are running in:
<env>
  Working directory: ${WORKDIR}
  Workspace root folder: ${WORKDIR}
  Is directory a git repo: yes
  Platform: linux
</env>`;

export function task(scenario: string, issue: string): TaskContext {
  return {
    version: 1,
    action: "plan",
    owner: "acme",
    repo: "app",
    number: 12,
    title: "Add a health route",
    body: `Add GET /health.\n\n${marker(scenario, issue)}\n`,
    url: "https://github.com/acme/app/issues/12",
    comments: [],
    reviews: [],
    requests: [],
    resume: false,
    processed: { commentId: 0, reviewId: 0 },
    problems: [],
    fromState: "new",
    model: "e2e-model",
    settings: { ...DEFAULTS, model: "e2e-model" },
    ignore: null,
    defaultBranch: "main",
    branch: "codeman/12-add-a-health-route",
    branchExists: false,
    baseSha: "abc",
    planPath: "docs/plans/2026-10-20-add-a-health-route.md",
    record: null,
    replan: [],
    settled: [],
    statusCommentId: null,
    runUrl: "https://github.com/acme/app/actions/runs/1",
  };
}

/** The task file of a stage, as the agent job writes it: each call has a new nonce. */
export function taskFile(scenario: string, issue: string, stage: "plan" | "route" | RoutedStage) {
  const context = task(scenario, issue);
  if (stage === "plan") return planPrompt(context, GITHUB);
  if (stage === "route") return routePrompt({ ...context, action: "route" }, GITHUB);
  return stagePrompt({ ...context, action: "implement", stage }, 45, GITHUB);
}

/** What OpenCode's read tool returns for a file (tool/read.ts): numbered lines. */
export function readResult(path: string, text: string): string {
  const lines = text.split("\n");
  return [
    `<path>${path}</path>`,
    "<type>file</type>",
    "<content>",
    lines.map((line, index) => `${index + 1}: ${line}`).join("\n"),
    "",
    `(End of file - total ${lines.length} lines)`,
    "</content>",
  ].join("\n");
}

/** A reply as a client puts it together. */
export interface Received {
  content: string;
  calls: ToolCall[];
  finish: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number } | undefined;
}

/** One request to the model, by whatever path. */
export type Send = (request: ChatRequest) => Promise<Received>;

/**
 * An OpenAI-style accumulator, as the AI SDK's: a tool call's first delta of an index has its
 * id and name, later ones add to its arguments.
 */
export function accumulate(events: readonly string[]): Received {
  const received: Received = { content: "", calls: [], finish: null };
  for (const data of events) {
    if (data === "[DONE]") break;
    // biome-ignore lint/suspicious/noExplicitAny: an SSE event's JSON, read field by field.
    const event = JSON.parse(data) as any;
    if (event.usage) received.usage = event.usage;
    const choice = event.choices?.[0];
    if (!choice) continue;
    if (choice.delta?.content) received.content += choice.delta.content;
    for (const part of choice.delta?.tool_calls ?? []) {
      const known = received.calls[part.index];
      if (!known) {
        if (!part.id || !part.function?.name) throw new Error("A new tool call needs id and name.");
        received.calls[part.index] = {
          id: part.id,
          type: "function",
          function: { name: part.function.name, arguments: part.function.arguments ?? "" },
        };
      } else known.function.arguments += part.function?.arguments ?? "";
    }
    if (choice.finish_reason) received.finish = choice.finish_reason;
  }
  return received;
}

/** The `data:` of each event of an SSE text. */
export function sseEvents(text: string): string[] {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice("data: ".length));
}

/**
 * Plays OpenCode's loop: sends the conversation, runs each tool call (the task file's read
 * answers with `file`), and stops at a reply without one, or after `max` requests.
 */
export class Session {
  readonly messages: ChatMessage[];
  readonly calls: ToolCall[] = [];
  readonly replies: Received[] = [];
  readonly #file: string;
  readonly #tools: ReturnType<typeof tools>;

  constructor(file: string, toolNames: readonly string[] = TOOL_NAMES) {
    this.#file = file;
    this.#tools = tools(toolNames);
    this.messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: HARNESS_PROMPT },
    ];
  }

  request(stream = true): ChatRequest {
    return {
      model: "e2e-model",
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      messages: structuredClone(this.messages),
      tools: this.#tools,
    };
  }

  /** Sends until a reply has no tool call; returns the tool calls made. */
  async run(send: Send, max = 20): Promise<ToolCall[]> {
    const start = this.calls.length;
    for (let count = 0; count < max; count++) {
      if ((await this.step(send)).calls.length === 0) return this.calls.slice(start);
    }
    throw new Error(`No final answer after ${max} requests.`);
  }

  /** Sends once, and runs the reply's tool calls. */
  async step(send: Send): Promise<Received> {
    const received = await send(this.request());
    this.replies.push(received);
    if (received.calls.length === 0) {
      this.messages.push({ role: "assistant", content: received.content });
      return received;
    }
    this.messages.push({ role: "assistant", content: null, tool_calls: received.calls });
    for (const call of received.calls) {
      this.calls.push(call);
      this.messages.push({ role: "tool", tool_call_id: call.id, content: this.#result(call) });
    }
    return received;
  }

  /** The fix pass: Codeman resumes the session with `prompt`. */
  resume(prompt: string): void {
    this.messages.push({ role: "user", content: prompt });
  }

  #result(call: ToolCall): string {
    const args = JSON.parse(call.function.arguments) as { filePath?: string };
    if (call.function.name === "read" && args.filePath === `${WORKDIR}/${TASK_FILE}`) {
      return readResult(args.filePath, this.#file);
    }
    if (call.function.name === "write") return "Wrote file successfully.";
    if (call.function.name === "edit") return "Edit applied successfully.";
    return "";
  }
}
