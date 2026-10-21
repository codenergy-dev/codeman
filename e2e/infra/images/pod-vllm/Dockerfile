# The e2e suite's vLLM pod: vLLM's CPU image in place of the GPU one of docker/pod/Dockerfile's
# `vllm` target, with what that target adds (Node's binary, dist/gateway.js), plus the tee
# (e2e/fakes/llm/tee.ts) on vLLM's port and a wrapper that moves the engine one port up. The
# gateway runs unchanged. Built with e2e/infra/images/ as its context; the `dist` context is
# dist/, and `fakes` the fakes image, whose sources the tee runs from.
# Every input is pinned by digest. vLLM's CPU image is built for linux/amd64.

# Only its node binary is used: the pod images' pinned input.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

# docs/development/dependencies.md#vllms-cpu-image.
FROM vllm/vllm-openai-cpu:v0.31.0@sha256:495c84fe30f3572b83a78100a1e8ba423dbb77fc532ecefebe114e6b77327bd9
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=dist gateway.js /opt/codeman/gateway.js
COPY --from=fakes /opt/codeman /opt/codeman-e2e
COPY --chmod=0755 pod-common/supervise pod-vllm/vllm /opt/codeman-e2e/bin/

# As the production target: the image's engine, and no usage reports. The weights come from the
# `codeman-e2e-hf` volume, mounted read-only as the Hugging Face cache, offline.
ENV CODEMAN_IMAGE_ENGINE=vllm \
    VLLM_NO_USAGE_STATS=1 \
    DO_NOT_TRACK=1 \
    HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PATH=/opt/codeman-e2e/bin:$PATH \
    E2E_TEE_PORT=8000 \
    E2E_ENGINE_PORT=8001
RUN command -v vllm | grep -qx /opt/codeman-e2e/bin/vllm && node --version

# The gateway's port. Healthy once the gateway serves the model: 5 to 6 minutes on a CPU, with the
# probe's first request (spike 0.1).
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=15m --start-interval=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r => r.json()).then(b => process.exit(b.ready ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/opt/codeman-e2e/bin/supervise"]
CMD []
