import { isHuggingFaceId } from "./vllm.ts";

/** Hugging Face's Hub, whose models vLLM downloads on a pod. */
const HUB = "https://huggingface.co";

/** What Codeman needs of a model on the Hub before it creates a pod for it. */
export interface HubModel {
  id: string;
  /** Bytes of its safetensors weights, which vLLM downloads. */
  weightsBytes: number;
}

/** A source of models' information, such as Hugging Face's API. */
export interface ModelHub {
  /**
   * The model, when it is public, not gated, and has safetensors weights; throws otherwise, with
   * a message that says what to change.
   */
  model(id: string): Promise<HubModel>;
  /**
   * Whether vLLM serves the model's vision tower, unless told not to: its configuration has one,
   * and does not say to serve its language model only. Throws when it cannot tell, saying why.
   */
  vision(id: string): Promise<boolean>;
}

/** The fields of the model's information Codeman reads (docs/web/hugging-face/). */
interface ModelInfo {
  id?: unknown;
  private?: unknown;
  gated?: unknown;
  disabled?: unknown;
  siblings?: { rfilename?: unknown; size?: unknown }[] | null;
  usedStorage?: unknown;
}

/**
 * Hugging Face's API, without a token: one public, read-only call per model,
 * `GET /api/models/{id}?blobs=true` (decision 10 of the plan for vLLM on pods). See
 * docs/web/hugging-face/src-huggingface-hub-hf-api-py-at-v2-2-0.md.
 */
export class HuggingFace implements ModelHub {
  readonly #fetch: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.#fetch = fetchFn;
  }

  async model(id: string): Promise<HubModel> {
    const path = repositoryPath(id);
    let response: Response;
    try {
      response = await this.#fetch(`${HUB}/api/models/${path}?blobs=true`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(
        `Could not reach Hugging Face's API to check \`${id}\` (${error instanceof Error ? error.message : error}), so no pod was created; try again later.`,
      );
    }
    // The Hub answers 401 for a private repository as for a missing one (docs/web/hugging-face/).
    if (response.status === 401 || response.status === 404) throw notPublic(id);
    if (!response.ok) {
      const reason = response.headers.get("x-error-message");
      throw new Error(
        `Hugging Face's API answered ${response.status} for \`${id}\`${reason ? ` (${reason})` : ""}, so no pod was created; try again later.`,
      );
    }
    return checked(id, (await response.json()) as ModelInfo);
  }

  /**
   * From the model's `config.json` at `main`, which vLLM downloads: one more public call (see
   * docs/web/hugging-face/unsloth-qwen3-8-27b-nvfp4-at-f0b7c9e.md).
   */
  async vision(id: string): Promise<boolean> {
    const path = repositoryPath(id);
    let response: Response;
    try {
      response = await this.#fetch(`${HUB}/${path}/resolve/main/config.json`, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new Error(
        `Hugging Face could not be reached (${error instanceof Error ? error.message : error}).`,
      );
    }
    if (!response.ok) throw new Error(`Hugging Face answered ${response.status}.`);
    const config = (await response.json().catch(() => {
      throw new Error("Its config.json is not JSON.");
    })) as { vision_config?: unknown; language_model_only?: unknown } | null;
    return (
      typeof config?.vision_config === "object" &&
      config.vision_config !== null &&
      config.language_model_only !== true
    );
  }
}

/** The model's path on the Hub, `namespace/name`; throws for anything else. */
function repositoryPath(id: string): string {
  if (!isHuggingFaceId(id)) {
    throw new Error(`\`${id}\` is not a Hugging Face model ID, \`namespace/name\`.`);
  }
  return id.split("/").map(encodeURIComponent).join("/");
}

function notPublic(id: string): Error {
  return new Error(
    `Hugging Face has no public model \`${id}\`: check its ID, whose case counts. Codeman serves only public models, without a token.`,
  );
}

/** The model of the Hub's answer, or why Codeman cannot serve it. */
export function checked(id: string, info: ModelInfo): HubModel {
  if (info.private === true) throw notPublic(id);
  if (info.disabled === true) throw new Error(`\`${id}\` is disabled on Hugging Face.`);
  if (info.gated !== undefined && info.gated !== false && info.gated !== null) {
    throw new Error(
      `\`${id}\` is gated on Hugging Face: its files need an accepted request and a token, which Codeman does not use. Choose a model that is not gated, such as a copy of it by another publisher.`,
    );
  }
  const weights = (info.siblings ?? []).filter(
    (file) => typeof file.rfilename === "string" && file.rfilename.endsWith(".safetensors"),
  );
  if (weights.length === 0) {
    throw new Error(
      `\`${id}\` has no safetensors weights on Hugging Face, which vLLM loads: choose a version of the model in safetensors, not GGUF nor PyTorch's pickles.`,
    );
  }
  const sizes = weights.map((file) => file.size);
  const summed = sizes.every((size) => typeof size === "number" && size >= 0)
    ? (sizes as number[]).reduce((total, size) => total + size, 0)
    : undefined;
  const weightsBytes =
    summed ?? (typeof info.usedStorage === "number" ? info.usedStorage : undefined);
  if (weightsBytes === undefined) {
    throw new Error(
      `Hugging Face does not give the size of \`${id}\`'s weights, which sets the pod's disk, so no pod was created.`,
    );
  }
  return { id, weightsBytes };
}
