import type { Harness } from "./harness.ts";
import { openCode } from "./opencode.ts";

/** Harnesses the agent job can run, by the name given in the `harness` input. */
export const harnesses: Record<string, Harness> = { [openCode.name]: openCode };
