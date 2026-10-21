# Firestore's emulator for the e2e suite and the store's tests (decision 3 of
# docs/plans/2026-10-20-end-to-end-test-suite.md): Google's jar on Temurin's Java 21 runtime.
# Built by e2e/infra/compose.yaml, with firebase/ as the `firebase` build context.
# Every input is pinned: the base by digest, the jar by SHA-256. See
# docs/development/dependencies.md#firestores-emulator.

FROM eclipse-temurin:21.0.12_8-jre-noble@sha256:7739f0ffce786528961eea6bf46d9610ee968ac6127c9b2e93494757bdecce9f

# The directory first: ADD --chmod would give the one it creates the file's mode.
RUN mkdir -m 0755 /opt/firestore

# The SHA-256 firebase-tools 15.34.0 records for v1.22.0
# (docs/web/firebase/firebase-tools-downloadableemulatorinfo-json-at-48f511a.md).
ADD --chmod=0644 --checksum=sha256:9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c \
    https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.22.0.jar \
    /opt/firestore/cloud-firestore-emulator.jar

# Codeman's rules, which deny every client. The fake Google's token, `owner`, passes them as the
# service account passes them on Google, so a job that skips the token path is refused here too;
# with no rules, the emulator would let any request through.
COPY --from=firebase --chmod=0644 firestore.rules /opt/firestore/firestore.rules

# Temurin's image sets no user: the emulator runs as its own, with a home for what Java writes.
RUN useradd --uid 10001 --user-group --create-home --home-dir /var/lib/emulator emulator
USER emulator
WORKDIR /var/lib/emulator

# On every interface of the container: the Compose networks only, as compose.yaml publishes its
# port on the host's loopback. It answers `Ok` on `/` once it serves.
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --start-interval=1s \
  CMD curl -fsS http://127.0.0.1:8080/ >/dev/null || exit 1
ENTRYPOINT ["java", "-jar", "/opt/firestore/cloud-firestore-emulator.jar", \
  "--host=0.0.0.0", "--port=8080", "--rules=/opt/firestore/firestore.rules"]
