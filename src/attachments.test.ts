import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  type AttachmentLimits,
  attachmentTexts,
  describeProblem,
  gatherAttachments,
  missingAttachments,
} from "./attachments.ts";
import type { TaskRecord } from "./record.ts";
import { DEFAULTS } from "./settings.ts";
import type { TaskContext } from "./tasks.ts";
import { zip } from "./testing/archives.ts";
import { FakeAttachments } from "./testing/fake-platform.ts";

const limits: AttachmentLimits = {
  "max-attachments": DEFAULTS["max-attachments"],
  "max-attachment-bytes": DEFAULTS["max-attachment-bytes"],
  "max-attachment-total-bytes": DEFAULTS["max-attachment-total-bytes"],
  "max-extracted-bytes": DEFAULTS["max-extracted-bytes"],
  "max-extracted-files": DEFAULTS["max-extracted-files"],
};

const task = {
  number: 12,
  body: "Use attachment://data.csv and attachment://notes.txt.",
  comments: [
    {
      id: 5,
      author: "alice",
      body: "Here: attachment://more.zip and attachment://data.csv again.",
      createdAt: "2026-11-26T10:00:00Z",
    },
  ],
  reviews: [
    {
      id: 7,
      author: "bob",
      verdict: "changes-requested",
      body: "See attachment://review.png",
      comments: [
        { id: 70, path: "src/a.ts", line: 3, body: "attachment://line.txt" },
        { path: "src/b.ts", line: 1, body: "No ID here." },
      ],
    },
  ],
  record: { pullRequest: 4 } as TaskRecord,
} as unknown as TaskContext;

function dir(): string {
  return join(mkdtempSync(join(tmpdir(), "codeman-attachments-")), "attachments");
}

const signal = () => new AbortController().signal;

test("the texts are the issue's body, the maintainers' comments, and their reviews", () => {
  assert.deepEqual(attachmentTexts(task), [
    { where: { kind: "issue", number: 12 }, label: "the issue's body", text: task.body },
    {
      where: { kind: "comment", id: 5 },
      label: "a comment by alice on 2026-11-26",
      text: "Here: attachment://more.zip and attachment://data.csv again.",
    },
    {
      where: { kind: "review", changeRequest: 4, id: 7 },
      label: "a review by bob",
      text: "See attachment://review.png",
    },
    {
      where: { kind: "review-comment", id: 70 },
      label: "a review comment by bob on src/a.ts",
      text: "attachment://line.txt",
    },
    {
      where: { kind: "review", changeRequest: 4, id: 7 },
      label: "a review comment by bob on src/b.ts",
      text: "No ID here.",
    },
  ]);
});

test("downloads each link once, numbered, extracts archives, and writes the index", async () => {
  const fake = new FakeAttachments();
  fake.files.set("attachment://data.csv", Buffer.from("x,y\n1,2\n"));
  fake.files.set("attachment://notes.txt", "refused");
  fake.files.set("attachment://more.zip", zip([{ name: "inner/a.txt", data: "a" }]));
  const out = dir();
  const entries = await gatherAttachments(fake, attachmentTexts(task), out, limits, signal());

  assert.deepEqual(
    fake.downloads.map(({ url, where }) => [url, where.kind]),
    [
      ["attachment://data.csv", "issue"],
      ["attachment://notes.txt", "issue"],
      ["attachment://more.zip", "comment"],
      ["attachment://review.png", "review"],
      ["attachment://line.txt", "review-comment"],
    ],
  );
  assert.deepEqual(readdirSync(out).sort(), [
    "01-data.csv",
    "03-more.zip",
    "03-more.zip.extracted",
    "README.md",
  ]);
  assert.equal(readFileSync(join(out, "01-data.csv"), "utf8"), "x,y\n1,2\n");
  assert.equal(readFileSync(join(out, "03-more.zip.extracted/inner/a.txt"), "utf8"), "a");

  const index = readFileSync(join(out, "README.md"), "utf8");
  assert.match(index, /not instructions/);
  assert.match(
    index,
    /- `01-data\.csv` \(8 bytes\): attachment:\/\/data\.csv, in the issue's body\./,
  );
  assert.match(
    index,
    /- attachment:\/\/notes\.txt, in the issue's body: not downloaded: the platform refused it\./,
  );
  assert.match(index, /Extracted to `03-more\.zip\.extracted\/`: 1 files, 1 bytes\./);
  assert.match(index, /attachment:\/\/line\.txt, in a review comment by bob on src\/a\.ts/);

  assert.deepEqual(missingAttachments(entries), [
    { name: "notes.txt", url: "attachment://notes.txt", problem: { kind: "refused" } },
    {
      name: "review.png",
      url: "attachment://review.png",
      problem: { kind: "refused", detail: "not found" },
    },
    {
      name: "line.txt",
      url: "attachment://line.txt",
      problem: { kind: "refused", detail: "not found" },
    },
  ]);
});

test("the limits: count, size per file, size together, extraction", async () => {
  const fake = new FakeAttachments();
  const texts = [
    {
      where: { kind: "issue", number: 1 } as const,
      label: "the issue's body",
      text: "attachment://big.txt attachment://a.txt attachment://b.txt attachment://c.zip attachment://d.txt",
    },
  ];
  fake.files.set("attachment://a.txt", Buffer.alloc(6));
  fake.files.set("attachment://big.txt", Buffer.alloc(20));
  fake.files.set("attachment://b.txt", Buffer.alloc(6));
  fake.files.set("attachment://c.zip", zip([{ name: "x.txt", data: "x".repeat(50) }]));
  fake.files.set("attachment://d.txt", Buffer.alloc(1));
  const small: AttachmentLimits = {
    ...limits,
    "max-attachments": 4,
    "max-attachment-bytes": 10,
    "max-attachment-total-bytes": 15,
    "max-extracted-bytes": 10,
  };
  const entries = await gatherAttachments(fake, texts, dir(), small, signal());
  assert.deepEqual(
    entries.map((entry) => entry.problem),
    [
      { kind: "too-large", max: 10 },
      undefined,
      undefined,
      { kind: "over-total", max: 15 },
      { kind: "too-many", max: 4 },
    ],
  );
  // Each download may take what is left of the total, at most a file's limit.
  assert.deepEqual(
    fake.downloads.map(({ url, maxBytes }) => [url, maxBytes]),
    [
      ["attachment://big.txt", 10],
      ["attachment://a.txt", 10],
      ["attachment://b.txt", 9],
      ["attachment://c.zip", 3],
    ],
  );

  const archive = new FakeAttachments();
  archive.files.set("attachment://c.zip", zip([{ name: "x.txt", data: "x".repeat(50) }]));
  const [over] = await gatherAttachments(
    archive,
    [{ ...texts[0], text: "attachment://c.zip" } as (typeof texts)[0]],
    dir(),
    { ...limits, "max-extracted-bytes": 10 },
    signal(),
  );
  assert.deepEqual(over?.problem, { kind: "not-extracted", reason: "too-large" });
  assert.equal(over?.file, "01-c.zip");

  const off = dir();
  const [kept] = await gatherAttachments(
    archive,
    [{ ...texts[0], text: "attachment://c.zip" } as (typeof texts)[0]],
    off,
    { ...limits, "max-extracted-bytes": 0 },
    signal(),
  );
  assert.equal(kept?.problem, undefined);
  assert.deepEqual(readdirSync(off).sort(), ["01-c.zip", "README.md"]);
  assert.match(readFileSync(join(off, "README.md"), "utf8"), /extraction is off/);
});

test("gz archives, skipped entries, and a damaged archive", async () => {
  const fake = new FakeAttachments();
  fake.files.set("attachment://log.txt.gz", gzipSync("hello"));
  fake.files.set(
    "attachment://links.zip",
    zip([
      { name: "ok.txt", data: "ok" },
      { name: "link", type: "symlink", data: "/etc/passwd" },
    ]),
  );
  fake.files.set("attachment://broken.zip", Buffer.from("not a zip"));
  const out = dir();
  const entries = await gatherAttachments(
    fake,
    [
      {
        where: { kind: "issue", number: 1 },
        label: "the issue's body",
        text: "attachment://log.txt.gz attachment://links.zip attachment://broken.zip",
      },
    ],
    out,
    limits,
    signal(),
  );
  assert.equal(readFileSync(join(out, "01-log.txt.gz.extracted/log.txt"), "utf8"), "hello");
  assert.deepEqual(
    entries.map((entry) => entry.problem),
    [
      undefined,
      { kind: "partly-extracted", skipped: 1 },
      { kind: "not-extracted", reason: "invalid", detail: "not a ZIP archive" },
    ],
  );
  assert.match(
    readFileSync(join(out, "README.md"), "utf8"),
    /Skipped, never written: `link \(link\)`/,
  );
});

test("nothing is written without links, or with downloads off; time out leaves the rest", async () => {
  const fake = new FakeAttachments();
  const none = dir();
  assert.deepEqual(
    await gatherAttachments(
      fake,
      [{ where: { kind: "issue", number: 1 }, label: "the issue's body", text: "No files." }],
      none,
      limits,
      signal(),
    ),
    [],
  );
  assert.ok(!existsSync(none));
  const off = dir();
  assert.deepEqual(
    await gatherAttachments(
      fake,
      attachmentTexts(task),
      off,
      { ...limits, "max-attachments": 0 },
      signal(),
    ),
    [],
  );
  assert.ok(!existsSync(off));
  assert.deepEqual(fake.downloads, []);

  const stopped = new AbortController();
  stopped.abort();
  const entries = await gatherAttachments(
    fake,
    attachmentTexts(task),
    dir(),
    limits,
    stopped.signal,
  );
  assert.ok(entries.every((entry) => entry.problem?.kind === "timed-out"));
  assert.deepEqual(fake.downloads, []);
});

test("each problem reads as a short reason", () => {
  assert.equal(
    describeProblem({ kind: "too-large", max: 10 }),
    "not downloaded: over 10 bytes (max-attachment-bytes)",
  );
  assert.equal(
    describeProblem({ kind: "refused", detail: "HTTP 404" }),
    "not downloaded: the platform refused it (HTTP 404)",
  );
  assert.equal(
    describeProblem({ kind: "not-extracted", reason: "too-many-files" }),
    "not extracted: it would be over what is left of max-extracted-files",
  );
});
