import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { hasGit } from "./git.ts";
import { GitHubFake } from "./github.ts";
import { acme } from "./testing.ts";
import { readZip, writeZip } from "./zip.ts";

const skip = hasGit() ? false : "git is not on the PATH";
const fake = new GitHubFake();
let origin = "";
// biome-ignore lint/suspicious/noExplicitAny: the bodies are the fake's, checked field by field.
type Body = Record<string, any>;
const SERVICE = "/twirp/github.actions.results.api.v1.ArtifactService";

before(async () => {
  if (skip) return;
  origin = await fake.listen();
});
after(() => fake.close());
beforeEach(async () => {
  if (skip) return;
  fake.server.reset();
  await acme(fake);
});

/** The backend IDs `@actions/artifact` reads from the runtime token's `scp` claim. */
function backendIds(runtimeToken: string) {
  const payload = JSON.parse(
    Buffer.from(runtimeToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  );
  const scope = (payload.scp as string)
    .split(" ")
    .find((part) => part.startsWith("Actions.Results:"));
  const [, run = "", job = ""] = (scope ?? "").split(":");
  return { workflow_run_backend_id: run, workflow_job_run_backend_id: job };
}

async function twirp(runtimeToken: string, method: string, body: unknown) {
  const response = await fetch(`${origin}${SERVICE}/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${runtimeToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Body };
}

/** An upload as upload-artifact v7 does it: create, Azure blocks, block list, finalize. */
async function upload(runtimeToken: string, name: string, zip: Buffer) {
  const ids = backendIds(runtimeToken);
  const created = await twirp(runtimeToken, "CreateArtifact", {
    ...ids,
    name,
    version: 7,
    mime_type: "application/zip",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const url = new URL(created.body.signed_upload_url);
  const blocks = [zip.subarray(0, 10), zip.subarray(10)];
  const blockIds: string[] = [];
  for (const [index, block] of blocks.entries()) {
    const id = Buffer.from(`block-${index}`).toString("base64");
    blockIds.push(id);
    const put = new URL(url);
    put.searchParams.set("comp", "block");
    put.searchParams.set("blockid", id);
    assert.equal((await fetch(put, { method: "PUT", body: block })).status, 201);
  }
  const list = new URL(url);
  list.searchParams.set("comp", "blocklist");
  const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`;
  assert.equal((await fetch(list, { method: "PUT", body: xml })).status, 201);
  const digest = createHash("sha256").update(zip).digest("hex");
  return twirp(runtimeToken, "FinalizeArtifact", {
    ...ids,
    name,
    size: String(zip.length),
    hash: `sha256:${digest}`,
  });
}

test("an artifact uploads, lists and downloads as the pinned artifact actions do it", {
  skip,
}, async () => {
  const run = fake.startRun({
    repository: "acme/app",
    workflow: ".github/workflows/codeman.yml",
    event: "schedule",
  });
  const select = fake.startJob(run.id, "Select tasks");
  const zip = writeZip([
    { path: "task/tasks.json", data: Buffer.from('[{"task":1}]\n') },
    { path: "task/.hidden", data: Buffer.from("x".repeat(500)) },
  ]);
  const finalized = await upload(select.runtimeToken, "codeman-task", zip);
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.ok, true);
  const id = finalized.body.artifact_id as string;
  // Another job of the run finds it by name, then downloads it from the signed URL.
  const apply = fake.startJob(run.id, "Apply");
  const ids = backendIds(apply.runtimeToken);
  const listed = await twirp(apply.runtimeToken, "ListArtifacts", {
    ...ids,
    name_filter: "codeman-task",
  });
  assert.equal(listed.body.artifacts.length, 1);
  const [artifact] = listed.body.artifacts;
  assert.equal(artifact.database_id, id);
  assert.equal(artifact.size, String(zip.length));
  assert.equal(artifact.digest, `sha256:${createHash("sha256").update(zip).digest("hex")}`);
  const signed = await twirp(apply.runtimeToken, "GetSignedArtifactURL", {
    workflow_run_backend_id: artifact.workflow_run_backend_id,
    workflow_job_run_backend_id: artifact.workflow_job_run_backend_id,
    name: artifact.name,
  });
  const download = await fetch(signed.body.signed_url);
  assert.equal(download.headers.get("content-type"), "application/zip");
  const files = readZip(Buffer.from(await download.arrayBuffer()));
  assert.deepEqual(
    files.map((file) => [file.path, file.data.length]),
    [
      ["task/tasks.json", 13],
      ["task/.hidden", 500],
    ],
  );
  // next-run's gh api, and Codeman's CI results, read it over REST.
  const token = fake.jobToken("acme/app", { actions: "read" }).value;
  const rest = await fetch(
    `${origin}/api/v3/repos/acme/app/actions/runs/${run.id}/artifacts?per_page=100`,
    {
      headers: { authorization: `token ${token}` },
    },
  );
  const body = (await rest.json()) as {
    total_count: number;
    artifacts: { name: string; id: number }[];
  };
  assert.deepEqual(
    body.artifacts.map((a) => a.name),
    ["codeman-task"],
  );
  const zipped = await fetch(`${origin}/api/v3/repos/acme/app/actions/artifacts/${id}/zip`, {
    headers: { authorization: `token ${token}` },
    redirect: "manual",
  });
  assert.equal(zipped.status, 302);
  const followed = await fetch(zipped.headers.get("location") ?? "");
  assert.deepEqual(Buffer.from(await followed.arrayBuffer()), zip);
  assert.equal(fake.violations.length, 0);
});

test("the artifact service refuses what GitHub's refuses", { skip }, async () => {
  const run = fake.startRun({
    repository: "acme/app",
    workflow: ".github/workflows/codeman.yml",
    event: "schedule",
  });
  const job = fake.startJob(run.id, "Select tasks");
  const zip = writeZip([{ path: "a.txt", data: Buffer.from("a") }]);
  assert.equal((await upload(job.runtimeToken, "codeman-task", zip)).status, 200);
  const again = await twirp(job.runtimeToken, "CreateArtifact", {
    ...backendIds(job.runtimeToken),
    name: "codeman-task",
    version: 7,
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "already_exists");
  const other = fake.startRun({
    repository: "acme/app",
    workflow: ".github/workflows/codeman.yml",
    event: "schedule",
  });
  const otherJob = fake.startJob(other.id, "Select tasks");
  const listed = await twirp(
    otherJob.runtimeToken,
    "ListArtifacts",
    backendIds(otherJob.runtimeToken),
  );
  assert.deepEqual(listed.body.artifacts, [], "another run's artifacts are not this run's");
  const foreign = await twirp(otherJob.runtimeToken, "ListArtifacts", backendIds(job.runtimeToken));
  assert.equal(foreign.status, 403);
  const forged = await twirp("not.a.token", "ListArtifacts", {});
  assert.equal(forged.status, 401);
  assert.equal(fake.violations.at(-1)?.kind, "unknown-token");
  const created = await twirp(job.runtimeToken, "CreateArtifact", {
    ...backendIds(job.runtimeToken),
    name: "bad",
    version: 7,
  });
  const url = new URL(created.body.signed_upload_url);
  url.searchParams.set("sig", "00");
  assert.equal((await fetch(url, { method: "PUT", body: "x" })).status, 403);
});

test("the simulator's direct path stores the same artifact the REST API serves", {
  skip,
}, async () => {
  const run = fake.startRun({
    repository: "acme/app",
    workflow: ".github/workflows/codeman.yml",
    event: "schedule",
  });
  const artifact = fake.uploadArtifact(run.id, "codeman-chain-1", { "chain/moved": "1\n" });
  assert.deepEqual(
    [...fake.artifactFiles(artifact.id)].map(([path, data]) => [path, data.toString()]),
    [["chain/moved", "1\n"]],
  );
  const job = fake.startJob(run.id, "Apply");
  const listed = await twirp(job.runtimeToken, "ListArtifacts", backendIds(job.runtimeToken));
  assert.deepEqual(
    listed.body.artifacts.map((a: { name: string }) => a.name),
    ["codeman-chain-1"],
  );
  const control = await fetch(`${origin}/_fake/github/artifacts/${artifact.id}/files`);
  assert.deepEqual(await control.json(), { "chain/moved": Buffer.from("1\n").toString("base64") });
});
