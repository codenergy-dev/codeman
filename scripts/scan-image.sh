#!/bin/sh
# Scans an image's OS and language packages for known vulnerabilities with Trivy, before its digest
# is pinned (decision 4 of the plan to start pods from official engine images). Trivy runs from its
# official image, pinned by digest, and reads the scanned image from its registry, so the image is
# never pulled into Docker and Trivy gets no Docker socket. Prints the findings by severity, without
# `linux-libc-dev` (kernel headers, which a container never runs), and those that have a fix.
# Record the result in docs/development/dependencies.md#audit-log.
#
# Usage: scripts/scan-image.sh <registry/repository@sha256:digest>
#   scripts/scan-image.sh docker.io/vllm/vllm-openai@sha256:befccf0e…
#
# Environment:
#   SCAN_DIR     Where Trivy's databases, its temporary files and the reports go
#                (default: ${TMPDIR:-/tmp}/codeman-scan). The databases take about 3 GB.
#   SCAN_MEMORY  The container's memory limit (default: 4g).
# The report is written to $SCAN_DIR/reports/<repository>-<digest prefix>.json. A vLLM image takes
# 30 to 45 minutes; its temporary files are removed at the end.
set -eu

# Trivy v0.76.1 (2026-10-21), by its index digest: docs/web/docker-hub/aquasec-trivy-0-76-1.md.
scanner=aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c

image=${1:-}
case $image in
  *@sha256:*) ;;
  *)
    sed -n '2,17p' "$0" >&2
    echo "An image pinned by digest is required: <registry/repository@sha256:digest>." >&2
    exit 2
    ;;
esac
digest=${image##*@sha256:}
if ! printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "Not a SHA-256 digest: $digest" >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker does not answer: start it, then run this again." >&2
  exit 1
fi

dir=${SCAN_DIR:-${TMPDIR:-/tmp}/codeman-scan}
name=$(printf '%s' "${image%@*}" | sed 's|^docker\.io/||; s|[^A-Za-z0-9._-]|-|g')
report=$dir/reports/$name-$(printf '%s' "$digest" | cut -c1-12).json
mkdir -p "$dir/cache" "$dir/tmp" "$dir/reports"
trap 'rm -rf "$dir/tmp"' EXIT

trivy() {
  docker run --rm --memory "${SCAN_MEMORY:-4g}" --memory-swap "${SCAN_MEMORY:-4g}" \
    -v "$dir/cache:/root/.cache/trivy" -e TMPDIR=/scratch -v "$dir/tmp:/scratch" \
    -v "$dir/reports:/reports" "$scanner" "$@"
}

# The databases: the vulnerability one every run (it is rebuilt every few hours), Java's once a day.
trivy image --download-db-only --no-progress
if [ -z "$(find "$dir/cache/java-db" -name metadata.json -mtime -1 2>/dev/null)" ]; then
  trivy image --download-java-db-only --no-progress
fi

started=$(date +%s)
trivy image --image-src remote --skip-db-update --skip-java-db-update --cache-backend memory \
  --scanners vuln --no-progress --timeout 90m --format json \
  --output "/reports/$(basename "$report")" "$image"
echo "Scanned $image in $(($(date +%s) - started)) s; report: $report"

# The summary: Node is already the repository's requirement.
node --input-type=module - "$report" <<'EOF'
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
const SKIPPED = new Set(["linux-libc-dev"]);
const rows = [];
let skipped = 0;
for (const result of report.Results ?? []) {
  for (const v of result.Vulnerabilities ?? []) {
    if (SKIPPED.has(v.PkgName)) {
      skipped += 1;
      continue;
    }
    rows.push({ ...v, Class: result.Class, Target: result.Target });
  }
}
console.log(`Image: ${report.ArtifactName}`);
console.log(`OS: ${report.Metadata?.OS?.Family ?? "?"} ${report.Metadata?.OS?.Name ?? ""}`);
console.log(`Findings without ${[...SKIPPED].join(", ")}: ${rows.length} (${skipped} skipped)`);
console.log("Class        Severity   All  With a fix");
for (const kind of ["os-pkgs", "lang-pkgs"]) {
  for (const severity of SEVERITIES) {
    const all = rows.filter((v) => v.Class === kind && v.Severity === severity);
    if (all.length === 0) continue;
    const fixed = all.filter((v) => v.FixedVersion).length;
    console.log(
      `${kind.padEnd(12)} ${severity.padEnd(9)} ${String(all.length).padStart(4)}  ${String(fixed).padStart(10)}`,
    );
  }
}
const blocking = rows.filter(
  (v) => (v.Severity === "CRITICAL" || v.Severity === "HIGH") && v.FixedVersion,
);
console.log(`\nHigh and critical with a fix: ${blocking.length}`);
for (const v of blocking.sort((a, b) => a.Severity.localeCompare(b.Severity))) {
  console.log(
    `  ${v.Severity} ${v.VulnerabilityID} ${v.PkgName} ${v.InstalledVersion} -> ${v.FixedVersion} (${v.Target})`,
  );
}
EOF
