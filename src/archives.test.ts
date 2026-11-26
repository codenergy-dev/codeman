import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { archiveKind, type ExtractBudget, extractArchive } from "./archives.ts";
import { paxPath, tar, zip } from "./testing/archives.ts";

const budget = (bytes = 1_000_000, files = 100): ExtractBudget => ({ bytes, files });

function target(): string {
  return join(mkdtempSync(join(tmpdir(), "codeman-archives-")), "out");
}

/** Every path under `dir`, `/` after directories, sorted. */
function tree(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? [`${prefix}${entry.name}/`, ...tree(join(dir, entry.name), `${prefix}${entry.name}/`)]
        : [`${prefix}${entry.name}`],
    )
    .sort();
}

test("knows archives by their extension, in any case", () => {
  assert.equal(archiveKind("data.zip"), "zip");
  assert.equal(archiveKind("DATA.ZIP"), "zip");
  assert.equal(archiveKind("data.tar.gz"), "tar.gz");
  assert.equal(archiveKind("data.tgz"), "tar.gz");
  assert.equal(archiveKind("data.tar"), "tar");
  assert.equal(archiveKind("log.txt.gz"), "gz");
  assert.equal(archiveKind("data.csv"), undefined);
  assert.equal(archiveKind("zip"), undefined);
});

test("extracts a ZIP's files and directories, stored or deflated", () => {
  const out = target();
  const left = budget();
  const result = extractArchive(
    "data.zip",
    zip([
      { name: "data/", type: "dir" },
      { name: "data/a.csv", data: "x,y\n1,2\n" },
      { name: "data/sub/b.txt", data: "b", stored: true },
      { name: "empty.txt", data: "" },
    ]),
    out,
    left,
  );
  assert.deepEqual(result, { ok: true, value: { files: 3, bytes: 9, skipped: [] } });
  assert.deepEqual(tree(out), ["data/", "data/a.csv", "data/sub/", "data/sub/b.txt", "empty.txt"]);
  assert.equal(readFileSync(join(out, "data/a.csv"), "utf8"), "x,y\n1,2\n");
  assert.deepEqual(left, { bytes: 1_000_000 - 9, files: 97 });
});

test("skips a ZIP's links, special files, unsafe paths, encrypted entries and bad CRCs", () => {
  const out = target();
  const result = extractArchive(
    "evil.zip",
    zip([
      { name: "link", type: "symlink", data: "/etc/passwd" },
      { name: "pipe", type: "fifo" },
      { name: "../escape.txt", data: "no" },
      { name: "/etc/absolute.txt", data: "no" },
      { name: "C:/windows.txt", data: "no" },
      { name: "a/../../up.txt", data: "no" },
      { name: "bell\u0007.txt", data: "no" },
      { name: "secret.txt", data: "no", encrypted: true },
      { name: "crc.txt", data: "no", badCrc: true },
      { name: "ok.txt", data: "yes" },
      { name: "ok.txt", data: "again" },
    ]),
    out,
    budget(),
  );
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(tree(out), ["ok.txt"]);
  assert.equal(readFileSync(join(out, "ok.txt"), "utf8"), "yes");
  assert.deepEqual(result.value.skipped, [
    { path: "link", reason: "link" },
    { path: "pipe", reason: "special" },
    { path: "../escape.txt", reason: "unsafe-path" },
    { path: "/etc/absolute.txt", reason: "unsafe-path" },
    { path: "C:/windows.txt", reason: "unsafe-path" },
    { path: "a/../../up.txt", reason: "unsafe-path" },
    { path: "bell\u0007.txt", reason: "unsafe-path" },
    { path: "secret.txt", reason: "encrypted" },
    { path: "crc.txt", reason: "corrupt" },
    { path: "ok.txt", reason: "exists" },
  ]);
  assert.ok(!existsSync(join(out, "..", "escape.txt")));
});

test("extracts nothing from an archive over the limits, and keeps the budget", () => {
  const archive = zip([
    { name: "a.txt", data: "a".repeat(600) },
    { name: "b.txt", data: "b".repeat(600) },
  ]);
  const bytes = budget(1000);
  const out = target();
  assert.deepEqual(extractArchive("big.zip", archive, out, bytes), {
    ok: true,
    value: { files: 0, bytes: 0, skipped: [], stopped: "too-large" },
  });
  assert.deepEqual(tree(out), []);
  assert.deepEqual(bytes, { bytes: 1000, files: 100 });

  const files = budget(1_000_000, 1);
  assert.deepEqual(extractArchive("many.zip", archive, target(), files), {
    ok: true,
    value: { files: 0, bytes: 0, skipped: [], stopped: "too-many-files" },
  });
});

test("a ZIP entry that inflates past its declared size is not written", () => {
  // A bomb: 10 MB of zeros that claim to be 10 bytes, within any budget it is checked against.
  const out = target();
  const result = extractArchive(
    "bomb.zip",
    zip([{ name: "zeros", data: Buffer.alloc(10_000_000), declaredSize: 10 }]),
    out,
    budget(100),
  );
  assert.deepEqual(result, {
    ok: true,
    value: { files: 0, bytes: 0, skipped: [{ path: "zeros", reason: "corrupt" }] },
  });
  assert.deepEqual(tree(out), []);
});

test("a nested archive stays a file", () => {
  const inner = zip([{ name: "inner.txt", data: "inner" }]);
  const out = target();
  assert.ok(
    extractArchive("outer.zip", zip([{ name: "inner.zip", data: inner }]), out, budget()).ok,
  );
  assert.deepEqual(tree(out), ["inner.zip"]);
});

test("refuses what is not a ZIP, or is ZIP64", () => {
  assert.deepEqual(extractArchive("x.zip", Buffer.from("not a zip"), target(), budget()), {
    ok: false,
    error: "not a ZIP archive",
  });
  const zip64 = zip([{ name: "a.txt", data: "a" }]);
  zip64.writeUInt32LE(0xffffffff, zip64.length - 6);
  assert.deepEqual(extractArchive("x.zip", zip64, target(), budget()), {
    ok: false,
    error: "a ZIP64 archive, which Codeman does not extract",
  });
});

test("extracts a tar.gz, with long names and pax paths, and skips links", () => {
  const long = `${"d".repeat(60)}/${"f".repeat(60)}.txt`;
  const archive = gzipSync(
    Buffer.concat([
      tar([
        { name: "dir", type: "dir" },
        { name: "dir/a.csv", data: "1,2\n" },
        { name: long, data: "long" },
        { name: "link", type: "symlink" },
        { name: "hard", type: "hardlink" },
        { name: "../up.txt", data: "no" },
      ]).subarray(0, -1024),
      paxPath("from-pax.txt"),
      tar([{ name: "ignored-name.txt", data: "pax" }]),
    ]),
  );
  const out = target();
  const result = extractArchive("data.tgz", archive, out, budget());
  assert.deepEqual(result, {
    ok: true,
    value: {
      files: 3,
      bytes: 11,
      skipped: [
        { path: "link", reason: "link" },
        { path: "hard", reason: "link" },
        { path: "../up.txt", reason: "unsafe-path" },
      ],
    },
  });
  assert.deepEqual(tree(out), [
    `${"d".repeat(60)}/`,
    `${long}`,
    "dir/",
    "dir/a.csv",
    "from-pax.txt",
  ]);
  assert.equal(readFileSync(join(out, "from-pax.txt"), "utf8"), "pax");
});

test("a tar's checksum must match, and its entries fit in it", () => {
  const archive = tar([{ name: "a.txt", data: "a" }]);
  archive[0] = "b".charCodeAt(0);
  assert.deepEqual(extractArchive("x.tar", archive, target(), budget()), {
    ok: false,
    error: "a tar header's checksum does not match",
  });
  const cut = tar([{ name: "a.txt", data: "a".repeat(2000) }]).subarray(0, 1024);
  assert.deepEqual(extractArchive("x.tar", cut, target(), budget()), {
    ok: false,
    error: "the tar archive ends inside an entry",
  });
});

test("a gzip bomb stops at the limit, and a .gz holds one file", () => {
  const out = target();
  assert.deepEqual(extractArchive("log.txt.gz", gzipSync("hello"), out, budget()), {
    ok: true,
    value: { files: 1, bytes: 5, skipped: [] },
  });
  assert.deepEqual(tree(out), ["log.txt"]);
  assert.ok(lstatSync(join(out, "log.txt")).isFile());

  const bomb = gzipSync(Buffer.alloc(50_000_000));
  assert.deepEqual(extractArchive("zeros.gz", bomb, target(), budget(1000)), {
    ok: true,
    value: { files: 0, bytes: 0, skipped: [], stopped: "too-large" },
  });
  assert.deepEqual(extractArchive("bomb.tgz", bomb, target(), budget(1000)), {
    ok: true,
    value: { files: 0, bytes: 0, skipped: [], stopped: "too-large" },
  });
  assert.deepEqual(extractArchive("x.gz", Buffer.from("not gzip"), target(), budget()), {
    ok: false,
    error: "not a gzip file",
  });
});
