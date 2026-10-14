import type { Parsed } from "./output.ts";

/**
 * A pool: the organizations that share the board, the batches, the pod registry and the GPU
 * account (decision 5 of the plan for GPU batches across repositories). By default, an
 * organization alone. See docs/runs/batches.md.
 */
export interface Pool {
  /** The members' logins, lowercase, sorted, joined by `+`. */
  id: string;
  /** The members' logins, lowercase and sorted. */
  members: string[];
}

/** The most organizations a pool may have. */
export const MAX_POOL_MEMBERS = 10;

/** A GitHub login: letters, digits and single hyphens between them, up to 39 characters. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function isLogin(text: string): boolean {
  return LOGIN.test(text);
}

/** The ID of a pool of these members: their logins, lowercase, sorted, joined by `+`. */
export function poolId(members: readonly string[]): string {
  return sortedLogins(members).join("+");
}

function sortedLogins(members: readonly string[]): string[] {
  return [...new Set(members.map((member) => member.toLowerCase()))].sort();
}

/** Whether a text is a pool's ID: logins joined by `+`, lowercase and sorted. */
export function isPoolId(text: string): boolean {
  const members = text.split("+");
  return (
    members.length <= MAX_POOL_MEMBERS &&
    members.every((member) => isLogin(member) && member === member.toLowerCase()) &&
    poolId(members) === text
  );
}

/**
 * The value of the `pool` setting: a list of 1 to `MAX_POOL_MEMBERS` logins, each once. Whether
 * it includes the organization is checked where the owner is known (`declaredPool`).
 */
export function poolSetting(items: readonly string[] | undefined): Parsed<string[]> {
  const error = `\`pool\` must list the logins of the organizations that share pods, ${MAX_POOL_MEMBERS} at most, this one included, such as \`[organization-a, organization-b]\`.`;
  if (!items || items.length === 0 || items.length > MAX_POOL_MEMBERS) {
    return { ok: false, error };
  }
  if (!items.every(isLogin)) return { ok: false, error };
  const lower = items.map((item) => item.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    return { ok: false, error: "`pool` lists an organization twice." };
  }
  return { ok: true, value: [...items] };
}

/**
 * The pool an organization declares: its `pool` setting, which must include it, or the
 * organization alone.
 */
export function declaredPool(owner: string, members?: readonly string[]): Parsed<Pool> {
  const own = owner.toLowerCase();
  const list = sortedLogins(members && members.length > 0 ? members : [own]);
  if (!list.includes(own)) {
    return {
      ok: false,
      error: `\`pool\` in the organization's settings must include the organization itself, \`${own}\`.`,
    };
  }
  return { ok: true, value: { id: list.join("+"), members: list } };
}

/** An organization alone, as the pool of a choice made before pools. */
export function soloPool(owner: string): Pool {
  const own = owner.toLowerCase();
  return { id: own, members: [own] };
}

/** What an organization's document says of the pool it declares, if anything. */
export interface Declaration {
  pool?: string | undefined;
}

/**
 * The members that agree on `pool` (decision 8): those whose organization's document declares the
 * same pool, the organization itself always; and a line for the log about each that does not.
 */
export function agreement(
  pool: Pool,
  owner: string,
  declarations: ReadonlyMap<string, Declaration | undefined>,
): { pool: Pool; notes: string[] } {
  const own = owner.toLowerCase();
  const members: string[] = [];
  const notes: string[] = [];
  for (const member of pool.members) {
    if (member === own) {
      members.push(member);
      continue;
    }
    const declared = declarations.get(member)?.pool;
    if (declared === pool.id) members.push(member);
    else if (declared === undefined) {
      notes.push(
        `Organization ${member} has declared no pool yet (none of its repositories ran this version of Codeman): its repositories are not batched with this one's.`,
      );
    } else {
      notes.push(
        `Organization ${member} declares pool \`${declared}\`, not \`${pool.id}\`: its repositories are not batched with this one's.`,
      );
    }
  }
  return { pool: { id: pool.id, members }, notes };
}
