import * as core from "@actions/core";
import { agent } from "./steps/agent.ts";
import { apply } from "./steps/apply.ts";
import { closeKey, openKey } from "./steps/keys.ts";
import { select } from "./steps/select.ts";

/** Each job of the Codeman workflow runs one step. See docs/architecture.md. */
const STEPS: Record<string, () => Promise<void>> = {
  select,
  "open-key": openKey,
  agent,
  apply,
  "close-key": closeKey,
};

export async function run(): Promise<void> {
  const name = core.getInput("step", { required: true });
  const step = STEPS[name];
  if (!step)
    throw new Error(`Unknown step "${name}". Use one of: ${Object.keys(STEPS).join(", ")}.`);
  await step();
}
