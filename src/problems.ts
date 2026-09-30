import type { SettingName } from "./settings.ts";

/** Why a `/codeman` command could not be applied. Rendered in the task's language. */
export type CommandProblem =
  | { kind: "takes-no-arguments"; command: "approve" | "accept-workflows" }
  | { kind: "unknown-command" }
  | { kind: "not-in-description" }
  | { kind: "answer-needs-number" }
  | { kind: "answer-needs-text" }
  | { kind: "decide-needs-answers" }
  | { kind: "not-an-answer"; arg: string }
  | { kind: "set-which"; names: readonly string[] }
  | { kind: "set-one-value"; name: SettingName }
  | {
      kind: "invalid-setting";
      name: SettingName;
      type: "model" | "language" | "number" | "integer";
    }
  | { kind: "text-too-long"; max: number }
  | { kind: "no-decision"; id: number }
  | { kind: "no-option"; id: number; option: string };

/** A problem with one command, and the command's text when there is one. */
export interface CommandError {
  text?: string | undefined;
  problem: CommandProblem;
}
