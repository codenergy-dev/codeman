import { randomBytes } from "node:crypto";
import { RESERVATION_MS } from "../budget.ts";
import { LAYOUT } from "../store/layout.ts";
import type { Fields, Store, StoredDocument, Value } from "../store/store.ts";

/**
 * How long a task holds the right to create the pod of its settings: the provider's call to
 * create it, and the registry's write of its ID. Others wait as long before they take it over.
 */
export const CREATE_LEASE_MS = 5 * 60_000;
/**
 * Attempts of a registry transaction: every task of the organization on the same settings
 * queries the same pods, so tasks that claim at once run theirs again, one after another.
 */
const ATTEMPTS = 20;

/**
 * Where a pod is in the registry: being created (no ID yet), serving its settings' tasks, still
 * held by runs but closed to new ones, or ended.
 */
export type RegistryStatus = "creating" | "serving" | "abandoned" | "ended";

/**
 * A task's hold on a pod: `run` while a run of the task is open on it, `keep` while the task
 * keeps it for its next run. It ends at `until`, unless renewed.
 */
export interface Lease {
  /** The task: `owner/name#7`, lowercase. */
  holder: string;
  /** The workflow run that took or renewed it. */
  run: string;
  kind: "run" | "keep";
  until: Date;
}

/** A pod as the registry holds it (docs/inference/pods.md). */
export interface RegisteredPod {
  /** The document's ID: the nonce of the pod's admin token, drawn before the pod exists. */
  nonce: string;
  /** The hash of the settings it serves; tasks with the same share it. */
  settings: string;
  status: RegistryStatus;
  /** Whether the registry holds it: until it ends. */
  live: boolean;
  /** The provider's ID of the pod, once created. */
  pod: string | undefined;
  createdAt: Date | undefined;
  pricePerSecond: number | undefined;
  /** While creating: when the creator's lease ends. */
  creatingUntil: Date | undefined;
  /** Every task's lease, expired ones included, until the pod ends. */
  leases: Lease[];
  /** The tasks that joined the pod, in order: a task's seat is its position, from 1. */
  seats: string[];
}

/** The settings a pod serves, as its document shows them; `settings` is their hash. */
export interface PodDescription {
  settings: string;
  model: string;
  gpuType: string;
  image: string;
  reuse: string;
  /** The GPU cloud that runs and bills the pod: `runpod`. */
  provider: string;
}

/**
 * What a claim found: a pod to join, with the task's lease and seat written; another task's
 * creation lease to wait for; or the creation lease, now the task's.
 */
export type Claim =
  | { kind: "join"; pod: RegisteredPod; seat: number }
  | { kind: "wait"; pod: RegisteredPod }
  | { kind: "create"; pod: RegisteredPod; seat: number };

/** What a transaction changes in a live pod: its leases, its status, or its end, and why. */
export interface Change {
  leases?: Lease[];
  status?: "abandoned";
  end?: string;
}

/** What a task's leave left: whether it ended the pod, and the tasks that still hold it. */
export interface Left {
  ended: boolean;
  holders: string[];
  pod: RegisteredPod | undefined;
}

/**
 * Codeman's pod registry, in the store (decision 1 of the pod registry plan): a document per pod,
 * which the tasks of an organization with the same settings find, join or create in
 * transactions, and on which each holds a lease. A pod no lease holds is ended; the job that
 * ends it terminates it. See docs/inference/pods.md.
 */
export class PodRegistry {
  readonly #store: Store;
  readonly #owner: string;
  readonly #now: () => Date;

  constructor(store: Store, owner: string, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#owner = owner;
    this.#now = now;
  }

  /**
   * Finds the pod of `description`'s settings for the task `holder` of workflow run `run`: joins
   * the oldest serving one with a run lease; waits for another task's unexpired creation lease;
   * or takes the creation lease, with a run lease. A creation lease that expired ends, so the
   * task takes it over.
   */
  claim(description: PodDescription, holder: string, run: string): Promise<Claim> {
    return this.#store.transaction(
      async (tx) => {
        const now = this.#now();
        const pods = (
          await tx.query(LAYOUT.pods(this.#owner), {
            where: [
              { field: "settings", op: "==", value: description.settings },
              { field: "live", op: "==", value: true },
            ],
          })
        )
          .map(registered)
          .sort(byAge);
        const lease: Lease = {
          holder,
          run,
          kind: "run",
          until: new Date(now.getTime() + RESERVATION_MS),
        };
        for (const stale of pods) {
          if (stale.status !== "creating" || (stale.creatingUntil ?? now) > now) continue;
          tx.write({
            op: "set",
            path: this.#path(stale.nonce),
            fields: ended(now, "its creation lease expired"),
            merge: true,
          });
        }
        const serving = pods.find((pod) => pod.status === "serving");
        if (serving) {
          const seats = serving.seats.includes(holder) ? serving.seats : [...serving.seats, holder];
          const leases = [...serving.leases.filter((one) => one.holder !== holder), lease];
          tx.write({
            op: "set",
            path: this.#path(serving.nonce),
            fields: { leases: leases.map(leaseFields), seats },
            merge: true,
          });
          return {
            kind: "join",
            pod: { ...serving, leases, seats },
            seat: seats.indexOf(holder) + 1,
          };
        }
        const creating = pods.find(
          (pod) => pod.status === "creating" && (pod.creatingUntil ?? now) > now,
        );
        if (creating) return { kind: "wait", pod: creating };
        const pod: RegisteredPod = {
          nonce: randomBytes(16).toString("hex"),
          settings: description.settings,
          status: "creating",
          live: true,
          pod: undefined,
          createdAt: undefined,
          pricePerSecond: undefined,
          creatingUntil: new Date(now.getTime() + CREATE_LEASE_MS),
          leases: [lease],
          seats: [holder],
        };
        tx.write({
          op: "create",
          path: this.#path(pod.nonce),
          fields: {
            ...description,
            status: pod.status,
            live: true,
            claimedAt: now,
            claimedBy: holder,
            creatingUntil: pod.creatingUntil ?? null,
            leases: pod.leases.map(leaseFields),
            seats: pod.seats,
          },
        });
        return { kind: "create", pod, seat: 1 };
      },
      { attempts: ATTEMPTS },
    );
  }

  /**
   * The creator's pod exists: it serves its settings' tasks from now on. Undefined when the
   * creation lease ended meanwhile, and another task took it: the creator's pod is then extra.
   */
  register(
    nonce: string,
    created: { pod: string; createdAt: Date; pricePerSecond: number },
  ): Promise<RegisteredPod | undefined> {
    return this.#store.transaction(
      async (tx) => {
        const document = await tx.get(this.#path(nonce));
        const pod = document && registered(document);
        if (!pod?.live || pod.status !== "creating") return undefined;
        tx.write({
          op: "set",
          path: this.#path(nonce),
          fields: { status: "serving", ...created, creatingUntil: null },
          merge: true,
        });
        return { ...pod, status: "serving" as const, ...created, creatingUntil: undefined };
      },
      { attempts: ATTEMPTS },
    );
  }

  /**
   * The task leaves the pod: its lease becomes a keep lease until `keepUntil`, or ends; with
   * `onlyKeep`, only a keep lease ends, never a run's. With `abandon`, no task joins the pod any
   * more. When no unexpired lease remains, the pod ends, and the caller terminates it.
   */
  async leave(
    nonce: string,
    holder: string,
    options: { keepUntil?: Date | undefined; abandon?: boolean; onlyKeep?: boolean } = {},
  ): Promise<Left> {
    const { pod, change } = await this.change(nonce, (current, now) => {
      const mine = current.leases.find((one) => one.holder === holder);
      let leases = current.leases;
      if (!options.onlyKeep || mine?.kind === "keep") {
        leases = leases.filter((one) => one.holder !== holder);
        if (options.keepUntil) {
          leases.push({ holder, run: mine?.run ?? "", kind: "keep", until: options.keepUntil });
        }
      }
      if (current.status !== "creating" && heldBy(leases, now).length === 0) {
        return { leases, end: "no run uses it and no task keeps it" };
      }
      return {
        leases,
        ...(options.abandon && current.status === "serving"
          ? { status: "abandoned" as const }
          : {}),
      };
    });
    return {
      ended: change?.end !== undefined,
      holders: pod?.live ? heldBy(pod.leases, this.#now()) : [],
      pod,
    };
  }

  /** Ends the pod, such as one that did not serve its model: no task holds it any more. */
  async end(nonce: string, reason: string): Promise<void> {
    await this.change(nonce, () => ({ end: reason }));
  }

  /** The organization's pods that the registry holds, oldest first. */
  async live(): Promise<RegisteredPod[]> {
    const documents = await this.#store.query(LAYOUT.pods(this.#owner), {
      where: [{ field: "live", op: "==", value: true }],
    });
    return documents.map(registered).sort(byAge);
  }

  /**
   * Changes a live pod as `decide` says, in a transaction that reads it again: nothing when it
   * returns undefined, or when the pod is no longer live. Returns the pod as it is now.
   */
  change(
    nonce: string,
    decide: (pod: RegisteredPod, now: Date) => Change | undefined,
  ): Promise<{ pod: RegisteredPod | undefined; change: Change | undefined }> {
    return this.#store.transaction(
      async (tx) => {
        const document = await tx.get(this.#path(nonce));
        const pod = document && registered(document);
        if (!pod?.live) return { pod, change: undefined };
        const now = this.#now();
        const change = decide(pod, now);
        if (!change) return { pod, change };
        const leases = change.leases ?? pod.leases;
        const status = change.end ? "ended" : (change.status ?? pod.status);
        tx.write({
          op: "set",
          path: this.#path(nonce),
          fields: {
            leases: leases.map(leaseFields),
            ...(change.end ? ended(now, change.end) : { status }),
          },
          merge: true,
        });
        return { pod: { ...pod, leases, status, live: !change.end }, change };
      },
      { attempts: ATTEMPTS },
    );
  }

  #path(nonce: string): string {
    return LAYOUT.pod(this.#owner, nonce);
  }
}

/** The holders of the leases that have not expired at `now`. */
export function heldBy(leases: readonly Lease[], now: Date): string[] {
  return [...new Set(leases.filter((one) => one.until > now).map((one) => one.holder))];
}

/** The fields of a pod that ends now. */
function ended(now: Date, reason: string): Fields {
  return { status: "ended", live: false, endedAt: now, reason, creatingUntil: null };
}

function leaseFields(lease: Lease): Value {
  return { holder: lease.holder, run: lease.run, kind: lease.kind, until: lease.until };
}

/** Pods from the oldest: by creation, then by claim; every task picks the same first. */
function byAge(a: RegisteredPod, b: RegisteredPod): number {
  const time = (pod: RegisteredPod) => pod.createdAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return time(a) - time(b) || (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0);
}

/** A pod's document as the registry reads it; missing fields read as empty. */
export function registered(document: StoredDocument): RegisteredPod {
  const { fields } = document;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  const date = (value: unknown) => (value instanceof Date ? value : undefined);
  const statuses: readonly string[] = ["creating", "serving", "abandoned", "ended"];
  const status = text(fields.status) ?? "ended";
  const leases = (Array.isArray(fields.leases) ? fields.leases : []).flatMap((value): Lease[] => {
    const lease = value as Record<string, unknown> | null;
    const holder = text(lease?.holder);
    const until = date(lease?.until);
    if (!holder || !until) return [];
    return [
      { holder, run: text(lease?.run) ?? "", kind: lease?.kind === "keep" ? "keep" : "run", until },
    ];
  });
  const price = fields.pricePerSecond;
  return {
    nonce: document.path.slice(document.path.lastIndexOf("/") + 1),
    settings: text(fields.settings) ?? "",
    status: statuses.includes(status) ? (status as RegistryStatus) : "ended",
    live: fields.live === true,
    pod: text(fields.pod),
    createdAt: date(fields.createdAt),
    pricePerSecond: typeof price === "number" && price > 0 ? price : undefined,
    creatingUntil: date(fields.creatingUntil),
    leases,
    seats: (Array.isArray(fields.seats) ? fields.seats : []).filter(
      (seat): seat is string => typeof seat === "string",
    ),
  };
}
