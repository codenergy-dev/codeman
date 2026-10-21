#!/bin/sh
# Fills the Ollama models volume with qwen2.5:0.5b, once, for e2e/infra/compose.yaml's
# `seed-ollama`. Checks the manifest's digest, which /api/tags reports, and every blob it names,
# by SHA-256. When they already match, it makes no request at all. See
# docs/development/dependencies.md#the-e2e-models.
set -eu

model=qwen2.5:0.5b
digest=a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67
models=${OLLAMA_MODELS:-/root/.ollama/models}
manifest=$models/manifests/registry.ollama.ai/library/qwen2.5/0.5b

# The manifest's bytes hash to the pinned digest, and each layer's blob to its own digest.
check() {
  [ -f "$manifest" ] || return 1
  [ "$(sha256sum "$manifest" | cut -d ' ' -f 1)" = "$digest" ] || return 1
  for layer in $(grep -o 'sha256:[0-9a-f]\{64\}' "$manifest" | sort -u); do
    blob=$models/blobs/sha256-${layer#sha256:}
    [ -f "$blob" ] || return 1
    [ "$(sha256sum "$blob" | cut -d ' ' -f 1)" = "${layer#sha256:}" ] || return 1
  done
}

if check; then
  echo "$model is present, manifest sha256:$digest."
  exit 0
fi

# Ollama pulls through its server, on the loopback of this container only.
export OLLAMA_HOST=127.0.0.1:11434
ollama serve >/tmp/ollama.log 2>&1 &
for _ in $(seq 60); do ollama list >/dev/null 2>&1 && break; sleep 1; done

# Pulls can fail midway (the plan's spike 0.1): retry, and Ollama resumes from the blobs it has.
for attempt in 1 2 3 4 5; do
  ollama pull "$model" && break
  [ "$attempt" -lt 5 ] || { echo "Could not pull $model." >&2; exit 1; }
  sleep $((attempt * 15))
done

if ! check; then
  echo "$model's manifest is not sha256:$digest: the tag moved, or a blob is wrong." >&2
  exit 1
fi
echo "Pulled $model, manifest sha256:$digest."
