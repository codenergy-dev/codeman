#!/bin/sh
# E5: scans an image's packages with Trivy and with Grype, each from its official image pinned by
# digest, and times each step. Each scanner reads the image from its registry, as a GitHub-hosted
# runner would, so none gets the Docker socket; its database is downloaded once, timed apart.
#
# Usage: experiments/multi-service-pods/bootstrap/scan.sh <command> ...
#   trivy <image@digest> <name>   Trivy's databases (timed, once), then its scan (timed).
#   grype <image@digest> <name>   The same with Grype.
#   summary                       Findings by severity, per scanner and image (summarize.ts).
# Reports go to .work/results/scan/, timings to .work/results/scan/times.txt.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
scan=$here/.work/scan
out=$here/.work/results/scan
mkdir -p "$scan/trivy-cache" "$scan/grype-cache" "$scan/tmp" "$out"
# Trivy v0.76.0 (2026-10-14) and Grype v0.120.1 (2026-10-06), by index digest.
trivy=aquasec/trivy@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222
grype=anchore/grype@sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe

# Runs "$@" and appends its wall time, in seconds, to times.txt under the label $label.
timed() {
  started=$(date +%s)
  "$@"
  echo "$label $(($(date +%s) - started))s" | tee -a "$out/times.txt"
}

case ${1:-} in
  trivy)
    run() {
      docker run --rm --memory 3g --memory-swap 3g -v "$scan/trivy-cache:/root/.cache/trivy" \
        -e TMPDIR=/scratch -v "$scan/tmp:/scratch" -v "$out:/out" "$@"
    }
    if [ ! -s "$scan/trivy-cache/db/trivy.db" ]; then
      label=trivy-db timed run "$trivy" image --download-db-only --no-progress
      label=trivy-java-db timed run "$trivy" image --download-java-db-only --no-progress
      du -sk "$scan/trivy-cache/db" "$scan/trivy-cache/java-db" | tee -a "$out/times.txt"
    fi
    label="trivy-$3" timed run "$trivy" image --image-src remote --skip-db-update \
      --skip-java-db-update --scanners vuln --no-progress --timeout 60m --format json \
      --output "/out/trivy-$3.json" "$2"
    ;;
  grype)
    run() {
      docker run --rm --memory 4g --memory-swap 4g -e GRYPE_DB_CACHE_DIR=/cache \
        -e TMPDIR=/scratch -v "$scan/grype-cache:/cache" -v "$scan/tmp:/scratch" \
        -v "$out:/out" "$@"
    }
    if [ -z "$(ls -A "$scan/grype-cache")" ]; then
      label=grype-db timed run "$grype" db update
      du -sk "$scan/grype-cache" | tee -a "$out/times.txt"
    fi
    label="grype-$3" timed run -e GRYPE_DB_AUTO_UPDATE=false -e GRYPE_CHECK_FOR_APP_UPDATE=false \
      "$grype" "registry:$2" -o json --file "/out/grype-$3.json"
    du -sk "$scan/tmp" | tee -a "$out/times.txt"
    ;;
  summary)
    node "$here/summarize.ts" "$out"
    ;;
  *)
    sed -n '2,10p' "$0"
    exit 2
    ;;
esac
