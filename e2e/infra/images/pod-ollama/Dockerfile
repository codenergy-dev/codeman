# The e2e suite's Ollama pod: Codeman's Ollama pod image, the `ollama` target of
# docker/pod/Dockerfile (the `base` build context, which e2e/infra/compose.yaml builds from dist/
# as its `pod-ollama-base` service), plus the tee (e2e/fakes/llm/tee.ts) on Ollama's port and a
# wrapper that moves the engine one port up. The gateway, dist/gateway.js, runs unchanged.
# Built with e2e/infra/images/ as its context. The `fakes` context is the fakes image, whose
# sources the tee runs from.

FROM base

COPY --from=fakes /opt/codeman /opt/codeman-e2e
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
