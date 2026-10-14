import assert from "node:assert/strict";
import { test } from "node:test";
import { type BatchCandidate, formBatches, type Offer } from "./batches.ts";

const four: Offer = { tasks: 4, profile: "four", key: "k4", pod: true };
const mig = (tasks: number): Offer => ({ tasks, profile: "mig", key: "k3", pod: true });
const planner = (tasks: number): Offer => ({ tasks, profile: "planner", key: "kp", pod: false });

function task(
  repository: string,
  number: number,
  offers: Offer[],
  options: { since?: number; own?: boolean; rank?: number } = {},
): BatchCandidate {
  return {
    repository,
    number,
    since: options.since ?? 0,
    rank: options.rank ?? number,
    offers,
    own: options.own ?? repository === "o/a",
  };
}

const unlimited = { places: 10, limit: () => 10 };

test("2 ready tasks in one repository and 2 in another form a batch of 4 on one pod", () => {
  const formed = formBatches(
    [
      task("o/a", 1, [four]),
      task("o/a", 2, [four]),
      task("o/b", 7, [four]),
      task("o/b", 8, [four]),
    ],
    unlimited,
  );
  assert.deepEqual(formed.batches, [
    {
      size: 4,
      key: "k4",
      profile: "four",
      pod: true,
      tasks: [
        { repository: "o/a", number: 1 },
        { repository: "o/a", number: 2 },
        { repository: "o/b", number: 7 },
        { repository: "o/b", number: 8 },
      ],
    },
  ]);
  assert.deepEqual([formed.waiting, formed.unserved], [[], []]);
});

test("the oldest tasks go first, across repositories", () => {
  const formed = formBatches(
    [
      task("o/a", 1, [four], { since: 50 }),
      task("o/a", 2, [four], { since: 50 }),
      task("o/b", 7, [four], { since: 10 }),
      task("o/b", 8, [four], { since: 20 }),
      task("o/c", 3, [four], { since: 30 }),
    ],
    unlimited,
  );
  assert.deepEqual(
    formed.batches[0]?.tasks.map(({ repository, number }) => `${repository}#${number}`),
    ["o/b#7", "o/b#8", "o/c#3", "o/a#1"],
  );
  // The forming repository's task left out waits for 3 more.
  assert.deepEqual(formed.waiting, [
    { number: 2, tasks: 4, profile: "four", ready: 1, repositories: 1 },
  ]);
});

test("a task takes the largest count it completes, and local offers only the repository's own tasks", () => {
  const code = [mig(1), mig(2), mig(3), four];
  const formed = formBatches(
    [
      task("o/a", 1, [planner(1), planner(2), planner(3), planner(4)]),
      task("o/a", 2, code),
      task("o/a", 3, code),
      task("o/a", 4, code),
      // Another repository's planning tasks never complete a local batch.
      task("o/b", 9, [planner(1), planner(2)], { since: -1 }),
    ],
    unlimited,
  );
  assert.deepEqual(
    formed.batches.map((batch) => [batch.profile, batch.size, batch.tasks.length]),
    [
      ["planner", 1, 1],
      ["mig", 3, 3],
    ],
  );
});

test("the run's places and other repositories' limits bound what forms", () => {
  const candidates = [1, 2, 3, 4].map((number) => task("o/a", number, [mig(1), mig(2), mig(3)]));
  const two = formBatches(candidates, { places: 2, limit: () => 10 });
  assert.deepEqual(
    two.batches.map((batch) => batch.size),
    [2],
  );
  const others = [7, 8, 9, 10].map((number) => task("o/b", number, [four]));
  const limited = formBatches(others, { places: 0, limit: () => 3 });
  assert.deepEqual(limited.batches, [], "o/b may take only 3 more tasks");
});

test("a task that no count completes waits, saying how many are ready and where", () => {
  const formed = formBatches(
    [
      task("o/a", 1, [four]),
      task("o/b", 7, [four]),
      task("o/b", 8, [four]),
      task("o/a", 2, []),
      task("o/a", 3, [{ ...four, key: "other" }]),
    ],
    unlimited,
  );
  assert.deepEqual(formed.batches, []);
  assert.deepEqual(formed.waiting, [
    { number: 1, tasks: 4, profile: "four", ready: 3, repositories: 2 },
    { number: 3, tasks: 4, profile: "four", ready: 1, repositories: 1 },
  ]);
  assert.deepEqual(formed.unserved, [2]);
});
