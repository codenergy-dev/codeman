import { readFileSync } from "node:fs";
import { FakeServer, HttpError, json } from "../http.ts";
import type { ChatRequest } from "../openrouter/chat.ts";
import { ScriptedModel } from "./model.ts";
import { modelList, reply, sendReply } from "./openai.ts";
import { isScenarioName, type Script, scriptOf } from "./script.ts";

/**
 * The scripted model as an OpenAI-compatible server for the e2e suite: `POST
 * /v1/chat/completions` and `GET /v1/models`, as vLLM and Ollama serve them behind the gateway.
 * The gateway calls Ollama's native `/api/*` routes only to load the model, which the tee
 * forwards to the real engine, so this server has none.
 *
 * Control API, under `/_fake/llm`:
 *
 * - `PUT /scripts/{scenario}`: a scenario's `agent:` section, as JSON (script.ts);
 * - `GET /scripts`, `DELETE /scripts/{scenario}`;
 * - `GET /turns`: each request, with the scenario, issue, stage, round, phase and turn it was
 *   taken for, and the tool call it got;
 * - `GET /violations`: the requests no script covered, which got an error.
 *
 * `POST /_fake/reset` forgets the scripts loaded through the API, the rounds and the logs; the
 * scripts of `FAKE_LLM_SCRIPTS` stay.
 */

export interface LlmSetup {
  /** What `/v1/models` lists: `e2e-model` by default. */
  models?: readonly string[];
  /** Scripts by scenario, kept across resets. */
  scripts?: Record<string, unknown>;
}

export class LlmFake {
  readonly server: FakeServer;
  readonly model: ScriptedModel;
  readonly models: readonly string[];
  readonly #defaults: Record<string, Script>;

  constructor(setup: LlmSetup = {}, options: { now?: () => number } = {}) {
    this.models = setup.models?.length ? setup.models : ["e2e-model"];
    this.model = new ScriptedModel(options);
    this.#defaults = {};
    for (const [scenario, script] of Object.entries(setup.scripts ?? {})) {
      this.#defaults[checkName(scenario)] = scriptOf(script);
    }
    this.#loadDefaults();
    const server = new FakeServer("llm");
    this.server = server;

    server.route("POST", "/v1/chat/completions", async (request, response) => {
      const body = request.json() as ChatRequest;
      const abort = new AbortController();
      response.once("close", () => abort.abort());
      await sendReply(response, reply(this.model, body, "openai", abort.signal));
      return undefined;
    });
    server.route("GET", "/v1/models", () => json(modelList(this.models)));

    server.control("PUT", "/llm/scripts/{scenario*}", (request) => {
      this.model.load(checkName(request.params.scenario ?? ""), scriptOf(request.json()));
      return { status: 204 };
    });
    server.control("GET", "/llm/scripts", () => json(this.model.scripts()));
    server.control("DELETE", "/llm/scripts/{scenario*}", (request) =>
      this.model.unload(request.params.scenario ?? "")
        ? { status: 204 }
        : json({ message: "No such script." }, 404),
    );
    server.control("GET", "/llm/turns", () => json(this.model.turns));
    server.control("GET", "/llm/violations", () => json(this.model.violations));
    server.onReset(() => {
      this.model.reset();
      this.#loadDefaults();
    });
  }

  #loadDefaults(): void {
    for (const [scenario, script] of Object.entries(this.#defaults)) {
      this.model.load(scenario, script);
    }
  }
}

function checkName(scenario: string): string {
  if (!isScenarioName(scenario)) {
    throw new HttpError(400, {
      message: `"${scenario}" is not a scenario name: letters, digits, '.', '_', '-' and '/'.`,
    });
  }
  return scenario;
}

/**
 * The fake from the environment: `FAKE_LLM_SCRIPTS`, a JSON file of scripts by scenario, and
 * `FAKE_LLM_MODELS`, the model names `/v1/models` lists, separated by commas.
 */
export function fromEnv(env: NodeJS.ProcessEnv): FakeServer {
  const models = (env.FAKE_LLM_MODELS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  let scripts: Record<string, unknown> = {};
  if (env.FAKE_LLM_SCRIPTS) {
    const value: unknown = JSON.parse(readFileSync(env.FAKE_LLM_SCRIPTS, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("FAKE_LLM_SCRIPTS must hold an object of scripts by scenario.");
    }
    scripts = value as Record<string, unknown>;
  }
  try {
    return new LlmFake({ models, scripts }).server;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    throw new Error(`FAKE_LLM_SCRIPTS: ${(error.body as { message: string }).message}`);
  }
}
