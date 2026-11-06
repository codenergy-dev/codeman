# The e2e suite's Ollama pod: the catalog's official Ollama image (`ENGINE_RELEASES` in
# src/inference/images.ts, by the same digest), plus only what the suite needs around it: the tee
# (e2e/fakes/llm/tee.ts) on Ollama's port, a wrapper that moves the engine one port up, and a
# Node.js of the suite's own for the tee, off the PATH. The pod's command, the bootstrap
# (src/gateway/bootstrap.ts), downloads its own Node.js and the gateway, as on a real pod; the
# image has neither. Built with e2e/infra/images/ as its context; the `fakes` context is the fakes
# image, whose sources the tee runs from.
# Every input is pinned by digest.

# Only its node binary is used, for the tee: the fakes image's Node.js.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node

FROM ollama/ollama:0.40.10@sha256:4c5b27871a3239a717048f9b93057680a51b60c8119a7016aebb57f938e25e35
COPY --from=node /usr/local/bin/node /opt/codeman-e2e/node
COPY --from=fakes /opt/codeman /opt/codeman-e2e
COPY --chmod=0755 pod-common/supervise pod-ollama/ollama /opt/codeman-e2e/bin/

# The wrapper first on the PATH. The models come from the `codeman-e2e-ollama` volume, mounted
# read-only on /root/.ollama/models, which Ollama must not prune; the tee answers the gateway's
# pull without a registry. The gateway, the e2e build's, reaches the fake Runpod at the origin of
# CODEMAN_E2E_ENDPOINTS, fixed by e2e/infra/compose.yaml; a launcher's `-e` may replace it. Node.js
# trusts the session's test CA, which the entry point also adds to the system's store, for the
# bootstrap's downloads from the fakes of nodejs.org and raw.githubusercontent.com.
ENV PATH=/opt/codeman-e2e/bin:$PATH \
    E2E_TEE_PORT=11434 \
    E2E_ENGINE_PORT=11435 \
    OLLAMA_NOPRUNE=1 \
    CODEMAN_E2E_ENDPOINTS='{"runpod":"http://runpod:8080"}' \
    NODE_EXTRA_CA_CERTS=/etc/codeman-e2e/ca.crt
RUN command -v ollama | grep -qx /opt/codeman-e2e/bin/ollama \
 && ! command -v node \
 && /opt/codeman-e2e/node --version

# The gateway's port. Healthy once the gateway serves the model.
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10m --start-interval=2s \
  CMD ["/opt/codeman-e2e/node", "-e", "fetch('http://127.0.0.1:8080/health').then(r => r.json()).then(b => process.exit(b.ready ? 0 : 1), () => process.exit(1))"]
# The pod's command, Runpod's `entrypoint` and `cmd` or Salad's `command`, comes as arguments.
ENTRYPOINT ["/opt/codeman-e2e/bin/supervise"]
CMD []
