import type { GatewayArtifact } from "../action.ts";
import type { BootstrapArtifacts } from "../gateway/bootstrap.ts";
import type { EngineRelease, NodeRelease } from "../inference/images.ts";
import {
  type AdvisoryDatabase,
  type OsvQuery,
  type OsvRecord,
  OsvUnavailable,
} from "../inference/osv.ts";
import { MemoryReleaseCheckCache } from "../inference/release-policy.ts";
import type { PodReleases } from "../inference/resolution.ts";

/** The commit a test's gateway is from. */
export const TEST_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A test's gateway, as `gatewayArtifact` gives it from a checkout of `TEST_COMMIT`. */
export const TEST_GATEWAY: GatewayArtifact = {
  url: `https://raw.githubusercontent.com/codenergy-dev/codeman/${TEST_COMMIT}/dist/gateway.js`,
  sha256: "a".repeat(64),
  commit: TEST_COMMIT,
};

/** A test's Node.js, published long before the tests' clocks, with no advisory database. */
export const TEST_NODE: NodeRelease = {
  url: "https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.gz",
  sha256: "b".repeat(64),
  release: {
    name: "node",
    version: "24.22.1",
    publishedAt: "2026-08-01T00:00:00Z",
    provenance: { shasumsSigned: true },
  },
};

/** What a test's pod downloads: `TEST_NODE` and `TEST_GATEWAY`. */
export const TEST_BOOTSTRAP: BootstrapArtifacts = {
  node: { url: TEST_NODE.url, sha256: TEST_NODE.sha256 },
  gateway: { url: TEST_GATEWAY.url, sha256: TEST_GATEWAY.sha256 },
};

/** A test's catalog of official images, published long before the tests' clocks. */
export const TEST_ENGINES: Readonly<Record<string, EngineRelease>> = {
  ollama: {
    image: `docker.io/ollama/ollama@sha256:${"c".repeat(64)}`,
    release: {
      name: "ollama",
      version: "0.40.10",
      publishedAt: "2026-08-01T00:00:00Z",
      osv: { ecosystem: "Go", package: "github.com/ollama/ollama" },
      provenance: { commitVerified: true },
    },
    exceptions: [],
  },
  vllm: {
    image: `docker.io/vllm/vllm-openai@sha256:${"d".repeat(64)}`,
    release: {
      name: "vllm",
      version: "0.32.0",
      publishedAt: "2026-08-01T00:00:00Z",
      osv: { ecosystem: "PyPI", package: "vllm" },
    },
    exceptions: [],
  },
};

/**
 * OSV.dev in memory: the advisories each package's versions have, by `ecosystem/name@version`,
 * and their records; `down` makes every call an outage.
 */
export class FakeOsv implements AdvisoryDatabase {
  readonly affected = new Map<string, string[]>();
  readonly known = new Map<string, OsvRecord>();
  readonly asked: OsvQuery[] = [];
  down = false;

  /** Records an advisory of `version` of a package, high unless `severity` says. */
  advise(
    ecosystem: string,
    name: string,
    version: string,
    advisory: { id: string; severity?: string; fixed?: string; summary?: string },
  ): void {
    const key = `${ecosystem}/${name}@${version}`;
    this.affected.set(key, [...(this.affected.get(key) ?? []), advisory.id]);
    this.known.set(advisory.id, {
      id: advisory.id,
      summary: advisory.summary ?? "A flaw",
      database_specific: { severity: advisory.severity ?? "HIGH" },
      affected: [
        {
          package: { ecosystem, name },
          ranges: [
            {
              type: "ECOSYSTEM",
              events: [{ introduced: "0" }, ...(advisory.fixed ? [{ fixed: advisory.fixed }] : [])],
            },
          ],
        },
      ],
    });
  }

  async query(queries: readonly OsvQuery[]): Promise<string[][]> {
    if (this.down) throw new OsvUnavailable("OSV.dev could not be reached: connect ECONNREFUSED.");
    this.asked.push(...queries);
    return queries.map(
      (query) =>
        this.affected.get(`${query.package.ecosystem}/${query.package.name}@${query.version}`) ??
        [],
    );
  }

  async records(ids: readonly string[]): Promise<Map<string, OsvRecord>> {
    if (this.down) throw new OsvUnavailable("OSV.dev could not be reached: connect ECONNREFUSED.");
    return new Map(
      ids.flatMap((id) => (this.known.has(id) ? [[id, this.known.get(id)]] : [])) as [
        string,
        OsvRecord,
      ][],
    );
  }
}

/** Releases for a test's pods: the test catalog, a `FakeOsv` and a cache in memory. */
export function fakeReleases(
  more: Partial<Omit<PodReleases, "osv" | "cache">> & {
    osv?: FakeOsv;
    cache?: MemoryReleaseCheckCache;
  } = {},
): PodReleases & { osv: FakeOsv; cache: MemoryReleaseCheckCache } {
  return {
    gateway: () => TEST_GATEWAY,
    engines: TEST_ENGINES,
    node: TEST_NODE,
    ...more,
    osv: more.osv ?? new FakeOsv(),
    cache: more.cache ?? new MemoryReleaseCheckCache(),
  };
}
