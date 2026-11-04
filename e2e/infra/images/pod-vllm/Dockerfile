# The e2e suite's vLLM pod: vLLM's official CPU image of the catalog's release, in place of its
# CUDA image (`ENGINE_RELEASES` in src/inference/images.ts), plus only what the suite needs around
# it: the tee (e2e/fakes/llm/tee.ts) on vLLM's port, a wrapper that moves the engine one port up,
# and a Node.js of the suite's own for the tee, off the PATH. The pod's command, the bootstrap
# (src/gateway/bootstrap.ts), downloads its own Node.js and the gateway, as on a real pod; the
# image has neither. Built with e2e/infra/images/ as its context; the `fakes` context is the fakes
# image, whose sources the tee runs from.
# Every input is pinned by digest. vLLM's CPU image is built for linux/amd64.

# Only its node binary is used, for the tee: the fakes image's Node.js.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

# docs/development/dependencies.md#vllms-cpu-image.
FROM vllm/vllm-openai-cpu:v0.32.0@sha256:ffaba3989b9b96d95a576143c872a4110ce9800f5199b6a36eb27bdff1cbbe05
COPY --from=node /usr/local/bin/node /opt/codeman-e2e/node
COPY --from=fakes /opt/codeman /opt/codeman-e2e
COPY --chmod=0755 pod-common/supervise pod-vllm/vllm /opt/codeman-e2e/bin/

# The gateway turns vLLM's usage reports off itself (src/gateway/vllm.ts). The weights come from
# the `codeman-e2e-hf` volume, mounted read-only as the Hugging Face cache, offline. The gateway,
# the e2e build's, reaches the fake Runpod at the origin of CODEMAN_E2E_ENDPOINTS, fixed by
# e2e/infra/compose.yaml; a launcher's `-e` may replace it. Node.js trusts the session's test CA,
# which the entry point also adds to the system's store, for the bootstrap's downloads from the
# fakes of nodejs.org and raw.githubusercontent.com.
ENV HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PATH=/opt/codeman-e2e/bin:$PATH \
    E2E_TEE_PORT=8000 \
    E2E_ENGINE_PORT=8001 \
    CODEMAN_E2E_ENDPOINTS='{"runpod":"http://runpod:8080"}' \
    NODE_EXTRA_CA_CERTS=/etc/codeman-e2e/ca.crt
RUN command -v vllm | grep -qx /opt/codeman-e2e/bin/vllm \
 && ! command -v node \
 && /opt/codeman-e2e/node --version

# The gateway's port. Healthy once the gateway serves the model: about 7.5 minutes on a CPU, with
# the probe's first request (docs/development/e2e/suite.md#profiles-and-memory).
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=15m --start-interval=5s \
  CMD ["/opt/codeman-e2e/node", "-e", "fetch('http://127.0.0.1:8080/health').then(r => r.json()).then(b => process.exit(b.ready ? 0 : 1), () => process.exit(1))"]
# The pod's command, Runpod's `entrypoint` and `cmd` or Salad's `command`, comes as arguments.
ENTRYPOINT ["/opt/codeman-e2e/bin/supervise"]
CMD []
