# The e2e suite's job image: the local runner image of docker/runner/ (the `runner` build context,
# which e2e/infra/compose.yaml builds as its `runner-base` service), plus GitHub's `gh` and trust
# of the session's test CA. See docs/development/local-actions.md for the base.
# Every input is pinned: the base's by digest, gh by SHA-256.

FROM runner AS gh
# The base ends as `runner`; the download and its check run as root, in this stage only.
USER root
ARG TARGETARCH
ARG GH_VERSION=2.102.0
# From the release's checksums file (docs/development/dependencies.md#github-cli).
ARG GH_SHA256_AMD64=bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386
ARG GH_SHA256_ARM64=7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484
ADD https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz /tmp/gh/
WORKDIR /tmp/gh
RUN case "$TARGETARCH" in \
      amd64) sum="$GH_SHA256_AMD64" ;; \
      arm64) sum="$GH_SHA256_ARM64" ;; \
      *) echo "No gh checksum pinned for $TARGETARCH." >&2; exit 1 ;; \
    esac \
 && echo "$sum  gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" | sha256sum -c - \
 && tar -xzf "gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" \
 && mv "gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /tmp/gh/gh

FROM runner
USER root

# Where GitHub's image has it, from its apt package: root's, out of the world-writable trees.
COPY --from=gh --chmod=0755 /tmp/gh/gh /usr/bin/gh
# gh sends no telemetry and checks for no update: the jobs network has no internet anyway.
# The fake GitHub is not github.com, so gh takes its token from GH_ENTERPRISE_TOKEN, not GH_TOKEN,
# which the templates' steps set (docs/web/github-cli/gh-environment.md): the runtime gives each
# such step GH_ENTERPRISE_TOKEN with GH_TOKEN's value, and GH_HOST=github-e2e.localhost.
ENV GH_TELEMETRY=false GH_NO_UPDATE_NOTIFIER=1 GH_PROMPT_DISABLED=1

# The session's test CA is mounted at run time, never baked in: the volume `codeman-e2e-ca` on
# /etc/codeman-e2e, holding only ca.crt (e2e/infra/certificates.ts).
# - Node trusts it, with its own roots, through NODE_EXTRA_CA_CERTS.
# - git and gh read the system store: the entry point adds the CA to it with update-ca-certificates
#   before the job's command. A driver that replaces the entry point, as act may,
#   runs `trust-e2e-ca` itself, or passes GIT_SSL_CAINFO for git and SSL_CERT_DIR for gh.
ENV NODE_EXTRA_CA_CERTS=/etc/codeman-e2e/ca.crt
COPY --chmod=0755 trust-e2e-ca /usr/sbin/trust-e2e-ca
RUN mkdir -p /etc/codeman-e2e

# libcurl sends every `*.localhost` name to 127.0.0.1, so git reaches the fake GitHub by its fixed
# address on the jobs network (compose.yaml). gh and Node resolve the name through Docker's DNS.
ARG GITHUB_HOST=github-e2e.localhost
ARG GITHUB_ADDRESS=10.250.0.10
RUN git config --system http.curloptResolve "${GITHUB_HOST}:443:${GITHUB_ADDRESS}"

USER runner
RUN gh --version && git config --system --get http.curloptResolve
ENTRYPOINT ["/usr/sbin/trust-e2e-ca"]
CMD ["bash"]
