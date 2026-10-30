/**
 * The command of a pod that starts from an engine's official image: it downloads Node.js and
 * Codeman's gateway, checks each one's SHA-256, then runs the gateway, which starts the image's
 * engine (plan to start pods from official engine images, "The bootstrap, in two stages").
 *
 * 1. **Shell.** POSIX `sh` downloads Node.js's linux-x64 `.tar.gz` with the first of `curl`,
 *    `wget`, `python3` or `openssl s_client` the image has, checks it with `sha256sum`,
 *    `openssl dgst` or Python, and unpacks only `bin/node`.
 * 2. **Node.js.** A short inline script downloads the gateway, following redirects, checks it,
 *    writes it, and runs it in its own place (`process.execve`), or as its child, forwarding
 *    signals, when that is not available (docs/web/nodejs/node-doc-api-process-md-at-ce7aaf1.md).
 *
 * Any failure or mismatch exits non-zero with a message, before anything downloaded runs. The
 * command is the same for every pod of a Codeman version: the URLs and digests reach it through
 * the pod's environment (`bootstrapEnvironment`), since neither provider expands variables in a
 * command ([Runpod](../../docs/web/runpod/runpod-rest-api.md#the-containers-command),
 * [Salad](../../docs/web/salad/specifying-a-command.md)).
 */

/** A file the pod downloads, and the SHA-256 it must have. */
export interface BootstrapArtifact {
  url: string;
  sha256: string;
}

/** What the bootstrap downloads: Node.js's linux-x64 tarball, then the gateway. */
export interface BootstrapArtifacts {
  node: BootstrapArtifact;
  gateway: BootstrapArtifact;
}

/** The pod's environment variables that carry the artifacts to the command. */
export const BOOTSTRAP_VARIABLES = {
  nodeUrl: "CODEMAN_BOOTSTRAP_NODE_URL",
  nodeSha256: "CODEMAN_BOOTSTRAP_NODE_SHA256",
  gatewayUrl: "CODEMAN_BOOTSTRAP_GATEWAY_URL",
  gatewaySha256: "CODEMAN_BOOTSTRAP_GATEWAY_SHA256",
  /** Where the files go, `/tmp/codeman` when unset. Codeman never sets it; tests do. */
  home: "CODEMAN_BOOTSTRAP_HOME",
} as const;

/**
 * Salad's `container.command`: at most 100 items of 1 to 1,000 characters, each one line
 * (docs/web/salad/create-container-group.md).
 */
export const SALAD_COMMAND_LIMITS = { items: 100, itemCharacters: 1000 } as const;

/** Runpod's whole create request, the command included (docs/web/runpod/runpod-rest-api.md). */
export const RUNPOD_REQUEST_BYTES = 102_400;

/** The pod's command, in each provider's form, and the environment it reads. */
export interface PodBootstrap {
  /** The variables to add to the pod's environment. */
  env: Record<string, string>;
  /** Salad's `container.command`: the first item replaces the image's entry point. */
  command: string[];
  /** Runpod's `entrypoint` and `cmd`, in exec form: the same command. */
  entrypoint: string[];
  cmd: string[];
}

/** The pod's command and environment, for these artifacts. Throws when one is not usable. */
export function podBootstrap(artifacts: BootstrapArtifacts): PodBootstrap {
  const command = bootstrapCommand();
  const [entrypoint, ...cmd] = command;
  return { env: bootstrapEnvironment(artifacts), command, entrypoint: [entrypoint as string], cmd };
}

/** The variables of `BOOTSTRAP_VARIABLES` for these artifacts, checked. */
export function bootstrapEnvironment(artifacts: BootstrapArtifacts): Record<string, string> {
  const node = checkedArtifact("Node.js", artifacts.node);
  const gateway = checkedArtifact("The gateway", artifacts.gateway);
  // The shell unpacks `<name>/bin/node`, the tarball's top directory named as its file is.
  if (!NODE_TARBALL.test(new URL(node.url).pathname)) {
    throw new Error(
      `Node.js's URL must name a linux-x64 .tar.gz, such as node-v24.22.1-linux-x64.tar.gz: ${node.url}`,
    );
  }
  return {
    [BOOTSTRAP_VARIABLES.nodeUrl]: node.url,
    [BOOTSTRAP_VARIABLES.nodeSha256]: node.sha256,
    [BOOTSTRAP_VARIABLES.gatewayUrl]: gateway.url,
    [BOOTSTRAP_VARIABLES.gatewaySha256]: gateway.sha256,
  };
}

/** The file name of Node.js's linux-x64 tarball. */
const NODE_TARBALL = /\/node-v\d+\.\d+\.\d+-linux-x64\.tar\.gz$/;

/**
 * An artifact whose URL is HTTP or HTTPS, of printable ASCII without spaces, which `openssl_get`
 * writes into its request line, and whose SHA-256 is 64 hex digits, lowercased. Only HTTPS works
 * where the image has only `openssl`; the SHA-256, not TLS, is what makes the file trusted.
 */
function checkedArtifact(what: string, artifact: BootstrapArtifact): BootstrapArtifact {
  const sha256 = artifact.sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`${what}'s SHA-256 must be 64 hex digits: '${artifact.sha256}'.`);
  }
  let protocol: string | undefined;
  try {
    protocol = new URL(artifact.url).protocol;
  } catch {
    protocol = undefined;
  }
  if ((protocol !== "https:" && protocol !== "http:") || /[^!-~]/.test(artifact.url)) {
    throw new Error(`${what}'s URL must be HTTP or HTTPS, without spaces: '${artifact.url}'.`);
  }
  return { url: artifact.url, sha256 };
}

/**
 * The command, in Salad's form: `sh -c` with one line of the script per item, which it joins
 * back and runs (`$0` is `bootstrap`). Checked against Salad's limits and Runpod's request size.
 */
export function bootstrapCommand(): string[] {
  const command = [
    "/bin/sh",
    "-c",
    'eval "$(printf \'%s\\n\' "$@")"',
    "bootstrap",
    ...scriptLines(),
  ];
  const problems = commandProblems(command);
  if (problems.length > 0) {
    throw new Error(
      `The bootstrap's command breaks the providers' limits: ${problems.join("; ")}.`,
    );
  }
  return command;
}

/**
 * Why a command breaks Salad's limits, or Runpod's request size on its own; empty when it fits.
 */
export function commandProblems(command: readonly string[]): string[] {
  const { items, itemCharacters } = SALAD_COMMAND_LIMITS;
  const bytes = Buffer.byteLength(
    JSON.stringify({ entrypoint: command.slice(0, 1), cmd: command.slice(1) }),
  );
  return [
    ...(command.length > items ? [`${command.length} items, above Salad's ${items}`] : []),
    ...command.flatMap((item, index) =>
      item.length === 0
        ? [`item ${index} is empty`]
        : item.length > itemCharacters
          ? [`item ${index} has ${item.length} characters, above Salad's ${itemCharacters}`]
          : /[\r\n]/.test(item)
            ? [`item ${index} spans several lines`]
            : [],
    ),
    ...(bytes > RUNPOD_REQUEST_BYTES
      ? [`${bytes} bytes, above Runpod's request of ${RUNPOD_REQUEST_BYTES}`]
      : []),
  ];
}

/** The script's lines, without blank lines, comments or indentation. */
function scriptLines(): string[] {
  return script()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * Stage 2, run by `node -e` with the gateway's path as its argument. Each line is a statement,
 * or opens or closes a block, so lines join with a space: none is a comment. It sits in the
 * shell's single quotes, so it has none. `process.execve` takes the new process's whole argument
 * list, from its name.
 */
// biome-ignore-start lint/suspicious/noTemplateCurlyInString: stage 2's own template literals.
const STAGE_2 = [
  'const { createHash } = require("node:crypto");',
  'const { writeFileSync } = require("node:fs");',
  "const env = process.env, file = process.argv[1];",
  `const url = env.${BOOTSTRAP_VARIABLES.gatewayUrl} ?? "", want = env.${BOOTSTRAP_VARIABLES.gatewaySha256} ?? "";`,
  "const fail = (message) => { console.error(`[bootstrap] ${message}`); process.exit(1); };",
  `if (!/^[0-9a-f]{64}$/.test(want)) fail(\`${BOOTSTRAP_VARIABLES.gatewaySha256} is not a SHA-256: "\${want}".\`);`,
  "const download = async () => {",
  "console.error(`[bootstrap] Downloading ${url} with Node.js.`);",
  "const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });",
  "if (!response.ok) throw new Error(`it answered ${response.status}`);",
  "const body = Buffer.from(await response.arrayBuffer());",
  'const actual = createHash("sha256").update(body).digest("hex");',
  "if (actual !== want) fail(`Refused ${url}: its SHA-256 is ${actual}, not ${want}.`);",
  "writeFileSync(file, body, { mode: 0o600 });",
  "};",
  "const run = () => {",
  'console.error("[bootstrap] Starting the gateway.");',
  "try { if (process.execve) process.execve(process.execPath, [process.execPath, file], env); } catch (error) { console.error(`[bootstrap] Running the gateway as a child: ${error.message}.`); }",
  'const child = require("node:child_process").spawn(process.execPath, [file], { stdio: "inherit" });',
  'for (const signal of ["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT", "SIGUSR2"]) process.on(signal, () => child.kill(signal));',
  'child.on("error", (error) => fail(`Could not start the gateway: ${error.message}.`));',
  'child.on("exit", (code) => process.exit(code ?? 1));',
  "};",
  "download().then(run, (error) => fail(`Could not download ${url}: ${error.message}.`));",
];
// biome-ignore-end lint/suspicious/noTemplateCurlyInString: stage 2's own template literals.

/** Characters of stage 2 per item, below Salad's 1,000 with the line that starts it. */
const STAGE_2_ITEM = 900;

/** Stage 2's lines, joined into as few items as fit. */
function packedStage2(): string[] {
  if (STAGE_2.some((line) => line.includes("'"))) throw new Error("Stage 2 holds a single quote.");
  return STAGE_2.reduce<string[]>((items, line) => {
    const last = items.at(-1);
    if (last !== undefined && last.length + 1 + line.length <= STAGE_2_ITEM) {
      items[items.length - 1] = `${last} ${line}`;
    } else items.push(line);
    return items;
  }, []);
}

/**
 * Stage 1, the shell script. `openssl_get` speaks HTTP/1.0 and follows no redirect, so Node.js's
 * URL must serve the file itself, as `nodejs.org/dist/` does
 * (docs/web/nodejs/index-of-dist-v24-22-1.md). Python's one-liners work from Python 3.6 on.
 */
function script(): string {
  const v = BOOTSTRAP_VARIABLES;
  return `
set -eu
home=\${${v.home}:-/tmp/codeman}
log() { echo "[bootstrap] $*" >&2; }
fail() { log "$*"; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

# HTTPS with openssl alone, as Ollama's image has it: HTTP/1.0, no redirects.
openssl_get() {
  case $1 in https://*) ;; *) fail "Only openssl to download $1, which is not HTTPS." ;; esac
  rest=\${1#https://}; authority=\${rest%%/*}; host=\${authority%:*}
  case $rest in */*) path=/\${rest#*/} ;; *) path=/ ;; esac
  case $authority in *:*) port=\${authority##*:} ;; *) port=443 ;; esac
  printf 'GET %s HTTP/1.0\\r\\nHost: %s\\r\\nConnection: close\\r\\n\\r\\n' "$path" "$authority" | openssl s_client -quiet -verify_return_error -verify_hostname "$host" -servername "$host" -connect "$host:$port" >"$2.http" 2>/dev/null || return 1
  # The headers' bytes, up to the empty line, and the status line, which must be 200.
  size=0 status= cr=$(printf '\\r')
  while IFS= read -r line; do
    status=\${status:-$line}; size=$((size + \${#line} + 1))
    [ "$line" = "$cr" ] && break
  done <"$2.http"
  case $status in "HTTP/1."?" 200 "*) ;; *) log "$1 answered '$status'."; return 1 ;; esac
  tail -c +$((size + 1)) "$2.http" >"$2" || return 1
  rm -f "$2.http"
}

# Downloads $1 to $2 with the first downloader the image has.
download() {
  if has curl; then log "Downloading $1 with curl."; curl -q -fsSL --retry 3 --connect-timeout 30 -o "$2" "$1"
  elif has wget; then log "Downloading $1 with wget."; wget -q -T 60 -O "$2" "$1"
  elif has python3; then log "Downloading $1 with python3."; python3 -I -c 'import shutil, sys, urllib.request as u; r = u.urlopen(sys.argv[1], timeout=60); f = open(sys.argv[2], "wb"); shutil.copyfileobj(r, f); f.close()' "$1" "$2"
  elif has openssl; then log "Downloading $1 with openssl."; openssl_get "$1" "$2"
  else fail "No curl, wget, python3 or openssl to download $1."
  fi
}

node_url=\${${v.nodeUrl}:-}; want=\${${v.nodeSha256}:-}
case $want in *[!0-9a-f]* | "") fail "${v.nodeSha256} is not a SHA-256: '$want'." ;; esac
[ \${#want} -eq 64 ] || fail "${v.nodeSha256} is not a SHA-256: '$want'."
name=\${node_url##*/}; name=\${name%.tar.gz}
case $name in node-v*-linux-x64) ;; *) fail "${v.nodeUrl} does not name Node.js's linux-x64 .tar.gz: '$node_url'." ;; esac
has tar && has gzip || fail "No tar and gzip to unpack Node.js."
mkdir -p "$home"
rm -rf "$home/node" "$home/unpack" "$home/node.tar.gz" "$home/gateway.mjs"
mkdir "$home/unpack"
download "$node_url" "$home/node.tar.gz" || fail "Could not download $node_url."
file=$home/node.tar.gz
if has sha256sum; then checker=sha256sum; actual=$(sha256sum "$file" | cut -d ' ' -f 1)
elif has openssl; then checker=openssl; actual=$(openssl dgst -sha256 -r "$file" | cut -d ' ' -f 1)
elif has python3; then checker=python3; actual=$(python3 -I -c 'import hashlib, sys; h = hashlib.sha256(); f = open(sys.argv[1], "rb"); [h.update(b) for b in iter(lambda: f.read(1 << 20), b"")]; print(h.hexdigest())' "$file")
else fail "No sha256sum, openssl or python3 to check $node_url."
fi
log "Checked $node_url with $checker."
[ "$actual" = "$want" ] || { rm -f "$file"; fail "Refused $node_url: its SHA-256 is '$actual', not $want."; }
# Only bin/node, owned by the user unpacking it, not by the tarball's UID.
gzip -dc "$file" | tar -xof - -C "$home/unpack" "$name/bin/node" || fail "Could not unpack $name/bin/node from $node_url."
mv "$home/unpack/$name/bin/node" "$home/node"
rm -rf "$home/unpack" "$file"
"$home/node" --version >/dev/null 2>&1 || fail "Node.js does not run in this image: it needs glibc on linux-x64."
exec "$home/node" -e '${packedStage2().join("\n")}' "$home/gateway.mjs"
`;
}
