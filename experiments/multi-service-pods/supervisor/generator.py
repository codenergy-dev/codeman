"""A text-to-image service for the prototype supervisor (E2 of
docs/plans/2026-10-30-investigate-multi-service-pods.md): a standard library HTTP server in
front of a diffusers pipeline on CPU. It loads the pipeline before it answers /health, so the
supervisor's load is the process's start, and its unload is the process's exit.

Usage: python -I generator.py --port 8188 --model /data/models/tiny-sd
  GET  /health     200 once the pipeline is loaded
  POST /generate   {"prompt", "steps", "size", "out"}: writes a PNG to `out`, which must be in
                   $CODEMAN_OUTPUTS, and answers {"seconds"}; never the image itself.
"""

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from diffusers import StableDiffusionPipeline

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--model", required=True)
args = parser.parse_args()

outputs = os.path.realpath(os.environ["CODEMAN_OUTPUTS"])
torch.set_num_threads(int(os.environ.get("OMP_NUM_THREADS", "4")))
started = time.monotonic()
# Only safetensors from the local, verified directory: no pickle, no download.
pipeline = StableDiffusionPipeline.from_pretrained(
    args.model,
    use_safetensors=True,
    local_files_only=True,
    safety_checker=None,
    requires_safety_checker=False,
)
pipeline.set_progress_bar_config(disable=True)
print(f"loaded {args.model} in {time.monotonic() - started:.2f} s", flush=True)
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *values):
        pass

    def answer(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.answer(200, {"ready": True})
        self.answer(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/generate":
            return self.answer(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(min(length, 65536)) or b"{}")
        out = os.path.realpath(str(body.get("out", "")))
        if os.path.dirname(out) != outputs or not out.endswith(".png"):
            return self.answer(400, {"error": "out must be a .png in the outputs directory"})
        size = max(32, min(512, int(body.get("size", 64)))) // 8 * 8
        begun = time.monotonic()
        with lock:
            image = pipeline(
                str(body.get("prompt", "")),
                num_inference_steps=max(1, min(50, int(body.get("steps", 4)))),
                height=size,
                width=size,
                generator=torch.Generator().manual_seed(0),
            ).images[0]
            image.save(out)
        self.answer(200, {"seconds": round(time.monotonic() - begun, 3)})


ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
