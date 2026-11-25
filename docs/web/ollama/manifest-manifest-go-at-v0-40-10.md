---
title: manifest/manifest.go at v0.40.10
url: https://github.com/ollama/ollama/blob/v0.40.10/manifest/manifest.go
created_at: 2026-11-24T12:41:47-03:00
updated_at: 2026-11-24T23:45:39-03:00
tool: docs/web/tools/ollama.md
---

# manifest/manifest.go at v0.40.10

What the repository relies on, in its own words: the file is about 46 KB, above what the repository holds in full (see the tool).

- **Media types.** A model's manifest is `application/vnd.docker.distribution.manifest.v2+json` (`MediaTypeManifest`); a list of variants is `application/vnd.ollama.manifest.list.v2+json` (`MediaTypeManifestList`).
- **A manifest** (`Manifest`) has `schemaVersion`, `mediaType`, `config` and `layers`, each layer with its `mediaType`, `digest` and `size`; a list has `manifests` instead, each naming its `runner` (`mlx`, `ggml` or `llamacpp`) and its `format` (`gguf` or `safetensors`).
- **A list's child.** `SelectManifestReferenceForRunner` picks the child for a runner, by the runners' preferences when none is asked (`runnerPreferencesFor`): on Linux, `llamacpp`, then `ggml`, then `mlx` (`runnerPreferences`).
- **Writing a pulled manifest.** `WriteManifestData` stores the manifest's bytes as a blob named by their SHA-256 (`writeManifestBlob`), then links the name's path under `manifests-v2/` to that blob, with a relative symbolic link where it can (`linkManifest`); [paths.go](manifest-paths-go-at-v0-40-10.md) resolves that path first.
- **The copy for older releases.** `WriteLegacyAnchor` writes, at the name's path under `manifests/`, the manifest serialized again by `json.Marshal`, with the manifest's own blob added to `layers`, so that an older Ollama's garbage collector keeps that blob (`WriteLegacyManifestData`). Its bytes differ from the registry's.
- **Formats.** `MetadataForConfig` gives a model in safetensors the `mlx` runner, and a GGUF model `ggml` or `llamacpp`.
