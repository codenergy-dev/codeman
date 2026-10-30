#!/bin/sh
# The entry command of a pod made from an engine's official image: downloads Node's linux-x64
# tarball and Codeman's gateway, checks each one's SHA-256, unpacks Node and runs the gateway,
# which starts the image's engine. On any failure or mismatch it exits 1 and runs nothing it
# downloaded. Its files go in /tmp/codeman, emptied first.
#
# Usage, as the pod's command: sh -c "$(cat bootstrap.sh)", or the per-line form command.ts
# builds, with CODEMAN_NODE_URL, CODEMAN_NODE_SHA256, CODEMAN_GATEWAY_URL and
# CODEMAN_GATEWAY_SHA256 in the environment.
set -eu
home=/tmp/codeman
fail() {
  echo "[bootstrap] $*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

# Downloads $1 to $2 with whichever downloader the image has.
download() {
  if has curl; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif has wget; then
    wget -q -O "$2" "$1"
  elif has python3; then
    python3 -I -c 'import shutil, sys, urllib.request as u
with u.urlopen(sys.argv[1], timeout=60) as r, open(sys.argv[2], "wb") as f: shutil.copyfileobj(r, f)' "$1" "$2"
  elif has openssl; then
    openssl_get "$1" "$2"
  else
    fail "No curl, wget, python3 or openssl to download $1."
  fi
}

# HTTPS with openssl alone, as Ollama's image has it: HTTP/1.0 on port 443, no redirects, so $1
# must be the file's final URL. The SHA-256 check, not TLS, is what makes the file trusted.
openssl_get() {
  case $1 in https://*) ;; *) fail "Only openssl to download $1, which is not HTTPS." ;; esac
  rest=${1#https://}
  host=${rest%%/*}
  printf 'GET /%s HTTP/1.0\r\nHost: %s\r\nConnection: close\r\n\r\n' "${rest#*/}" "$host" |
    openssl s_client -quiet -verify_return_error -verify_hostname "$host" \
      -servername "$host" -connect "$host:443" >"$2.http" 2>/dev/null || return 1
  # The headers' bytes, up to the empty line, and the status line, which must be 200.
  size=0 status=
  while IFS= read -r line; do
    status=${status:-$line}
    size=$((size + ${#line} + 1))
    [ "$line" = "$(printf '\r')" ] && break
  done <"$2.http"
  case $status in "HTTP/1."?" 200 "*) ;; *) return 1 ;; esac
  tail -c +$((size + 1)) "$2.http" >"$2"
  rm -f "$2.http"
}

# The SHA-256 of $1, in hex; empty when the image has no way to compute it.
sha256() {
  if has sha256sum; then
    sha256sum "$1"
  elif has python3; then
    python3 -I -c 'import hashlib, sys
h, f = hashlib.sha256(), open(sys.argv[1], "rb")
for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
print(h.hexdigest())' "$1"
  elif has openssl; then
    openssl dgst -sha256 -r "$1"
  fi | cut -d ' ' -f 1
}

# Downloads $1 to $2 and keeps it only if its SHA-256 is $3.
fetch() {
  case $3 in *[!0-9a-f]* | "") fail "Not a SHA-256 for $1: '$3'." ;; esac
  [ ${#3} -eq 64 ] || fail "Not a SHA-256 for $1: '$3'."
  download "$1" "$2" || fail "Could not download $1."
  actual=$(sha256 "$2")
  if [ "$actual" != "$3" ]; then
    rm -f "$2"
    fail "Refused $1: its SHA-256 is '$actual', not $3."
  fi
}

rm -rf "$home"
mkdir -p "$home/node/bin"
fetch "${CODEMAN_NODE_URL:?}" "$home/node.tar.gz" "${CODEMAN_NODE_SHA256:?}"
fetch "${CODEMAN_GATEWAY_URL:?}" "$home/gateway.js" "${CODEMAN_GATEWAY_SHA256:?}"
# Only Node's binary, under the tarball's top directory, which the URL's file name gives;
# owned by the user unpacking it, not by the tarball's UID, which may be a user of the image.
name=$(basename "$CODEMAN_NODE_URL" .tar.gz)
tar -xzf "$home/node.tar.gz" -C "$home/node/bin" --no-same-owner --strip-components=2 "$name/bin/node"
rm -f "$home/node.tar.gz"
echo "[bootstrap] Starting the gateway."
exec "$home/node/bin/node" "$home/gateway.js"
