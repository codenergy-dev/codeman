---
title: Cached models
url: https://docs.runpod.io/serverless/endpoints/model-caching
created_at: 2026-10-06T15:45:35-03:00
updated_at: 2026-10-06T15:45:35-03:00
tool: docs/web/tools/runpod.md
---

# Cached models

What Codeman relies on, in its own words. The documentation states no license that allows copying it.

## What it does

- An endpoint can name one Hugging Face model, public, gated or private (gated and private ones need a Hugging Face token), in its **Model** field ("Cached model compatibility", "Current limitations").
- Runpod starts the endpoint's workers on hosts that already hold that model. When none is free, it downloads the model to the chosen host first and starts the worker after, so the download is not billed ("How it works", "Why use cached models?").
- Workers find the model under `/runpod-volume/huggingface-cache/hub/`, in Hugging Face's cache layout ("Where cached models are stored").

## Setting it up

- In the console, an endpoint's **Model** field, when creating it or later under **Manage → Edit Endpoint** ("Enable cached models").
- Runpod's vLLM worker uses the cached model when the field, or `MODEL_NAME`, names it ("Using cached models in your workers").
- A repository holding several quantizations of a model is downloaded whole ("Current limitations").
