import { DEFAULT_EMBED_DIMS, embedTextLocal } from "@super-mcp/shared";
import { resolveBackend } from "./config.js";
import type { EmbedFn } from "./types.js";

let pipelinePromise: Promise<EmbedFn> | null = null;
let activeBackend: "hasher" | "transformers" | null = null;
let activeModel: string | null = null;

export async function getEmbedder(
  backend: "hasher" | "transformers",
  model: string,
): Promise<EmbedFn> {
  if (backend === "hasher") {
    return async (text: string) => embedTextLocal(text, DEFAULT_EMBED_DIMS);
  }
  if (pipelinePromise && activeBackend === "transformers" && activeModel === model) {
    return pipelinePromise;
  }

  // Reset before awaiting so a concurrent model switch cannot observe a stale promise.
  activeBackend = "transformers";
  activeModel = model;
  const loadingModel = model;
  const next = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline("feature-extraction", loadingModel, {
      dtype: "fp32",
    });
    return async (text: string) => {
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const data = Array.from(output.data as Float32Array | number[]);
      if (data.length !== DEFAULT_EMBED_DIMS) {
        throw new Error(
          `Embedding dims mismatch: got ${data.length}, expected ${DEFAULT_EMBED_DIMS} for model ${loadingModel}`,
        );
      }
      return data;
    };
  })();
  pipelinePromise = next;
  try {
    return await next;
  } catch (err) {
    if (pipelinePromise === next) {
      pipelinePromise = null;
      activeBackend = null;
      activeModel = null;
    }
    throw err;
  }
}

/** Embed a single text with the process-wide embedder singleton. Validates 384 finite dims. */
export async function embedText(
  text: string,
  model: string,
  backend?: "hasher" | "transformers",
): Promise<number[]> {
  const resolved = resolveBackend(backend);
  const embed = await getEmbedder(resolved, model);
  const data = await embed(text);
  if (data.length !== DEFAULT_EMBED_DIMS) {
    throw new Error(
      `Embedding dims mismatch: got ${data.length}, expected ${DEFAULT_EMBED_DIMS} for model ${model}`,
    );
  }
  if (!data.every(Number.isFinite)) {
    throw new Error(`Embedding contains non-finite values for model ${model}`);
  }
  return data;
}
