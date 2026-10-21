#!/bin/sh
# Fills the Hugging Face cache volume with Qwen/Qwen2.5-0.5B-Instruct at its pinned commit, once,
# for e2e/infra/compose.yaml's `seed-hf`, with the `hf` command of vLLM's CPU image. Checks the
# weights' SHA-256, which the Hub records. When the snapshot is complete and matches, it makes no
# request at all. See docs/development/dependencies.md#the-e2e-models.
set -eu

repo=Qwen/Qwen2.5-0.5B-Instruct
revision=7ae557604adf67be50417f59c2c2f167def9a775
weights=fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe
cache=${HF_HOME:-/root/.cache/huggingface}/hub
snapshot=$cache/models--Qwen--Qwen2.5-0.5B-Instruct/snapshots/$revision
files="config.json generation_config.json tokenizer.json tokenizer_config.json vocab.json merges.txt model.safetensors"

check() {
  for file in $files; do [ -s "$snapshot/$file" ] || return 1; done
  [ "$(sha256sum "$snapshot/model.safetensors" | cut -d ' ' -f 1)" = "$weights" ]
}

if check; then
  echo "$repo is present at $revision."
  exit 0
fi

# Downloads can fail midway (the plan's spike 0.1): retry, and hf resumes the files it has.
for attempt in 1 2 3 4 5; do
  hf download "$repo" --revision "$revision" --exclude '*.md' && break
  [ "$attempt" -lt 5 ] || { echo "Could not download $repo." >&2; exit 1; }
  sleep $((attempt * 15))
done

if ! check; then
  echo "$repo at $revision is incomplete, or its weights are not sha256:$weights." >&2
  exit 1
fi
echo "Downloaded $repo at $revision."
