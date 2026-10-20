---
title: Ollama
url: https://docs.ollama.com
created_at: 2026-10-03T22:43:31-03:00
updated_at: 2026-10-20T19:06:41-03:00
---

# Ollama

How to record pages of Ollama's documentation, `docs.ollama.com`.

- **Source.** Each page answers as Markdown with `.md` appended to its URL, such as `https://docs.ollama.com/context-length.md`. `https://docs.ollama.com/llms.txt` lists every page. The pages are built from `docs/` in [ollama/ollama](https://github.com/ollama/ollama).
- **License.** The repository, documentation included, is MIT. Pages are copied in full, with `license: MIT`.
- **Title.** The first heading of the `.md` answer, such as "Context length".
- **Versions.** Pages describe the latest release. The version the repository pins belongs where it documents its dependencies, not in the copy.
- **Source files.** What the pages do not list, such as every environment variable the server reads, is in the source of the release the repository pins, at its tag: `https://raw.githubusercontent.com/ollama/ollama/<tag>/<path>`, such as `v0.35.1/envconfig/config.go`. Check that the tag's `LICENSE` is still MIT, then copy the file in full inside a fenced code block of its language, with `license: MIT`, the GitHub URL of the file at its tag as `url`, and a title naming the path and the tag, such as "envconfig/config.go at v0.35.1".
- **Size.** A source file larger than a repository should hold, roughly over 30 KB, such as `server/sched.go`, is recorded in your own words: only what the repository relies on, each fact naming the function it comes from, without `license`.
- **Models in the registry.** A model such as `qwen2.5:0.5b` is a manifest in Ollama's registry, which speaks the Docker registry's v2 API: `GET https://registry.ollama.ai/v2/<namespace>/<model>/manifests/<tag>` with `Accept: application/vnd.docker.distribution.manifest.v2+json`, then `GET .../v2/<namespace>/<model>/blobs/<digest>` for each layer. The host `registry.ollama.ai` and the namespace `library` are the defaults for a bare name (`types/model/name.go`), and `pullModelManifest` in `server/images.go` builds that URL; both at the tag the repository pins. The model's digest, which `/api/tags` reports, is the SHA-256 of the manifest's bytes: check it with `shasum -a 256`. Download only the small layers (config, template, system prompt, license), never the weights. A manifest is data, and each model has its own license, in its `application/vnd.ollama.image.license` layer: record it in your own words, without `license`, each fact naming the manifest field or layer it comes from. One page per model and tag, titled after it, such as "qwen2.5:0.5b", with its library page as `url` (`https://ollama.com/library/<model>:<tag>`).
- **llama.cpp.** Ollama runs llama.cpp's `llama-server`, at the tag its `LLAMA_CPP_VERSION` file pins; its files follow the [llama.cpp tool](llama-cpp.md).

```sh
curl -fsS "https://docs.ollama.com/context-length.md"
curl -fsS "https://raw.githubusercontent.com/ollama/ollama/v0.35.1/LICENSE" | head -1
curl -fsS "https://raw.githubusercontent.com/ollama/ollama/v0.35.1/envconfig/config.go"
mkdir -p dl && curl -fsS -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  -o dl/manifest.json "https://registry.ollama.ai/v2/library/qwen2.5/manifests/0.5b" && shasum -a 256 dl/manifest.json
curl -fsSL "https://registry.ollama.ai/v2/library/qwen2.5/blobs/sha256:<config or small layer digest>"
```

Then follow [Fetch Markdown](fetch-markdown.md) from step 3.
