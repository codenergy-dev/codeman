import type { Manifest } from "./collect.ts";
import type { Parsed } from "./output.ts";

export const MAX_PLAN_BYTES = 256 * 1024;

/**
 * Checks a planning result: the plan must be one regular text file at the expected path. Other
 * changes are not applied; they are reported as ignored.
 */
export function checkPlanResult(
  manifest: unknown,
  planPath: string,
): Parsed<{ ignored: string[] }> {
  if (!isManifest(manifest)) return { ok: false, error: "The agent's manifest is malformed." };
  const plan = manifest.changes.find((change) => change.path === planPath);
  if (!plan || plan.status === "deleted") {
    return { ok: false, error: `The agent did not write the plan at ${planPath}.` };
  }
  if (plan.type !== "file") return { ok: false, error: `${planPath} is not a regular file.` };
  if ((plan.size ?? 0) > MAX_PLAN_BYTES) {
    return { ok: false, error: `${planPath} is larger than ${MAX_PLAN_BYTES / 1024} KiB.` };
  }
  const ignored = manifest.changes
    .filter((change) => change.path !== planPath)
    .map((change) => change.path);
  return { ok: true, value: { ignored } };
}

/** Decodes UTF-8 strictly, so binary content is rejected rather than mangled. */
export function decodeText(content: Buffer): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<Manifest>;
  return (
    manifest.version === 1 &&
    Array.isArray(manifest.changes) &&
    manifest.changes.every(
      (change) =>
        typeof change === "object" &&
        change !== null &&
        typeof change.path === "string" &&
        ["added", "modified", "deleted"].includes(change.status),
    )
  );
}
