# Codeman's pod images, one per engine, each its engine behind Codeman's gateway: the targets
# `ollama` and `vllm`. Built from dist/ by .github/workflows/pod-image.yml:
# `docker build --target <engine> -f docker/pod/Dockerfile dist`.
# Every input is pinned by digest. After changing one, publish the images and pin their digests
# in src/inference/images.ts. See docs/development/dependencies.md#codemans-pod-images.

# Only its node binary is used.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

# vLLM 0.31.0, CUDA 13.0: its hosts need a driver for CUDA 13.0 or newer (VLLM_MIN_CUDA).
FROM vllm/vllm-openai:v0.31.0@sha256:c1c9f6fd5c109ba7f0546a59f5b2f15fb87f64c77782e90a27b648b42a8e67c3 AS vllm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY gateway.js /opt/codeman/gateway.js
# vLLM reports anonymous usage to stats.vllm.ai unless told not to.
ENV CODEMAN_IMAGE_ENGINE=vllm VLLM_NO_USAGE_STATS=1 DO_NOT_TRACK=1
RUN node --version && command -v vllm
# The gateway's port. vLLM listens on the loopback only.
EXPOSE 8080
ENTRYPOINT ["node", "/opt/codeman/gateway.js"]

# The default target, last, as before the vLLM image.
FROM ollama/ollama:0.35.1@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c AS ollama
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY gateway.js /opt/codeman/gateway.js
ENV CODEMAN_IMAGE_ENGINE=ollama
RUN node --version && ollama --version
# The gateway's port. Ollama listens on the loopback only.
EXPOSE 8080
ENTRYPOINT ["node", "/opt/codeman/gateway.js"]
