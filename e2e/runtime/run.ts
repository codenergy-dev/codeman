import { setTimeout as sleep } from "node:timers/promises";
import type { Store, Value } from "../../src/store/store.ts";
import type { Act } from "../fakes/github/github.ts";
import type { GitHubEvent } from "../fakes/github/world.ts";
import { marker } from "../fakes/llm/script.ts";
import { type CheckContext, check, describe, taskBranch, taskPull, violations } from "./expect.ts";
import type { Fakes } from "./fakes.ts";
import type { JobFault } from "./faults.ts";
import type { DispatchRecord, RemoteGitHub } from "./github.ts";
import type { Timeline } from "./report.ts";
import {
  type Action,
  type Expectation,
  type Fault,
  RelativeTime,
  type Scenario,
  type Target,
} from "./scenario/schema.ts";
import type { RunResult, SimRun, Simulator } from "./simulator/simulator.ts";
import type { BuiltWorld } from "./world.ts";

/**
 * Runs a scenario's actions in order, against the fakes and the simulator: users' actions on the
 * fake GitHub, `run` and `advance` through the simulator, `parallel` branches at once, faults on
 * the fakes and the jobs, and `wait` and `expect`, which poll until their checks hold or time
 * runs out. A failing action throws a `ScenarioFailure` with what did not hold.
 */

export class ScenarioFailure extends Error {}

/** What `expect` waits for its checks, to absorb a fake's lag. */
export const EXPECT_TIMEOUT_MS = 15_000;
const POLL_MS = 500;

/** The infrastructure's own turns, which only the session can take. */
export interface Infrastructure {
  /** Takes Firestore's emulator off the jobs network, or back. */
  firestore(down: boolean): Promise<void>;
}

export interface RunContext {
  scenario: Scenario;
  github: RemoteGitHub;
  fakes: Fakes;
  store: Store;
  simulator: Simulator;
  world: BuiltWorld;
  timeline: Timeline;
  /** The job faults the executor applies; actions add to it. */
  jobFaults: JobFault[];
  infrastructure?: Infrastructure;
  engine?: CheckContext["engine"];
  /** How long `expect` polls; `EXPECT_TIMEOUT_MS` by default. */
  expectTimeoutMs?: number;
  now?: () => number;
}

export class ScenarioRun {
  readonly context: RunContext;
  readonly issues = new Map<string, { repo: string; number: number }>();
  readonly pods = new Map<string, string>();
  /** The last event and dispatch each repository's `run` or `advance` took up. */
  readonly #eventCursor = new Map<string, number>();
  readonly #dispatchCursor = new Map<string, number>();
  /**
   * When the runtime first saw each event (`e<id>`) and dispatch (`d<id>`): the fake stamps them
   * to the second, so a run's dispatch and the comment a scenario makes next can tie. What a run
   * made is seen when it ends, before any later action, so this order keeps cause before effect.
   */
  readonly #seen = new Map<string, number>();
  #sequence = 0;
  readonly results: RunResult[] = [];
  #runpodFaults: Record<string, unknown> = {};
  #googleFaults: Record<string, unknown> = {};

  constructor(context: RunContext) {
    this.context = context;
  }

  async runAll(actions: readonly Action[]): Promise<void> {
    for (const [index, action] of actions.entries()) {
      this.context.timeline.add("action", `${index + 1}. ${summary(action)}`);
      await this.action(action);
    }
  }

  async action(action: Action): Promise<void> {
    const { github } = this.context;
    switch (action.kind) {
      case "open-issue": {
        const body = `${action.body ? `${action.body}\n\n` : ""}${marker(this.context.scenario.id, action.ref)}`;
        await this.#observe();
        const result = await github.act({
          action: "open-issue",
          as: action.as,
          repository: action.repo,
          title: action.title,
          body,
          labels: action.labels,
        });
        this.issues.set(action.ref, { repo: action.repo, number: Number(result.result) });
        await this.#observe();
        this.#events(result.events);
        return;
      }
      case "comment":
        return this.#act(action.repo, action.as, {
          action: "comment",
          issue: await this.#number(action),
          body: action.body,
        });
      case "label":
      case "unlabel":
        return this.#act(action.repo, action.as, {
          action: action.kind,
          issue: await this.#number(action),
          label: action.label,
        });
      case "close":
      case "reopen":
        return this.#act(action.repo, action.as, {
          action: action.kind,
          issue: await this.#number(action),
        });
      case "review": {
        const pull = await this.#number({ issue: action.pull, pull: true });
        return this.#act(action.repo, action.as, {
          action: "review",
          pull,
          state: action.state,
          ...(action.body !== undefined ? { body: action.body } : {}),
          comments: action.comments.map((comment) => ({
            path: comment.path,
            body: comment.body,
            ...(comment.line !== undefined ? { line: comment.line } : {}),
          })),
        });
      }
      case "push": {
        let branch: string;
        if ("name" in action.branch) branch = action.branch.name;
        else {
          const issue = this.#issue(action.branch.task);
          const found = await taskBranch(github, issue.repo, issue.number);
          if (!found)
            throw new ScenarioFailure(`push: ${action.branch.task} has no task branch yet.`);
          branch = found;
        }
        return this.#act(action.repo, action.as, {
          action: "push",
          branch,
          files: action.files,
          ...(action.message !== undefined ? { message: action.message } : {}),
          ...(action.base !== undefined ? { base: action.base } : {}),
          force: action.force,
          ...(action.ageMs > 0 ? { date: new Date(Date.now() - action.ageMs).toISOString() } : {}),
        });
      }
      case "set-variable": {
        const { world } = this.context;
        const [map, key] =
          "org" in action.scope
            ? [world.orgVariables, action.scope.org.toLowerCase()]
            : [world.repoVariables, action.scope.repo.toLowerCase()];
        const variables = { ...map.get(key) };
        if (action.value === null) delete variables[action.name];
        else variables[action.name] = action.value;
        map.set(key, variables);
        return;
      }
      case "seed": {
        const now = (this.context.now ?? Date.now)();
        await this.context.store.write([
          {
            op: "set",
            path: action.doc,
            fields: materialize(action.data, now) as Record<string, Value>,
          },
        ]);
        return;
      }
      case "run":
        return this.#run(action.repo, action.event, action.inputs, action.maxRuns);
      case "advance":
        return this.#advance(action.repo, action.until, action.maxRuns);
      case "parallel": {
        const outcomes = await Promise.allSettled(
          action.branches.map((branch) => this.runAll(branch)),
        );
        const failed = outcomes.find((outcome) => outcome.status === "rejected");
        if (failed) throw (failed as PromiseRejectedResult).reason;
        return;
      }
      case "fault":
        return this.#fault(action);
      case "apply":
        // skip: the run is cancelled as apply reaches Codeman's step, so the work is not applied.
        this.context.jobFaults.push({
          job: "apply",
          issue: action.issue ? this.#issue(action.issue).number : undefined,
          conclusion: action.mode === "skip" ? "cancelled" : "failure",
          times: undefined,
        });
        return;
      case "wait":
        if (!action.until) {
          await new Promise((resolve) => setTimeout(resolve, action.timeoutMs));
          return;
        }
        return this.#poll(
          action.until,
          action.timeoutMs,
          `wait: after ${action.timeoutMs / 1000}s,`,
        );
      case "expect":
        return this.#poll(action, this.context.expectTimeoutMs ?? EXPECT_TIMEOUT_MS, "expect:");
    }
  }

  /** The implicit check at a scenario's end: no fake recorded a violation. */
  async finish(): Promise<void> {
    await this.context.github.flush();
    const problems = await violations(this.context);
    if (problems.length > 0) {
      throw new ScenarioFailure(
        `At the scenario's end:\n${problems.map((one) => `- ${one}`).join("\n")}`,
      );
    }
  }

  checkContext(): CheckContext {
    return {
      github: this.context.github,
      fakes: this.context.fakes,
      store: this.context.store,
      issues: this.issues,
      pods: this.pods,
      ...(this.context.engine ? { engine: this.context.engine } : {}),
    };
  }

  async #poll(expectation: Expectation, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const problems = await check(expectation, this.checkContext());
      if (problems.length === 0) {
        this.context.timeline.add("expect", `holds: ${describe(expectation)}`);
        return;
      }
      if (Date.now() >= deadline) {
        this.context.timeline.add("expect", `fails: ${problems.join(" ")}`);
        throw new ScenarioFailure(
          `${what} ${describe(expectation)}\n${problems.map((one) => `- ${one}`).join("\n")}`,
        );
      }
      await sleep(POLL_MS);
    }
  }

  async #act(
    repository: string,
    as: string,
    act: Omit<Act, "as" | "repository"> & Record<string, unknown>,
  ) {
    await this.#observe();
    const result = await this.context.github.act({ ...act, as, repository } as Act);
    await this.#observe();
    this.#events(result.events);
  }

  /** Stamps the events and dispatches not seen yet, in the fake's order. */
  async #observe(): Promise<void> {
    const { github } = this.context;
    const fresh = [
      ...(await github.events(0)).map((event) => ({
        key: `e${event.id}`,
        at: event.at,
        kind: 0,
        id: event.id,
      })),
      ...(await github.dispatches(0)).map((dispatch) => ({
        key: `d${dispatch.id}`,
        at: dispatch.at,
        kind: 1,
        id: dispatch.id,
      })),
    ]
      .filter((item) => !this.#seen.has(item.key))
      .sort((a, b) => a.at.localeCompare(b.at) || a.kind - b.kind || a.id - b.id);
    for (const item of fresh) this.#seen.set(item.key, ++this.#sequence);
  }

  #events(events: GitHubEvent[]): void {
    for (const event of events) {
      const action = typeof event.payload.action === "string" ? `.${event.payload.action}` : "";
      this.context.timeline.add(
        "event",
        `${event.repository} ${event.name}${action} #${event.id}${event.triggers ? "" : " (no trigger)"}`,
      );
    }
  }

  #issue(ref: string): { repo: string; number: number } {
    const issue = this.issues.get(ref);
    if (!issue) throw new ScenarioFailure(`No issue ${ref} was opened.`);
    return issue;
  }

  /** An issue's number, or its task's pull request's. */
  async #number(target: Target): Promise<number> {
    const issue = this.#issue(target.issue);
    if (!target.pull) return issue.number;
    const pull = taskPull(await this.context.github.issues(issue.repo), issue.number);
    if (!pull) throw new ScenarioFailure(`${target.issue} has no pull request yet.`);
    return pull.number;
  }

  /**
   * One run for an event, awaited, then the chain it starts: on GitHub a run's `next-run` and
   * `dispatch`, and what Codeman's App does on the issues, start their runs at once, before any
   * user acts again. So the dispatches and the App's events since the run began run too, until
   * none is left, within `maxRuns`. Users' events wait for an `advance`.
   */
  async #run(
    repository: string,
    event: string,
    inputs: Record<string, string>,
    maxRuns: number,
  ): Promise<void> {
    const { simulator, github, timeline } = this.context;
    await this.#observe();
    const since = this.#sequence;
    let runs: SimRun[];
    if (event === "schedule") runs = await simulator.schedule(repository);
    else if (event === "workflow_dispatch") {
      const info = github.repository(repository);
      const actor = this.#maintainer(repository);
      runs = [
        await simulator.start({
          repository,
          workflow: ".github/workflows/codeman.yml",
          event,
          inputs,
          actor,
          payload: {
            inputs,
            ref: `refs/heads/${info.defaultBranch}`,
            workflow: ".github/workflows/codeman.yml",
            sender: { login: actor },
          },
        }),
      ];
    } else {
      const [name, action] = event.split(".");
      const events = await github.events(0, repository);
      const found = events
        .filter((one) => one.name === name && one.payload.action === action)
        .at(-1);
      if (!found) throw new ScenarioFailure(`run: ${repository} has no ${event} event.`);
      this.#eventCursor.set(
        key(repository),
        Math.max(this.#eventCursor.get(key(repository)) ?? 0, found.id),
      );
      timeline.add("run", `${event} #${found.id} on ${repository}`);
      runs = await simulator.trigger({
        name: found.name,
        repository,
        payload: found.payload,
        triggers: found.triggers,
      });
    }
    await this.#settle(runs);
    const users = new Set(this.context.scenario.world.users.map((login) => login.toLowerCase()));
    const caused = (item: Pending) =>
      (this.#seen.get(item.key) ?? 0) > since &&
      (item.kind === "dispatch" || !users.has(sender(item.event).toLowerCase()));
    let counted = 0;
    for (;;) {
      const pending = (await this.#pending(repository)).filter(caused);
      if (pending.length === 0) {
        if (counted > 0) timeline.add("run", `its chain ended after ${counted} more runs`);
        return;
      }
      if (counted >= maxRuns) {
        throw new ScenarioFailure(
          `run: ${event}'s chain on ${repository} still runs after ${counted} more runs (max-runs ${maxRuns}).`,
        );
      }
      const results = await this.#settle(await this.#start(repository, pending));
      counted += results.filter((result) => result.conclusion !== "skipped").length;
    }
  }

  /** Starts the runs of pending events and dispatches, moving the cursors past them. */
  async #start(repository: string, pending: Pending[]): Promise<SimRun[]> {
    const { simulator, github, timeline } = this.context;
    const runs: SimRun[] = [];
    for (const item of pending) {
      if (item.kind === "event") {
        const event = item.event;
        this.#eventCursor.set(
          key(repository),
          Math.max(this.#eventCursor.get(key(repository)) ?? 0, event.id),
        );
        runs.push(
          ...(await simulator.trigger({
            name: event.name,
            repository,
            payload: event.payload,
            triggers: event.triggers,
          })),
        );
      } else {
        this.#dispatchCursor.set(
          key(repository),
          Math.max(this.#dispatchCursor.get(key(repository)) ?? 0, item.dispatch.id),
        );
        timeline.add(
          "dispatch",
          `${item.dispatch.workflow} by ${item.dispatch.sender}, run ${item.dispatch.runId}`,
        );
        runs.push(await simulator.dispatched(await github.dispatched(item.dispatch)));
      }
    }
    return runs;
  }

  /** Runs the repository's events and dispatches not run yet, until `until` holds. */
  async #advance(repository: string, until: Expectation, maxRuns: number): Promise<void> {
    const { timeline } = this.context;
    let counted = 0;
    for (;;) {
      const problems = await check(until, this.checkContext());
      if (problems.length === 0) {
        timeline.add("advance", `holds after ${counted} runs: ${describe(until)}`);
        return;
      }
      if (counted >= maxRuns) {
        throw new ScenarioFailure(
          `advance: after ${counted} runs (max-runs ${maxRuns}), ${describe(until)} does not hold:\n${problems.map((one) => `- ${one}`).join("\n")}`,
        );
      }
      const pending = await this.#pending(repository);
      if (pending.length === 0) {
        throw new ScenarioFailure(
          `advance: nothing left to run on ${repository} after ${counted} runs, and ${describe(until)} does not hold:\n${problems.map((one) => `- ${one}`).join("\n")}`,
        );
      }
      const results = await this.#settle(await this.#start(repository, pending));
      counted += results.filter((result) => result.conclusion !== "skipped").length;
    }
  }

  /** Events that start workflows and dispatches, after the cursors, oldest first. */
  async #pending(repository: string): Promise<Pending[]> {
    const { github } = this.context;
    await this.#observe();
    const events = (
      await github.events(this.#eventCursor.get(key(repository)) ?? 0, repository)
    ).filter((event) => event.triggers && event.name !== "workflow_dispatch");
    const dispatches = (
      await github.dispatches(this.#dispatchCursor.get(key(repository)) ?? 0)
    ).filter((dispatch) => dispatch.repository.toLowerCase() === key(repository));
    const all = [
      ...events.map((event) => ({
        kind: "event" as const,
        event,
        at: event.at,
        key: `e${event.id}`,
      })),
      ...dispatches.map((dispatch) => ({
        kind: "dispatch" as const,
        dispatch,
        at: dispatch.at,
        key: `d${dispatch.id}`,
      })),
    ];
    const order = (item: { key: string }) => this.#seen.get(item.key) ?? Number.POSITIVE_INFINITY;
    return all.sort((a, b) => order(a) - order(b));
  }

  /** Waits for the runs, records them, and fails on a run the simulator could not run. */
  async #settle(runs: SimRun[]): Promise<RunResult[]> {
    const settled = await Promise.allSettled(runs.map((run) => run.finished));
    await this.context.github.flush();
    const results: RunResult[] = [];
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        throw new ScenarioFailure(
          `The simulator could not run a workflow: ${(outcome.reason as Error)?.message ?? outcome.reason}`,
        );
      }
      results.push(outcome.value);
      this.results.push(outcome.value);
    }
    await this.#observe();
    return results;
  }

  async #fault(fault: Fault): Promise<void> {
    const { fakes } = this.context;
    switch (fault.target) {
      case "http": {
        const http = fault.http;
        await fakes[fault.fake].control("POST", "/faults", {
          body: {
            path: http.path,
            ...(http.method ? { method: http.method } : {}),
            ...(http.status !== undefined ? { status: http.status } : {}),
            ...(http.body !== undefined ? { body: http.body } : {}),
            ...(http.delayMs !== undefined ? { delayMs: http.delayMs } : {}),
            ...(http.drop ? { drop: true } : {}),
            ...(http.times !== undefined ? { times: http.times } : {}),
          },
        });
        return;
      }
      case "runpod":
        this.#runpodFaults = { ...this.#runpodFaults, ...fault.runpod };
        await fakes.runpod.json("PUT", "/runpod/faults", this.#runpodFaults);
        return;
      case "google":
        this.#googleFaults = { ...this.#googleFaults, ...fault.google };
        await fakes.google.json("PUT", "/google/faults", this.#googleFaults);
        return;
      case "openrouter":
        await fakes.openrouter.json("PUT", "/openrouter/lags", fault.openrouter.lags);
        return;
      case "pod": {
        const id = this.pods.get(fault.pod);
        if (!id) throw new ScenarioFailure(`fault: no pod ${fault.pod}.`);
        await fakes.runpod.control("POST", `/runpod/pods/${id}/${fault.action}`);
        return;
      }
      case "job":
        this.context.jobFaults.push({
          job: fault.job,
          issue: fault.issue ? this.#issue(fault.issue).number : undefined,
          conclusion: fault.conclusion,
          times: fault.times,
        });
        return;
      case "firestore":
        if (!this.context.infrastructure)
          throw new ScenarioFailure("fault: Firestore is not the runtime's here.");
        await this.context.infrastructure.firestore(fault.down);
        return;
      case "clear":
        for (const name of fault.fakes) {
          await fakes[name].control("DELETE", "/faults");
          if (name === "runpod") {
            this.#runpodFaults = {};
            await fakes.runpod.json("PUT", "/runpod/faults", {});
          }
          if (name === "google") {
            this.#googleFaults = {};
            await fakes.google.json("PUT", "/google/faults", {});
          }
        }
        return;
    }
  }

  #maintainer(repository: string): string {
    const found = this.context.scenario.world.repositories.find(
      (one) => one.name.toLowerCase() === repository.toLowerCase(),
    );
    return found?.maintainers[0] ?? this.context.scenario.world.users[0] ?? "github-actions[bot]";
  }
}

/** An event or a dispatch not run yet, with its key in `#seen`. */
type Pending =
  | { kind: "event"; event: GitHubEvent; at: string; key: string }
  | { kind: "dispatch"; dispatch: DispatchRecord; at: string; key: string };

function sender(event: GitHubEvent): string {
  return String((event.payload.sender as { login?: unknown } | undefined)?.login ?? "");
}

function key(repository: string): string {
  return repository.toLowerCase();
}

/** Seed data with its relative times as dates. */
export function materialize(value: unknown, now: number): unknown {
  if (value instanceof RelativeTime) return value.at(now);
  if (Array.isArray(value)) return value.map((item) => materialize(item, now));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, materialize(item, now)]),
    );
  }
  return value;
}

/** An action in one line, for the timeline. */
export function summary(action: Action): string {
  switch (action.kind) {
    case "open-issue":
      return `open-issue ${action.ref} by ${action.as}: ${action.title}`;
    case "comment":
      return `comment on ${action.issue}${action.pull ? "'s pull request" : ""} by ${action.as}: ${action.body}`;
    case "label":
    case "unlabel":
      return `${action.kind} ${action.label} on ${action.issue} by ${action.as}`;
    case "close":
    case "reopen":
      return `${action.kind} ${action.issue} by ${action.as}`;
    case "review":
      return `review ${action.state} of ${action.pull} by ${action.as}`;
    case "push":
      return `push to ${"name" in action.branch ? action.branch.name : `${action.branch.task}'s branch`} by ${action.as}`;
    case "set-variable":
      return `set-variable ${action.name} on ${"org" in action.scope ? action.scope.org : action.scope.repo}`;
    case "seed":
      return `seed ${action.doc}`;
    case "run":
      return `run ${action.event} on ${action.repo}`;
    case "advance":
      return `advance ${action.repo} until ${describe(action.until)} (max-runs ${action.maxRuns})`;
    case "parallel":
      return `parallel, ${action.branches.length} branches`;
    case "fault":
      return `fault on ${action.target}`;
    case "apply":
      return `apply ${action.mode}`;
    case "wait":
      return action.until
        ? `wait until ${describe(action.until)}`
        : `wait for ${action.timeoutMs / 1000}s`;
    case "expect":
      return `expect ${describe(action)}`;
  }
}
