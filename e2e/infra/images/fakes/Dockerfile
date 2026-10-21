# The e2e suite's fakes (e2e/fakes/), one image for all: each Compose service runs one of them
# with `node e2e/fakes/main.ts <name>`. Built by e2e/infra/compose.yaml from the repository's root;
# Dockerfile.dockerignore keeps the context to what the fakes load.
# Every input is pinned by digest; apt packages come from Debian's signed archive.

# The pod images' and the local runner's Node.js (docs/development/dependencies.md).
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# git for the fake GitHub's clones and pushes (`git http-backend`, git.ts); the openssl command for
# the session's test CA (e2e/fakes/github/tls.ts), which the certificates service makes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssl \
 && rm -rf /var/lib/apt/lists/*

# Node runs the TypeScript sources as they are, by type stripping: no build and no node_modules.
# The fakes import some of src/ and nothing from npm; package.json gives the ES module type.
WORKDIR /opt/codeman
COPY package.json ./
COPY src/ src/
COPY e2e/fakes/ e2e/fakes/
COPY e2e/infra/certificates.ts e2e/infra/

# The volumes' mount points, owned by the fakes' user, so new named volumes start writable for it.
RUN mkdir -p /e2e/ca /e2e/tls /e2e/npm \
 && chown node:node /e2e/ca /e2e/tls /e2e/npm \
 && git --version && openssl version && node --version

# The base image's unprivileged user, uid 1000. Docker lets it bind ports below 1024
# (net.ipv4.ip_unprivileged_port_start is 0 in containers), so the fake GitHub serves 443.
USER node
CMD ["node", "e2e/fakes/main.ts"]
