/**
 * How tasks form batches (decisions 10 and 12 of the plan for GPU batches across repositories): a
 * batch is the tasks that run at once with the same resolved settings, as many as the count at
 * which their profile serves them. On a pod, a batch may take tasks of the pool's repositories;
 * on other providers, only the forming repository's. Pure: `src/board.ts` reads and writes what
 * it needs. See docs/runs/batches.md.
 */

/** A count at which a task is served, with the batch key of what serves it there. */
export interface Offer {
  tasks: number;
  /** Undefined when the top level serves it. */
  profile?: string | undefined;
  key: string;
  /** Whether a pod serves it: then tasks of other repositories may complete its batch. */
  pod: boolean;
  /**
   * How many instances of what serves it run at once, and the most tasks one serves; absent from
   * older snapshots, which no cap holds back.
   */
  concurrency?: { instances: number; tasks: number } | undefined;
}

/** A ready task that may join a batch. */
export interface BatchCandidate {
  /** `owner/name`, lowercase. */
  repository: string;
  number: number;
  /** When the board first listed it ready, in milliseconds; this `select`'s time when new. */
  since: number;
  /** Its place in its repository's own order of priority. */
  rank: number;
  offers: readonly Offer[];
  /** Whether it is a task of the forming repository. */
  own: boolean;
}

/** A batch that formed: its count, key and tasks, in priority order. */
export interface FormedBatch {
  size: number;
  key: string;
  profile?: string | undefined;
  pod: boolean;
  tasks: { repository: string; number: number }[];
}

/** A task of the forming repository that no batch can take now, and why. */
export interface Waiting {
  number: number;
  /** The smallest count that serves it, and the profile that does. */
  tasks: number;
  profile?: string | undefined;
  /** How many ready tasks that count and key serve, itself included, and in how many repositories. */
  ready: number;
  repositories: number;
  /**
   * When enough tasks are ready, but the instances of what serves it are all busy: how many it
   * has (`concurrency`).
   */
  busy?: number | undefined;
}

export interface Formation {
  batches: FormedBatch[];
  /** The forming repository's tasks that wait for more ready tasks. */
  waiting: Waiting[];
  /** The forming repository's tasks whose stage nothing serves at any count. */
  unserved: number[];
}

/** Candidates in priority order: oldest `since` first, then by repository, then by rank. */
export function byPriority(a: BatchCandidate, b: BatchCandidate): number {
  return (
    a.since - b.since ||
    (a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : 0) ||
    a.rank - b.rank
  );
}

/**
 * Forms batches: in priority order, the first task that some offer completes takes the largest
 * such count n, with the first n tasks that offer the same count and key (choice 25); then the
 * next. A local offer (not on a pod) is completed only by the forming repository's own tasks.
 * The forming repository takes at most `places` tasks in all, and another repository at most
 * `limit(repository)`. A batch of n takes n of its key's free seats, `seats(offer)` before any
 * batch forms, and none forms without them (decision 5 of the plan for limiting concurrent
 * instances of a profile). Then says which of the forming repository's other tasks wait, or are
 * served by nothing.
 */
export function formBatches(
  candidates: readonly BatchCandidate[],
  options: {
    places: number;
    limit: (repository: string) => number;
    seats?: (offer: Offer) => number;
  },
): Formation {
  const ordered = [...candidates].sort(byPriority);
  const taken = new Set<BatchCandidate>();
  const used = new Map<string, number>();
  const seated = new Map<string, number>();
  const free = (offer: Offer) =>
    (options.seats?.(offer) ?? Number.POSITIVE_INFINITY) - (seated.get(offer.key) ?? 0);
  let places = options.places;
  const offering = (offer: Offer, from: BatchCandidate) =>
    ordered.filter(
      (other) =>
        !taken.has(other) &&
        (offer.pod || (from.own && other.own)) &&
        other.offers.some((one) => one.tasks === offer.tasks && one.key === offer.key),
    );
  const batches: FormedBatch[] = [];
  for (const candidate of ordered) {
    if (taken.has(candidate)) continue;
    const offers = [...candidate.offers].sort((a, b) => b.tasks - a.tasks);
    for (const offer of offers) {
      if (!offer.pod && !candidate.own) continue;
      const eligible = offering(offer, candidate);
      if (eligible.length < offer.tasks || free(offer) < offer.tasks) continue;
      const tasks = eligible.slice(0, offer.tasks);
      const own = tasks.filter((task) => task.own).length;
      if (own > places) continue;
      const counts = new Map<string, number>();
      for (const task of tasks) {
        if (!task.own) counts.set(task.repository, (counts.get(task.repository) ?? 0) + 1);
      }
      const fits = [...counts].every(
        ([repository, count]) => (used.get(repository) ?? 0) + count <= options.limit(repository),
      );
      if (!fits) continue;
      for (const task of tasks) taken.add(task);
      for (const [repository, count] of counts) {
        used.set(repository, (used.get(repository) ?? 0) + count);
      }
      places -= own;
      seated.set(offer.key, (seated.get(offer.key) ?? 0) + offer.tasks);
      batches.push({
        size: offer.tasks,
        key: offer.key,
        profile: offer.profile,
        pod: offer.pod,
        tasks: tasks.map(({ repository, number }) => ({ repository, number })),
      });
      break;
    }
  }
  const waiting: Waiting[] = [];
  const unserved: number[] = [];
  for (const candidate of ordered) {
    if (!candidate.own || taken.has(candidate)) continue;
    if (candidate.offers.length === 0) {
      unserved.push(candidate.number);
      continue;
    }
    const offers = [...candidate.offers].sort((a, b) => a.tasks - b.tasks);
    const ready = offers.map((offer) => offering(offer, candidate));
    const complete = offers.flatMap((offer, index) =>
      (ready[index]?.length ?? 0) >= offer.tasks ? [{ offer, index }] : [],
    );
    // A count it could complete now, with free seats, is left for a later run, without a message.
    if (complete.some(({ offer }) => free(offer) >= offer.tasks)) continue;
    const [full] = complete;
    if (full) {
      const those = ready[full.index] ?? [];
      waiting.push({
        number: candidate.number,
        tasks: full.offer.tasks,
        profile: full.offer.profile,
        ready: those.length,
        repositories: new Set(those.map((task) => task.repository)).size,
        busy: full.offer.concurrency?.instances ?? 0,
      });
      continue;
    }
    const [first] = offers;
    const those = ready[0] ?? [];
    if (first) {
      waiting.push({
        number: candidate.number,
        tasks: first.tasks,
        profile: first.profile,
        ready: those.length,
        repositories: new Set(those.map((task) => task.repository)).size,
      });
    }
  }
  return { batches, waiting, unserved };
}
