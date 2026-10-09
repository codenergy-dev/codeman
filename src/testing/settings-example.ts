import { readFileSync } from "node:fs";

/**
 * The responsible person's example of the plan for profiles that pick the tasks, as the
 * "Example" section of docs/settings/profiles.md shows it, so the docs and the tests agree.
 */
export function exampleSettings(): string {
  const page = readFileSync("docs/settings/profiles.md", "utf8");
  const example = /^## Example\n[\s\S]*?```yaml\n([\s\S]*?)```/m.exec(page)?.[1];
  if (!example) throw new Error("docs/settings/profiles.md has no example.");
  return example;
}
