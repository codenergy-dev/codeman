# Codeman's pod image: Ollama behind Codeman's gateway. Built from dist/ by
# .github/workflows/pod-image.yml: `docker build -f docker/pod/Dockerfile dist`.
# Every input is pinned by digest. After changing one, publish the image and pin its digest in
# src/inference/ollama.ts. See docs/development/dependencies.md#self-hosted-inference.

# Only its node binary is used.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

FROM ollama/ollama:0.35.1@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY gateway.js /opt/codeman/gateway.js
RUN node --version && ollama --version
# The gateway's port. Ollama listens on the loopback only.
EXPOSE 8080
ENTRYPOINT ["node", "/opt/codeman/gateway.js"]
