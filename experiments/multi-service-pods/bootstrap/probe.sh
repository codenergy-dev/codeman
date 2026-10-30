#!/bin/sh
# What an image offers the bootstrap, printed as `key: value` lines: its OS, glibc, the user it
# runs as, the shell and downloaders it has, and whether Node's official linux-x64 binary runs.
# Runs inside the image, with Node's unpacked tarball mounted read-only at /node (optional).
#
# Usage, from the host (run.sh probe does this):
#   docker run --rm --network none --entrypoint /bin/sh \
#     -v "$PWD/probe.sh:/probe.sh:ro" -v "$PWD/.work/node:/node:ro" <image> /probe.sh

os=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")
echo "os: ${os:-unknown}"
# glibc's version from its loader, else from ldd; none on musl images.
glibc=$(ldd --version 2>/dev/null | head -n 1 | awk '{ print $NF }')
echo "glibc: ${glibc:-none}"
echo "user: $(id -un 2>/dev/null || id -u) ($(id -u):$(id -g))"
for tool in sh bash curl wget python3 python sha256sum shasum openssl tar gzip xz perl; do
  path=$(command -v "$tool" 2>/dev/null)
  echo "$tool: ${path:-missing}"
done
# Python's urllib can download over HTTPS only with its ssl module.
if command -v python3 >/dev/null 2>&1; then
  echo "python3-ssl: $(python3 -I -c 'import ssl; print(ssl.OPENSSL_VERSION)' 2>&1)"
fi
echo "ca-certificates: $([ -s /etc/ssl/certs/ca-certificates.crt ] && echo yes || echo no)"
echo "tmp-writable: $(touch /tmp/.probe 2>/dev/null && rm -f /tmp/.probe && echo yes || echo no)"
if [ -x /node/bin/node ]; then
  echo "node: $(/node/bin/node -e 'console.log(process.version, process.versions.openssl)' 2>&1)"
fi
