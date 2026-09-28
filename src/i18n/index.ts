import { en } from "./en.ts";
import type { Messages } from "./messages.ts";
import { ptBR } from "./pt-BR.ts";

export type { Messages } from "./messages.ts";

/** Catalogs by language tag, in lower case. A base language (`pt`) stands for its variants. */
const CATALOGS: Readonly<Record<string, Messages>> = {
  en,
  pt: ptBR,
  "pt-br": ptBR,
};

/** The catalog for a language tag: the exact one, else its base language's, else English. */
export function messages(tag: string | undefined): Messages {
  const lower = (tag ?? "en").toLowerCase();
  return CATALOGS[lower] ?? CATALOGS[lower.split("-")[0] ?? ""] ?? en;
}

/**
 * The task's language: the one the settings name, or with `auto`, the one the planning agent
 * reported. English until the task has one.
 */
export function taskLanguage(setting: string, recorded: string | undefined): string {
  return setting !== "auto" ? setting : (recorded ?? "en");
}

/** The language's name in English, for prompts: `pt-BR` → `Brazilian Portuguese`. */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
