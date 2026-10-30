#!/bin/sh
# Reproduces E2 and E4 of docs/plans/2026-10-30-investigate-multi-service-pods.md on a local Docker
# (amd64, no GPU). Run from the repository's root:
#
#   sh experiments/multi-service-pods/supervisor/run.sh [resolution of the wheels]
#
# The wheels' resolution defaults to the copy of E3's, resolutions/diffusers-cpu.resolver.json.
# Downloads go to the Docker volume codeman-exp-supervisor-data, never next to the scripts, which
# are mounted read-only. Run it on a new volume; remove the volume and the image afterwards:
#   docker volume rm codeman-exp-supervisor-data && docker rmi codeman-exp-supervisor:local
set -eu

DIR=experiments/multi-service-pods/supervisor
IMAGE=codeman-exp-supervisor:local
VOLUME=codeman-exp-supervisor-data
WHEELS=${1:-resolutions/diffusers-cpu.resolver.json}
# A CPU quota, not a cpuset: llama-server then runs 8 threads on 4 CPUs' worth of time.
RUN="docker run --rm --platform linux/amd64 --memory 5g --cpus 4 \
  -v $PWD/$DIR:/opt/supervisor:ro -v $VOLUME:/data $IMAGE"

docker build --platform linux/amd64 -t "$IMAGE" "$DIR"
docker volume create "$VOLUME" >/dev/null

# The two Ollama models: pulled by Ollama itself, which checks each layer's digest.
$RUN --entrypoint sh -c 'ollama serve >/dev/null 2>&1 & sleep 3 &&
  ollama pull qwen2.5:0.5b >/dev/null && ollama pull smollm2:135m >/dev/null && ollama list'

# E4: a tampered artifact is refused; Python, the wheels and the model are installed verified.
$RUN tamper-test.ts "/data/tamper-test-$(date +%s)"
$RUN install.ts resolutions/python-3.12.json "$WHEELS" /data/engines/diffusers-cpu
$RUN downloader.ts resolutions/tiny-random-stable-diffusion.json /data/models/tiny-random-sd

# E2: every behavior of the supervisor, with timings.
$RUN prove.ts all
