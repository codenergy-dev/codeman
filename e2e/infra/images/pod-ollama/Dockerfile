# The e2e suite's Ollama pod: Codeman's Ollama pod image, the `ollama` target of
# docker/pod/Dockerfile (the `base` build context, which e2e/infra/compose.yaml builds from dist/
# as its `pod-ollama-base` service), plus the tee (e2e/fakes/llm/tee.ts) on Ollama's port and a
# wrapper that moves the engine one port up, and the gateway's e2e bundle.
# Built with e2e/infra/images/ as its context. The `fakes` context is the fakes image, whose
# sources the tee runs from; `e2e-build` is e2e/.build/.

FROM base

COPY --from=fakes /opt/codeman /opt/codeman-e2e

# The e2e bundle of the gateway, e2e/.build/gateway.js (`npm run build:e2e`), in place of
# dist/gateway.js: the same code, with the e2e build's redirects (decision 11), so the pod's call
# that terminates itself reaches the fake Runpod with its ID and key. That bundle refuses to start
# without CODEMAN_E2E_ENDPOINTS: the image gives the fake Runpod's origin on the jobs network,
# fixed by e2e/infra/compose.yaml, and a launcher's `-e CODEMAN_E2E_ENDPOINTS=...` replaces it.
COPY --from=e2e-build gateway.js /opt/codeman/gateway.js
ENV CODEMAN_E2E_ENDPOINTS='{"runpod":"http://runpod:8080"}'

COPY --chmod=0755 pod-common/supervise pod-ollama/ollama /opt/codeman-e2e/bin/

# The wrapper first on the PATH. The models come from the `codeman-e2e-ollama` volume, mounted
# read-only on /root/.ollama/models, which Ollama must not prune; the tee answers the gateway's
# pull without a registry.
ENV PATH=/opt/codeman-e2e/bin:$PATH \
    E2E_TEE_PORT=11434 \
    E2E_ENGINE_PORT=11435 \
    OLLAMA_NOPRUNE=1
RUN command -v ollama | grep -qx /opt/codeman-e2e/bin/ollama && node --version

# The gateway's port, as in the base. Healthy once the gateway serves the model.
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10m --start-interval=2s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r => r.json()).then(b => process.exit(b.ready ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/opt/codeman-e2e/bin/supervise"]
CMD []
