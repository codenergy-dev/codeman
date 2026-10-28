import { createHash } from "node:crypto";
import { posix } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { OUTPUT_FILE, TASK_FILE } from "../../../src/prompt.ts";
import type { Stage } from "../../../src/stages.ts";
import {
  type ChatChunk,
  type ChatRequest,
  estimateTokens,
  type Tokens,
} from "../openrouter/chat.ts";
import { type Identified, identify, type Phase } from "./identify.ts";
import type { Action, Round, Script, Turn, Usage } from "./script.ts";

/**
 * The scripted model: it answers each chat request with the next turn of its scenario's script,
 * as OpenAI-style chunks (`ChatChunk`, the fake OpenRouter's), whatever the transport: the
 * scripted model's own server, the fake OpenRouter, the fake Runpod queue, or the tee.
 *
 * Each turn is one tool call, with OpenCode 1.18.32's tool names and arguments
 * (docs/web/opencode/opencode-packages-opencode-src-tool-*.md): `read`, `write`, `edit` and
 * `bash`. After the last step, a text answer ends OpenCode's loop. A request the script does not
 * cover gets an error, and is recorded as a violation.
 */

/** Where a request came from, for the log. */
export type Via = "openai" | "openrouter" | "queue" | "tee";

/** One request the model answered, with what it took the request for. */
export interface TurnLog {
  at: number;
  via: Via;
  model: string;
  stream: boolean;
  /** `start` reads the task file; `step` plays a step; `final` ends the round's loop. */
  kind: "start" | "step" | "final" | "title" | "unscripted";
  scenario?: string;
  issue?: string;
  stage?: Stage;
  /** The run of the stage for this issue, from 0, in the order the model saw them. */
  round?: number;
  phase?: Phase;
  turn?: number;
  step?: Action["kind"];
  /** The tool call it made. */
  call?: { id: string; name: string; arguments: Record<string, unknown> };
  /** What the previous tool call returned, cut to 2,000 characters. */
  lastResult?: string;
  violation?: string;
}

export interface Violation {
  at: number;
  via: Via;
  reason: string;
  scenario?: string;
  issue?: string;
  stage?: Stage;
  round?: number;
  phase?: Phase;
  turn?: number;
}

/** What the model answers: an error before the reply starts, or the reply's chunks. */
export type Answer =
  | { log: TurnLog; error: { status: number; message: string } }
  | { log: TurnLog; chunks: AsyncIterable<ChatChunk> };

/** Thrown by a reply's chunks when the connection must drop: an `exit` step, or a released hang. */
export class AbruptEnd extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AbruptEnd";
  }
}

/** The final answer of OpenCode's title request. */
const TITLE = "E2E task";
/** How long the arguments' pieces are in a stream. */
const PIECE = 48;
/** How often a hanging reply checks whether its client left. */
const HEARTBEAT_MS = 200;
const RESULT_CHARS = 2000;

export class ScriptedModel {
  readonly turns: TurnLog[] = [];
  readonly violations: Violation[] = [];
  readonly #scripts = new Map<string, Script>();
  /** The runs seen per scenario, issue and stage: a run's index is its round. */
  readonly #runs = new Map<string, string[]>();
  #release = new AbortController();
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  load(scenario: string, script: Script): void {
    this.#scripts.set(scenario, script);
  }

  unload(scenario: string): boolean {
    return this.#scripts.delete(scenario);
  }

  scripts(): Record<string, Script> {
    return Object.fromEntries(this.#scripts);
  }

  /** Forgets the scripts, rounds and logs, and ends every hanging reply. */
  reset(): void {
    this.#scripts.clear();
    this.#runs.clear();
    this.turns.length = 0;
    this.violations.length = 0;
    this.#release.abort();
    this.#release = new AbortController();
  }

  /** The answer to `request`; `signal` ends a hanging reply when the client leaves. */
  answer(request: ChatRequest, via: Via, signal?: AbortSignal): Answer {
    const log: TurnLog = {
      at: this.#now(),
      via,
      model: request.model,
      stream: request.stream === true,
      kind: "unscripted",
    };
    this.turns.push(log);
    const found = identify(request);
    if (found.kind === "title") {
      log.kind = "title";
      return { log, chunks: this.#text(TITLE, undefined, 0, request, signal) };
    }
    if (found.kind === "unknown") return this.#violation(log, found.reason);
    if (found.kind === "start") {
      log.kind = "start";
      return this.#call(log, request, found.workdir, "call_e2e_task_file", {
        kind: "read",
        path: TASK_FILE,
      });
    }
    const round = this.#round(found);
    Object.assign(log, {
      scenario: found.scenario,
      issue: found.issue,
      stage: found.stage,
      round,
      phase: found.phase,
      turn: found.turn,
      ...(found.lastResult === undefined
        ? {}
        : { lastResult: found.lastResult.slice(0, RESULT_CHARS) }),
    });
    const script = this.#scripts.get(found.scenario);
    if (!script) return this.#violation(log, `No script for scenario "${found.scenario}".`);
    const rounds = script[found.issue]?.[found.stage];
    if (!rounds) {
      return this.#violation(log, `No ${found.stage} rounds for issue ${found.issue}.`);
    }
    const scripted: Round | undefined = rounds[round];
    if (!scripted) {
      return this.#violation(
        log,
        `Round ${round} of ${found.stage} is not scripted: issue ${found.issue} has ${rounds.length}.`,
      );
    }
    const turns =
      found.phase === "main"
        ? scripted.steps
        : found.phase === "fix"
          ? scripted.fix
          : scripted.wrapUp;
    if (!turns) {
      return this.#violation(log, `Round ${round} of ${found.stage} has no ${found.phase} steps.`);
    }
    // In the main phase and the wrap-up, turn 0 read the task file, so step i is turn i + 1.
    const index = found.phase === "fix" ? found.turn : found.turn - 1;
    const turn: Turn | undefined = turns[index];
    if (turn) {
      log.kind = "step";
      log.step = turn.action.kind;
      const id = callId(found.scenario, found.issue, found.stage, round, found.phase, found.turn);
      const usage = turn.usage ?? scripted.usage;
      return this.#play(log, request, found.workdir, id, turn, usage, signal);
    }
    if (index === turns.length) {
      log.kind = "final";
      const [usage, delayMs] =
        found.phase === "main"
          ? [scripted.finalUsage, scripted.finalDelayMs]
          : found.phase === "fix"
            ? [scripted.fixFinalUsage, scripted.fixFinalDelayMs]
            : [scripted.wrapUpFinalUsage, scripted.wrapUpFinalDelayMs];
      return {
        log,
        chunks: this.#text(scripted.final, usage ?? scripted.usage, delayMs, request, signal),
      };
    }
    return this.#violation(log, "The conversation went on after the round's final answer.");
  }

  #round(found: Extract<Identified, { kind: "turn" }>): number {
    const key = `${found.scenario}\u0000${found.issue}\u0000${found.stage}`;
    const runs = this.#runs.get(key) ?? [];
    this.#runs.set(key, runs);
    let round = runs.indexOf(found.run);
    if (round < 0) round = runs.push(found.run) - 1;
    return round;
  }

  #violation(log: TurnLog, reason: string): Answer {
    log.kind = "unscripted";
    log.violation = reason;
    const { scenario, issue, stage, round, phase, turn } = log;
    this.violations.push({
      at: log.at,
      via: log.via,
      reason,
      ...defined({ scenario, issue, stage, round, phase, turn }),
    });
    return { log, error: { status: 400, message: `Unscripted request: ${reason}` } };
  }

  #play(
    log: TurnLog,
    request: ChatRequest,
    workdir: string | undefined,
    id: string,
    turn: Turn,
    usage: Usage | undefined,
    signal: AbortSignal | undefined,
  ): Answer {
    const action = turn.action;
    if (action.kind === "hang" || action.kind === "exit") {
      return { log, chunks: this.#broken(action.kind, turn.delayMs, signal) };
    }
    return this.#call(log, request, workdir, id, action, usage, turn.delayMs, signal);
  }

  #call(
    log: TurnLog,
    request: ChatRequest,
    workdir: string | undefined,
    id: string,
    action: Exclude<Action, { kind: "hang" | "exit" }>,
    usage?: Usage,
    delayMs = 0,
    signal?: AbortSignal,
  ): Answer {
    const [name, args] = toolCall(action, workdir);
    log.call = { id, name, arguments: args };
    if (!offers(request, name)) {
      return this.#violation(
        log,
        `The request offers no "${name}" tool. OpenCode gives models whose ID has "gpt-" apply_patch instead of edit and write.`,
      );
    }
    const text = JSON.stringify(args);
    const release = this.#release.signal;
    async function* chunks(): AsyncGenerator<ChatChunk> {
      await wait(delayMs, signal, release);
      yield {
        delta: {
          role: "assistant",
          tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "" } }],
        },
      };
      for (let at = 0; at < text.length; at += PIECE) {
        yield {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: text.slice(at, at + PIECE) } }],
          },
        };
      }
      yield { finish_reason: "tool_calls" };
      yield { usage: tokens(usage, request, text) };
    }
    return { log, chunks: chunks() };
  }

  async *#text(
    text: string,
    usage: Usage | undefined,
    delayMs: number,
    request: ChatRequest,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<ChatChunk> {
    await wait(delayMs, signal, this.#release.signal);
    const words = text.match(/\S+\s*/g) ?? [text];
    yield { delta: { role: "assistant", content: words[0] ?? "" } };
    for (const word of words.slice(1)) yield { delta: { content: word } };
    yield { finish_reason: "stop" };
    yield { usage: tokens(usage, request, text) };
  }

  /** A reply that starts, then never ends (`hang`) or drops (`exit`). */
  async *#broken(
    kind: "hang" | "exit",
    delayMs: number,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<ChatChunk> {
    const release = this.#release.signal;
    await wait(delayMs, signal, release);
    yield { delta: { role: "assistant", content: "Working" } };
    if (kind === "exit") throw new AbruptEnd("The script's exit step dropped the reply.");
    // Empty chunks send nothing, but let a transport see that its client left.
    while (!signal?.aborted) {
      if (release.aborted) throw new AbruptEnd("The model was reset during a hang.");
      await sleep(HEARTBEAT_MS);
      yield {};
    }
  }
}

/** The tool call OpenCode runs for an action: its tool's name and arguments. */
export function toolCall(
  action: Exclude<Action, { kind: "hang" | "exit" }>,
  workdir: string | undefined,
): [string, Record<string, unknown>] {
  const path = (file: string) =>
    workdir && !posix.isAbsolute(file) ? posix.join(workdir, file) : file;
  switch (action.kind) {
    // tool/write.ts: `content`, `filePath`.
    case "write":
      return ["write", { content: action.content, filePath: path(action.path) }];
    case "output":
      return [
        "write",
        { content: `${JSON.stringify(action.value, null, 2)}\n`, filePath: path(OUTPUT_FILE) },
      ];
    case "raw":
      return ["write", { content: action.text, filePath: path(OUTPUT_FILE) }];
    // tool/edit.ts: `filePath`, `oldString`, `newString`, optional `replaceAll`.
    case "edit":
      return [
        "edit",
        {
          filePath: path(action.path),
          oldString: action.old,
          newString: action.new,
          ...(action.all === undefined ? {} : { replaceAll: action.all }),
        },
      ];
    // tool/shell/prompt.ts: `command`, optional `timeout` and `workdir`; tool/shell/id.ts: "bash".
    case "bash":
      return [
        "bash",
        {
          command: action.command,
          ...(action.timeout === undefined ? {} : { timeout: action.timeout }),
          ...(action.workdir === undefined ? {} : { workdir: path(action.workdir) }),
        },
      ];
    // tool/read.ts: `filePath`, optional `offset` and `limit`.
    case "read":
      return [
        "read",
        {
          filePath: path(action.path),
          ...(action.offset === undefined ? {} : { offset: action.offset }),
          ...(action.limit === undefined ? {} : { limit: action.limit }),
        },
      ];
  }
}

/** A stable tool call ID: the same turn of the same script has the same one every time. */
export function callId(
  scenario: string,
  issue: string,
  stage: Stage,
  round: number,
  phase: Phase,
  turn: number,
): string {
  const key = [scenario, issue, stage, round, phase, turn].join("\u0000");
  return `call_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

/** Whether the request offers the tool `name`. */
function offers(request: ChatRequest, name: string): boolean {
  return (request.tools ?? []).some(
    (tool) =>
      typeof tool === "object" &&
      tool !== null &&
      (tool as { function?: { name?: unknown } }).function?.name === name,
  );
}

function tokens(usage: Usage | undefined, request: ChatRequest, text: string): Tokens {
  if (usage) {
    return {
      prompt_tokens: usage.prompt,
      completion_tokens: usage.completion,
      ...(usage.cached === undefined ? {} : { cached_tokens: usage.cached }),
    };
  }
  return {
    prompt_tokens: estimateTokens(JSON.stringify(request.messages)),
    completion_tokens: estimateTokens(text),
  };
}

/** Waits `ms`, or less if the client leaves or the model is reset. */
async function wait(ms: number, signal: AbortSignal | undefined, release: AbortSignal) {
  if (ms <= 0) return;
  await sleep(ms, undefined, {
    signal: AbortSignal.any([release, ...(signal ? [signal] : [])]),
  }).catch(() => {});
  if (release.aborted) throw new AbruptEnd("The model was reset during a delay.");
}

function defined<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
