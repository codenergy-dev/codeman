# Experiment E2/E4 of docs/plans/2026-10-30-investigate-multi-service-pods.md: Ollama's official
# image, pinned as in docker/pod/Dockerfile, with Node's binary copied in. Nothing else is added:
# Python and the generator's wheels are downloaded and verified when the container starts
# (install.ts), as a pod would. The scripts are mounted read-only at /opt/supervisor.
#
#   docker build --platform linux/amd64 -t codeman-exp-supervisor:local \
#     experiments/multi-service-pods/supervisor

# Only its node binary is used.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

FROM ollama/ollama:0.35.1@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# Ollama on the loopback; it never unloads a model on its own: the supervisor decides.
ENV OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=-1 OLLAMA_MODELS=/data/ollama \
  OLLAMA_CONTEXT_LENGTH=2048 OLLAMA_NUM_PARALLEL=1
RUN node --version && ollama --version
WORKDIR /opt/supervisor
ENTRYPOINT ["node"]
