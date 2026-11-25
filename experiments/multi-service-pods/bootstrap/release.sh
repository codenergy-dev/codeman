#!/bin/sh
# Makes the simulated release that pods download: Node's official linux-x64 tarball, checked
# against nodejs.org's SHASUMS256.txt, and Codeman's dist/gateway.js, in .work/release/, with
# release.env, the variables a pod would be created with (URLs and SHA-256 digests).
#
# Usage: experiments/multi-service-pods/bootstrap/release.sh [base-url]
#   base-url  where pods reach the release, http://host.docker.internal:8765 by default (serve.ts).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
base=${1:-http://host.docker.internal:8765}
version=v24.21.0
tarball=node-$version-linux-x64.tar.gz
# Downloads go in their own directory, apart from the scripts.
release=$here/.work/release
mkdir -p "$release"

if [ ! -s "$release/$tarball" ]; then
  curl -fsSL -o "$release/$tarball.part" "https://nodejs.org/dist/$version/$tarball"
  mv "$release/$tarball.part" "$release/$tarball"
fi
curl -fsSL -o "$release/SHASUMS256.txt" "https://nodejs.org/dist/$version/SHASUMS256.txt"
node_sha256=$(awk -v f="$tarball" '$2 == f { print $1 }' "$release/SHASUMS256.txt")
actual=$(shasum -a 256 "$release/$tarball" | cut -d ' ' -f 1)
if [ -z "$node_sha256" ] || [ "$actual" != "$node_sha256" ]; then
  echo "$tarball is $actual; SHASUMS256.txt says '$node_sha256'." >&2
  rm -f "$release/$tarball"
  exit 1
fi

# The gateway as dist/ has it (npm run build), which the pod images ship today.
cp "$repo/dist/gateway.js" "$release/gateway.js"
gateway_sha256=$(shasum -a 256 "$release/gateway.js" | cut -d ' ' -f 1)

cat > "$release/release.env" <<EOF
CODEMAN_NODE_URL=$base/$tarball
CODEMAN_NODE_SHA256=$node_sha256
CODEMAN_GATEWAY_URL=$base/gateway.js
CODEMAN_GATEWAY_SHA256=$gateway_sha256
EOF
cat "$release/release.env"
