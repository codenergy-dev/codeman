import {
  type BatchCandidate,
  type FormedBatch,
  formBatches,
  type Offer,
  type Waiting,
} from "./batches.ts";
import { agreement, type Declaration, type Pool } from "./pool.ts";
import { MAX_TASKS } from "./settings.ts";
import { LAYOUT } from "./store/layout.ts";
import type { Fields, Store, StoredDocument, Value } from "./store/store.ts";

/**
 * The board and the batches in Codeman's store (decisions 2, 10 and 11 of the plan for GPU
 * batches across repositories): each `select` rewrites its repository's snapshot of ready tasks,
 * honors the batches that reserved its tasks, and forms the batches the pool's board completes,
 * in one transaction. GitHub stays the source of truth: the board is an index, and a reserved
 * task is checked again against GitHub before it runs. See docs/runs/batches.md.
 */

/** How long a repository's snapshot is read without being rewritten (choice 26). */
export const BOARD_TTL_MS = 25 * 3_600_000;
/** How long a batch reserves another repository's tasks (decision 11). */
export const RESERVATION_TTL_MS = 30 * 60_000;
/** Attempts of the transaction: every `select` of the pool reads the same board and batches. */
const ATTEMPTS = 20;

/** A ready task on the board, with the counts at which a pod serves it. */
export interface BoardTask {
  number: number;
  stage: string;
  /** The issue's last update, as GitHub gives it, when known. */
  updatedAt?: string | undefined;
  /** When the board first listed it ready. */
  since: Date;
  offers: Offer[];
}

/** A repository's snapshot. */
export interface BoardEntry {
  /** `owner/name`, lowercase. */
  repository: string;
  updatedAt: Date;
  expiresAt: Date;
  /** In the repository's order of priority. */
  tasks: BoardTask[];
}

export type MemberStatus = "reserved" | "started" | "dropped";

/** A task of a batch, and what became of it. */
export interface BatchMember {
  repository: string;
  number: number;
  status: MemberStatus;
}

/** A batch as its document holds it. */
export interface StoredBatch {
  id: string;
  key: string;
  profile?: string | undefined;
  size: number;
  formedAt: Date;
  expiresAt: Date;
  members: BatchMember[];
}

/** A ready task of the forming repository, as `select` read it from GitHub. */
export interface OwnTask {
  number: number;
  stage: string;
  updatedAt?: string | undefined;
  /** Every count that serves it, up to the run's cap; pod offers go on the board. */
  offers: Offer[];
}

/** A task the run starts in a batch: its batch's count and key, and the batch's ID on a pod. */
export interface Started {
  number: number;
  size: number;
  key: string;
  profile?: string | undefined;
  /** Undefined for a local batch, which has no document. */
  batch?: string | undefined;
}

/**
 * A run of another repository to start, for the batches that reserved its tasks: always its
 * `codeman.yml` on its default branch, the only workflow Workload Identity admits, so nothing on
 * the board, which any member's run may write, chooses what a dispatch starts.
 */
export interface Dispatch {
  owner: string;
  repository: string;
  batches: string;
}

export interface Exchange {
  /** The reservations of the repository's tasks that this run honors, then the new batches'. */
  honored: Started[];
  formed: Started[];
  /** Reserved tasks that are no longer ready for their batch, and were released. */
  dropped: { number: number; batch: string }[];
  /** The new batches, with their documents' IDs for those on a pod. */
  batches: (FormedBatch & { id?: string | undefined })[];
  waiting: Waiting[];
  unserved: number[];
  dispatches: Dispatch[];
}

/**
 * Writes the pool the organization declares on its document when it changed, and reads the other
 * members' (decision 8): the pool with the members that agree, and a line about each that does
 * not.
 */
export async function handshake(
  store: Store,
  owner: string,
  pool: Pool,
  now: Date,
): Promise<{ pool: Pool; notes: string[] }> {
  const own = owner.toLowerCase();
  const path = LAYOUT.organization(own);
  const current = (await store.get(path))?.fields;
  const members = pool.members as readonly Value[];
  const same =
    current?.pool === pool.id &&
    Array.isArray(current.members) &&
    JSON.stringify(current.members) === JSON.stringify(members);
  if (!same) {
    await store.write([
      { op: "set", path, fields: { pool: pool.id, members, declaredAt: now }, merge: true },
    ]);
  }
  const declarations = new Map<string, Declaration | undefined>();
  await Promise.all(
    pool.members
      .filter((member) => member !== own)
      .map(async (member) => {
        const pool = (await store.get(LAYOUT.organization(member)))?.fields.pool;
        declarations.set(member, typeof pool === "string" ? { pool } : undefined);
      }),
  );
  return agreement(pool, own, declarations);
}

/**
 * In one transaction: honors the reservations of the repository's tasks that are still ready for
 * their batch, at its count and key, and drops the others; forms the batches the pool's board
 * completes with the repository's other tasks; rewrites the repository's snapshot without the
 * tasks it starts. `pool` names only the members that agree.
 */
export function exchange(
  store: Store,
  input: {
    pool: Pool;
    repository: string;
    run: { id: string; attempt: number };
    now: Date;
    /** In the repository's order of priority. */
    own: readonly OwnTask[];
    /** The places of the run for the tasks of new batches. */
    places: number;
    /** The free seats of an offer's key, before any batch forms; unlimited without it. */
    seats?: (offer: Offer) => number;
    /** Until when an offer's provider has no room for a new pod. */
    unavailable?: (offer: Offer) => Date | undefined;
  },
): Promise<Exchange> {
  const { pool, now } = input;
  const repository = input.repository.toLowerCase();
  return store.transaction(
    async (tx) => {
      const [boardDocuments, batchDocuments] = await Promise.all([
        tx.query(LAYOUT.board(pool.id)),
        tx.query(LAYOUT.batches(pool.id), {
          where: [{ field: "expiresAt", op: ">", value: now }],
        }),
      ]);
      const entries = boardDocuments.flatMap((document) => boardEntry(document) ?? []);
      const batches = batchDocuments.flatMap((document) => storedBatch(document) ?? []);
      const ownTask = new Map(input.own.map((task) => [task.number, task]));

      // The reservations of this repository's tasks: whichever run of it comes honors them.
      const honored: Started[] = [];
      const dropped: Exchange["dropped"] = [];
      for (const batch of batches) {
        let changed = false;
        const members = batch.members.map((member) => {
          if (member.repository !== repository || member.status !== "reserved") return member;
          const task = ownTask.get(member.number);
          const ready =
            task?.offers.some((offer) => offer.tasks === batch.size && offer.key === batch.key) &&
            !honored.some((one) => one.number === member.number) &&
            honored.length < MAX_TASKS;
          changed = true;
          if (ready) {
            honored.push({
              number: member.number,
              size: batch.size,
              key: batch.key,
              profile: batch.profile,
              batch: batch.id,
            });
            return { ...member, status: "started" as const };
          }
          dropped.push({ number: member.number, batch: batch.id });
          return { ...member, status: "dropped" as const };
        });
        if (changed) {
          tx.write({
            op: "set",
            path: LAYOUT.batch(pool.id, batch.id),
            fields: { members: members.map(memberFields) },
            merge: true,
          });
        }
        batch.members = members;
      }

      // Tasks that unexpired batches hold, left out of the other snapshots' candidates, and how
      // many each repository has reserved.
      const held = new Set<string>();
      const reserved = new Map<string, number>();
      for (const batch of batches) {
        for (const member of batch.members) {
          if (member.status === "dropped") continue;
          held.add(`${member.repository}#${member.number}`);
          if (member.status === "reserved") {
            reserved.set(member.repository, (reserved.get(member.repository) ?? 0) + 1);
          }
        }
      }
      const previous = entries.find((entry) => entry.repository === repository);
      const sinceOf = (number: number) =>
        previous?.tasks.find((task) => task.number === number)?.since ?? now;
      const candidates: BatchCandidate[] = [];
      // The repository's own ready tasks, except those this run honors: a task an earlier run of
      // the repository started, whose batch has not expired, starts its next stage now. One run
      // of a repository is active at a time, so that earlier run has ended.
      for (const [rank, task] of input.own.entries()) {
        if (honored.some((one) => one.number === task.number)) continue;
        candidates.push({
          repository,
          number: task.number,
          since: sinceOf(task.number).getTime(),
          rank,
          offers: task.offers,
          own: true,
        });
      }
      const members = new Set(pool.members);
      const live = entries.filter(
        (entry) =>
          entry.repository !== repository &&
          entry.expiresAt > now &&
          members.has(ownerOf(entry.repository)),
      );
      for (const entry of live) {
        for (const [rank, task] of entry.tasks.entries()) {
          if (held.has(`${entry.repository}#${task.number}`)) continue;
          candidates.push({
            repository: entry.repository,
            number: task.number,
            since: task.since.getTime(),
            rank,
            offers: task.offers.filter((offer) => offer.pod),
            own: false,
          });
        }
      }
      const formation = formBatches(candidates, {
        places: Math.max(0, input.places - honored.length),
        limit: (other) => Math.max(0, MAX_TASKS - (reserved.get(other) ?? 0)),
        ...(input.seats ? { seats: input.seats } : {}),
        ...(input.unavailable ? { unavailable: input.unavailable } : {}),
      });

      const formed: Started[] = [];
      const named: Exchange["batches"] = [];
      const targets = new Map<string, string[]>();
      let index = 0;
      for (const batch of formation.batches) {
        const id = batch.pod ? `${input.run.id}-${input.run.attempt}-${index++}` : undefined;
        named.push({ ...batch, id });
        for (const task of batch.tasks) {
          if (task.repository === repository) {
            formed.push({
              number: task.number,
              size: batch.size,
              key: batch.key,
              profile: batch.profile,
              batch: id,
            });
          } else if (id) {
            const ids = targets.get(task.repository) ?? [];
            if (!ids.includes(id)) targets.set(task.repository, [...ids, id]);
          }
        }
        if (!id) continue;
        tx.write({
          op: "create",
          path: LAYOUT.batch(pool.id, id),
          fields: {
            key: batch.key,
            profile: batch.profile ?? null,
            size: batch.size,
            formedBy: { repository, workflowRun: input.run.id, attempt: input.run.attempt },
            formedAt: now,
            expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
            members: batch.tasks.map((task) =>
              memberFields({
                ...task,
                status: task.repository === repository ? "started" : "reserved",
              }),
            ),
          },
        });
      }

      // The snapshot: the ready tasks a pod could serve that this run does not start.
      const starting = new Set([...honored, ...formed].map((task) => task.number));
      const listed = input.own.filter(
        (task) => !starting.has(task.number) && task.offers.some((offer) => offer.pod),
      );
      tx.write({
        op: "set",
        path: LAYOUT.boardEntry(pool.id, repository),
        fields: {
          repository,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + BOARD_TTL_MS),
          tasks: listed.map((task) => ({
            number: task.number,
            stage: task.stage,
            ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
            since: sinceOf(task.number),
            // Arrays may not hold arrays: the offers are text.
            offers: JSON.stringify(task.offers.filter((offer) => offer.pod)),
          })),
        },
      });

      const dispatches: Dispatch[] = [];
      for (const [target, ids] of targets) {
        const entry = live.find((one) => one.repository === target);
        const owner = ownerOf(target);
        // Never another owner than the pool's members that agree.
        if (!entry || !members.has(owner)) continue;
        dispatches.push({
          owner,
          repository: target.slice(owner.length + 1),
          batches: ids.join(" "),
        });
      }
      return {
        honored,
        formed,
        dropped,
        batches: named,
        waiting: formation.waiting,
        unserved: formation.unserved,
        dispatches,
      };
    },
    { attempts: ATTEMPTS },
  );
}

function ownerOf(repository: string): string {
  return repository.slice(0, repository.indexOf("/"));
}

function memberFields(member: BatchMember): Fields {
  return { repository: member.repository, number: member.number, status: member.status };
}

/** A snapshot as the board reads it; undefined when it is not one. */
export function boardEntry(document: StoredDocument): BoardEntry | undefined {
  const { fields } = document;
  // Snapshots written before dispatches took only the default branch also hold `branch` and
  // `workflow`, which nothing reads.
  const { repository, updatedAt, expiresAt, tasks } = fields;
  if (typeof repository !== "string" || !repository.includes("/")) return undefined;
  if (!(updatedAt instanceof Date) || !(expiresAt instanceof Date)) return undefined;
  const list = Array.isArray(tasks) ? tasks : [];
  return {
    repository,
    updatedAt,
    expiresAt,
    tasks: list.flatMap((value): BoardTask[] => {
      const task = value as Record<string, unknown> | null;
      if (typeof task?.number !== "number" || !(task.since instanceof Date)) return [];
      const offers = parseOffers(task.offers);
      if (!offers) return [];
      return [
        {
          number: task.number,
          stage: typeof task.stage === "string" ? task.stage : "",
          updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : undefined,
          since: task.since,
          offers,
        },
      ];
    }),
  };
}

function parseOffers(value: unknown): Offer[] | undefined {
  if (typeof value !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const offers = parsed.flatMap((item): Offer[] => {
    const offer = item as Partial<Offer> | null;
    const valid =
      Number.isInteger(offer?.tasks) &&
      (offer?.tasks ?? 0) >= 1 &&
      (offer?.tasks ?? 0) <= MAX_TASKS &&
      typeof offer?.key === "string" &&
      (offer.profile === undefined || typeof offer.profile === "string");
    const count = (value: unknown) =>
      Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TASKS;
    const { instances, tasks } = offer?.concurrency ?? {};
    return valid && offer
      ? [
          {
            tasks: offer.tasks as number,
            profile: offer.profile,
            ...(Number.isInteger(offer.place) && (offer.place ?? -1) >= 0
              ? { place: offer.place }
              : {}),
            key: offer.key as string,
            pod: offer.pod === true,
            ...(count(instances) && count(tasks)
              ? { concurrency: { instances: instances as number, tasks: tasks as number } }
              : {}),
          },
        ]
      : [];
  });
  return offers;
}

/** A batch as its document holds it; undefined when it is not one. */
export function storedBatch(document: StoredDocument): StoredBatch | undefined {
  const { key, profile, size, formedAt, expiresAt, members } = document.fields;
  if (typeof key !== "string" || typeof size !== "number") return undefined;
  if (!(formedAt instanceof Date) || !(expiresAt instanceof Date)) return undefined;
  const statuses: readonly string[] = ["reserved", "started", "dropped"];
  return {
    id: document.path.slice(document.path.lastIndexOf("/") + 1),
    key,
    profile: typeof profile === "string" ? profile : undefined,
    size,
    formedAt,
    expiresAt,
    members: (Array.isArray(members) ? members : []).flatMap((value): BatchMember[] => {
      const member = value as Record<string, unknown> | null;
      if (typeof member?.repository !== "string" || typeof member.number !== "number") return [];
      const status = typeof member.status === "string" ? member.status : "";
      return statuses.includes(status)
        ? [{ repository: member.repository, number: member.number, status: status as MemberStatus }]
        : [];
    }),
  };
}

/** The batch a pod's task runs in, as the pod registry reads it; undefined when there is none. */
export async function readBatch(
  store: Pick<Store, "get">,
  pool: string,
  id: string,
): Promise<StoredBatch | undefined> {
  const document = await store.get(LAYOUT.batch(pool, id));
  return document ? storedBatch(document) : undefined;
}
