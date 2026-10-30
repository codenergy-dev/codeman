/**
 * What Docker Hub and its registry say about an image's tag, without pulling it: the tag's date
 * and index digest, the linux/amd64 manifest's digest, compressed size and layers, and its
 * configuration (entry point, command, user, environment, labels) with the history's steps, as
 * docs/web/tools/docker-hub.md describes.
 *
 * Usage: node experiments/multi-service-pods/bootstrap/inspect.ts <namespace/repository:tag>
 */
const [reference] = process.argv.slice(2);
const [repository, tag] = (reference ?? "").split(":");
if (!repository || !tag) {
  console.error("Usage: node inspect.ts <namespace/repository:tag>");
  process.exit(2);
}

/** The fields read here: Docker Hub's tag, the registry's manifest and the image's config. */
interface Tag {
  digest: string;
  tag_last_pushed: string;
  images: { architecture: string; os: string; digest: string; size: number }[];
}
interface Manifest {
  config: { digest: string };
  layers: { mediaType: string; digest: string; size: number }[];
}
interface Config {
  created: string;
  config: {
    Entrypoint?: string[];
    Cmd?: string[];
    User?: string;
    WorkingDir?: string;
    Env?: string[];
    Labels?: Record<string, string>;
  };
  history: { created_by?: string }[];
}

async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

const hub = await json<Tag>(`https://hub.docker.com/v2/repositories/${repository}/tags/${tag}`);
const amd64 = hub.images.find((image) => image.architecture === "amd64" && image.os === "linux");
if (!amd64) throw new Error(`${reference} has no linux/amd64 image.`);
const { token } = await json<{ token: string }>(
  `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`,
);
const auth = { authorization: `Bearer ${token}` };
const manifest = await json<Manifest>(
  `https://registry-1.docker.io/v2/${repository}/manifests/${amd64.digest}`,
  {
    ...auth,
    accept:
      "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
  },
);
const config = await json<Config>(
  `https://registry-1.docker.io/v2/${repository}/blobs/${manifest.config.digest}`,
  auth,
);

console.log(
  JSON.stringify(
    {
      reference,
      indexDigest: hub.digest,
      lastPushed: hub.tag_last_pushed,
      amd64: { digest: amd64.digest, size: amd64.size, layers: manifest.layers.length },
      layerMediaTypes: [...new Set(manifest.layers.map((layer) => layer.mediaType))],
      firstLayer: manifest.layers[0],
      created: config.created,
      entrypoint: config.config.Entrypoint ?? null,
      cmd: config.config.Cmd ?? null,
      user: config.config.User || "(root)",
      workingDir: config.config.WorkingDir || null,
      env: config.config.Env,
      labels: config.config.Labels,
      // Each step that made the image, shortened: what it installed and from where.
      history: config.history.map((step) =>
        String(step.created_by ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 300),
      ),
    },
    null,
    2,
  ),
);
