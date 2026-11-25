#!/bin/sh
# Runs official engine images with bootstrap.sh as their overridden entry command, as a pod
# would: the command that command.ts builds for Salad and Runpod, one argument per line of the
# script, nothing of Codeman's in the image. Downloads come from serve.ts (start it first, on
# .work/release/, after release.sh).
#
# Usage: experiments/multi-service-pods/bootstrap/run.sh <command> <image> ...
#   probe <image>                  What the image has (probe.sh), with Node's binary mounted.
#   pod <preset>                   Starts a pod, waits for /health, sends a chat completion.
#   tamper <preset>                A pod whose gateway.js, then whose tarball, was tampered with:
#                                  each must be refused.
#   baseline                       Codeman's own Ollama image, built from dist/, for comparison.
#   seed                           The tampered artifacts, and the vLLM model in .work/hf/.
# Presets: ollama, vllm-cpu (serve on CPU); vllm, omni (GPU only: the engine fails). The ollama
# preset downloads over HTTPS from nodejs.org and GitHub, since its image has only openssl.
# Results go to .work/results/. Containers are named bootstrap-<preset> and kept for their logs
# until the next run of the same preset.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
work=$here/.work
results=$work/results
mkdir -p "$results"
admin_token=bootstrap-admin
run_token=bootstrap-run
release=http://host.docker.internal:8765
tampered=http://host.docker.internal:8766
# dist/gateway.js as of 98ee43b, the same bytes as the release's, on GitHub.
github_gateway=https://raw.githubusercontent.com/codenergy-dev/codeman/98ee43ba8b74d6168a61169e911388b0beb1338d/dist/gateway.js

sha256() { printf %s "$1" | shasum -a 256 | cut -d ' ' -f 1; }
log() { echo "[run] $*" >&2; }

# The image, engine, model, wait and docker arguments of a preset.
preset() {
  model_args="" vllm="" origin=$release
  case $1 in
    ollama)
      image=ollama/ollama@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c
      engine=ollama model=qwen2.5:0.5b wait=600
      mkdir -p "$work/ollama-models"
      # gpu-shim/ stands in for a GPU, which the gateway's fit requires (see gpu-shim/ollama).
      model_args="-v $work/ollama-models:/root/.ollama/models -v $here/gpu-shim:/shim:ro
        -e PATH=/shim:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
        -e CODEMAN_GPU_MEMORY_GB=24"
      origin=https
      NODE_URL=${NODE_URL:-https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz}
      GATEWAY_URL=${GATEWAY_URL:-$github_gateway}
      ;;
    vllm-cpu)
      image=vllm/vllm-openai-cpu@sha256:495c84fe30f3572b83a78100a1e8ba423dbb77fc532ecefebe114e6b77327bd9
      engine=vllm model=Qwen/Qwen2.5-0.5B-Instruct wait=900
      vllm='{"tool-call-parser":"hermes","max-model-len":"8192","enforce-eager":"true","max-num-seqs":"1","max-num-batched-tokens":"8192"}'
      # As the e2e vLLM pod: the cache seeded by hf.sh, offline, a CPU K/V cache of 1 GiB (whole GiB
      # only) and 8192 tokens, more than the gateway's probe asks (max_tokens 4096). One sequence
      # and 2 threads keep it under 4 GB: vLLM's default batch was killed at 4 GB.
      model_args="--shm-size 1g -v $work/hf:/root/.cache/huggingface:ro -e HF_HUB_OFFLINE=1
        -e VLLM_CPU_KVCACHE_SPACE=1 -e VLLM_CPU_OMP_THREADS_BIND=nobind -e OMP_NUM_THREADS=2"
      ;;
    vllm)
      image=vllm/vllm-openai@sha256:c1c9f6fd5c109ba7f0546a59f5b2f15fb87f64c77782e90a27b648b42a8e67c3
      engine=vllm model=Qwen/Qwen2.5-0.5B-Instruct wait=180
      vllm='{"tool-call-parser":"hermes","max-model-len":"4096","enforce-eager":"true"}'
      model_args="--shm-size 1g -v $work/hf:/root/.cache/huggingface:ro -e HF_HUB_OFFLINE=1"
      ;;
    omni)
      image=vllm/vllm-omni@sha256:fc77cfaac7b1b43c30cbf32eaea214864434c6e0f303e6e9eb9f64104241a994
      engine=vllm model=Qwen/Qwen2.5-0.5B-Instruct wait=180
      vllm='{"tool-call-parser":"hermes","max-model-len":"4096","enforce-eager":"true"}'
      model_args="--shm-size 1g -v $work/hf:/root/.cache/huggingface:ro -e HF_HUB_OFFLINE=1"
      ;;
    *)
      log "Unknown preset $1."
      exit 2
      ;;
  esac
}

# Starts container $1 from $image with the bootstrap inline, and downloads from $2.
start() {
  name=$1 origin=$2
  docker rm -f "$name" >/dev/null 2>&1 || true
  # The entry command, as a provider would get it: its first item replaces the entry point.
  node "$here/command.ts" "$work/command.txt" >/dev/null
  set --
  while IFS= read -r arg; do set -- "$@" "$arg"; done <"$work/command.txt"
  entry=$1
  shift
  # shellcheck disable=SC2086 # model_args holds several arguments.
  docker run -d --name "$name" --memory 4g --memory-swap 4g --cpus 6 \
    -p 127.0.0.1::8080 $model_args \
    -e CODEMAN_NODE_URL="${NODE_URL:-$origin/node-v24.21.0-linux-x64.tar.gz}" \
    -e CODEMAN_NODE_SHA256="${NODE_SHA256:-$(awk -F= '$1 == "CODEMAN_NODE_SHA256" { print $2 }' "$work/release/release.env")}" \
    -e CODEMAN_GATEWAY_URL="${GATEWAY_URL:-$origin/gateway.js}" \
    -e CODEMAN_GATEWAY_SHA256="${GATEWAY_SHA256:-$(awk -F= '$1 == "CODEMAN_GATEWAY_SHA256" { print $2 }' "$work/release/release.env")}" \
    -e CODEMAN_MODEL="$model" -e CODEMAN_ENGINE="$engine" -e CODEMAN_IMAGE_ENGINE="$engine" \
    -e CODEMAN_ADMIN_SHA256="$(sha256 "$admin_token")" \
    -e CODEMAN_START_BY="$(node -e 'console.log(new Date(Date.now() + 30 * 60_000).toISOString())')" \
    -e CODEMAN_VLLM="$vllm" -e VLLM_NO_USAGE_STATS=1 -e DO_NOT_TRACK=1 \
    --entrypoint "$entry" "$image" "$@" >/dev/null
}

# Seconds from the container's start to its first log line that contains $2, or "-".
since_start() {
  docker logs -t "$1" 2>&1 | node -e '
    const [started, pattern] = process.argv.slice(1);
    const lines = require("node:fs").readFileSync(0, "utf8").split("\n");
    const line = lines.find((one) => one.includes(pattern));
    const at = line ? Date.parse(line.split(" ")[0]) : NaN;
    console.log(Number.isNaN(at) ? "-" : ((at - Date.parse(started)) / 1000).toFixed(2));
  ' "$(docker inspect -f '{{.State.StartedAt}}' "$1")" "$2"
}

# Waits up to $2 seconds for the gateway of container $1 to be ready, or for it to stop.
wait_ready() {
  port=$(docker port "$1" 8080 | head -n 1 | sed 's/.*://')
  deadline=$(($(date +%s) + $2))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ] || return 1
    health=$(curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null || true)
    case $health in *'"ready":true'*) return 0 ;; *'"failed":true'*) return 1 ;; esac
    sleep 3
  done
  return 1
}

# Opens a run on container $1's gateway and sends one chat completion through it.
chat() {
  port=$(docker port "$1" 8080 | head -n 1 | sed 's/.*://')
  curl -fsS -H "Authorization: Bearer $admin_token" -X POST "http://127.0.0.1:$port/admin/run" \
    -d "{\"tokenSha256\":\"$(sha256 "$run_token")\",\"limit\":1,\"start\":$(date +%s)000,\"pricePerSecond\":0.0001}" >/dev/null
  curl -fsS -H "Authorization: Bearer $run_token" -H 'content-type: application/json' \
    "http://127.0.0.1:$port/v1/chat/completions" \
    -d "{\"model\":\"$model\",\"max_tokens\":16,\"temperature\":0,\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one word.\"}]}"
}

summary() {
  name=$1
  {
    echo "container: $name"
    echo "image: $image"
    echo "exit: $(docker inspect -f '{{.State.Status}} {{.State.ExitCode}} oom={{.State.OOMKilled}}' "$name")"
    echo "bootstrap-seconds: $(since_start "$name" '[bootstrap] Starting the gateway.')"
    echo "gateway-listening-seconds: $(since_start "$name" 'Gateway listening')"
    echo "ready-seconds: $(since_start "$name" '[codeman] Ready.')"
  } | tee "$results/$name.txt"
  docker logs "$name" >"$results/$name.log" 2>&1
}

case ${1:-} in
  probe)
    docker run --rm --network none --memory 1g --entrypoint /bin/sh \
      -v "$here/probe.sh:/probe.sh:ro" -v "$work/node:/node:ro" "$2" /probe.sh
    docker image inspect "$2" --format \
      'entrypoint: {{json .Config.Entrypoint}}{{println}}cmd: {{json .Config.Cmd}}{{println}}config-user: {{json .Config.User}}'
    ;;
  pod)
    preset "$2"
    name=bootstrap-$2
    start "$name" "$origin"
    if wait_ready "$name" "$wait"; then
      summary "$name"
      echo "health: $(curl -fsS "http://127.0.0.1:$(docker port "$name" 8080 | head -n 1 | sed 's/.*://')/health")"
      echo "chat: $(chat "$name")" | tee -a "$results/$name.txt"
    else
      log "$name is not ready; its last lines:"
      docker logs --tail 30 "$name" >&2
      summary "$name"
    fi
    ;;
  tamper)
    preset "$2"
    for what in gateway node; do
      name=bootstrap-$2-tampered-$what
      # Over HTTP, the tampered server's files under the release's digests. Over HTTPS (ollama),
      # the genuine files under the tampered ones' digests: the check sees the same mismatch.
      if [ "$origin" = https ]; then
        if [ "$what" = gateway ]; then
          GATEWAY_SHA256=$(shasum -a 256 "$work/tampered/gateway.js" | cut -d ' ' -f 1)
        else
          NODE_SHA256=$(shasum -a 256 "$work/tampered/node-v24.21.0-linux-x64.tar.gz" | cut -d ' ' -f 1)
        fi
      elif [ "$what" = gateway ]; then
        GATEWAY_URL=$tampered/gateway.js
      else
        NODE_URL=$tampered/node-v24.21.0-linux-x64.tar.gz
      fi
      start "$name" "$origin"
      unset GATEWAY_SHA256 NODE_SHA256 GATEWAY_URL NODE_URL
      preset "$2"
      docker wait "$name" >/dev/null
      echo "$name: exit $(docker inspect -f '{{.State.ExitCode}}' "$name")" | tee "$results/$name.txt"
      docker logs "$name" 2>&1 | tee -a "$results/$name.txt"
      # Nothing downloaded may have run: no line of the gateway, nor of the bootstrap's start.
      if docker logs "$name" 2>&1 | grep -q -e '\[codeman\]' -e 'Starting the gateway' -e TAMPERED; then
        echo "FAIL: $name ran what it downloaded." | tee -a "$results/$name.txt"
      fi
      docker rm "$name" >/dev/null
    done
    ;;
  seed)
    # A gateway that announces itself, and a tarball whose `node` is a shell script.
    mkdir -p "$work/tampered/node-v24.21.0-linux-x64/bin"
    { cat "$work/release/gateway.js"; echo 'console.log("TAMPERED");'; } >"$work/tampered/gateway.js"
    printf '#!/bin/sh\necho TAMPERED\n' >"$work/tampered/node-v24.21.0-linux-x64/bin/node"
    chmod +x "$work/tampered/node-v24.21.0-linux-x64/bin/node"
    tar -czf "$work/tampered/node-v24.21.0-linux-x64.tar.gz" -C "$work/tampered" node-v24.21.0-linux-x64
    rm -rf "$work/tampered/node-v24.21.0-linux-x64"
    # Qwen/Qwen2.5-0.5B-Instruct at the e2e suite's commit, with e2e/infra/seeds/hf.sh, then
    # refs/main at that commit, so vLLM finds it offline by its name.
    preset vllm-cpu
    mkdir -p "$work/hf" "$work/seed"
    cp "$here/../../../e2e/infra/seeds/hf.sh" "$work/seed/hf.sh"
    docker run --rm --memory 2g -e HF_HUB_DISABLE_TELEMETRY=1 \
      -v "$work/hf:/root/.cache/huggingface" -v "$work/seed/hf.sh:/hf.sh:ro" \
      --entrypoint /bin/sh "$image" /hf.sh
    mkdir -p "$work/hf/hub/models--Qwen--Qwen2.5-0.5B-Instruct/refs"
    printf 7ae557604adf67be50417f59c2c2f167def9a775 >"$work/hf/hub/models--Qwen--Qwen2.5-0.5B-Instruct/refs/main"
    ;;
  baseline)
    # Codeman's own image (docker/pod/Dockerfile's ollama target), with Node and the gateway in it.
    preset ollama
    name=bootstrap-baseline-ollama
    docker rm -f "$name" >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    docker run -d --name "$name" --memory 4g --memory-swap 4g --cpus 6 -p 127.0.0.1::8080 \
      $model_args -e CODEMAN_MODEL="$model" -e CODEMAN_ADMIN_SHA256="$(sha256 "$admin_token")" \
      -e CODEMAN_START_BY="$(node -e 'console.log(new Date(Date.now() + 30 * 60_000).toISOString())')" \
      codeman-pod-ollama:local >/dev/null
    image=codeman-pod-ollama:local
    wait_ready "$name" "$wait" || true
    summary "$name"
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac
