import { createHash } from "node:crypto";
import { DEFAULT_EMBED_DIMS, DEFAULT_EMBED_MODEL } from "../types/semanticTypes.js";

/** Active embedding generation defaults (overridable via env in workers/API). */
export const LOCAL_EMBED_MODEL = DEFAULT_EMBED_MODEL;
export const LOCAL_EMBED_DIMS = DEFAULT_EMBED_DIMS;

/**
 * Deterministic fallback hasher for tests / when the multilingual model is unavailable.
 * Production indexing uses @huggingface/transformers via packages/db semanticIndex.
 */
export function embedTextLocal(text: string, dims = LOCAL_EMBED_DIMS): number[] {
  const normalized = normalizeEmbedInput(text);
  const vec = new Float64Array(dims);
  if (!normalized) return Array.from(vec);

  const grams = charNgrams(normalized, 2, 4);
  for (const gram of grams) {
    const h = fnv1a(gram);
    const idx = h % dims;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx]! += sign;
  }

  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dims);
  for (let i = 0; i < dims; i++) out[i] = vec[i]! / norm;
  return out;
}

export function embedInputHash(text: string): string {
  return createHash("sha256").update(normalizeEmbedInput(text)).digest("hex").slice(0, 32);
}

export function formatVectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(8) : "0")).join(",")}]`;
}

export function buildProductEmbedText(input: {
  name: string;
  brand?: string | null;
  categoryL1?: string | null;
  categoryL2?: string | null;
  listingNames?: string[];
}): string {
  const listings = [...(input.listingNames ?? [])].map((n) => n.trim()).filter(Boolean).sort();
  const parts = [
    input.name,
    input.brand ?? "",
    input.categoryL1 ?? "",
    input.categoryL2 ?? "",
    ...listings,
  ];
  return normalizeEmbedInput(parts.filter(Boolean).join(" "));
}

export function normalizeEmbedInput(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['׳`"]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function charNgrams(text: string, minN: number, maxN: number): string[] {
  const padded = ` ${text} `;
  const out: string[] = [];
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i + n <= padded.length; i++) {
      out.push(padded.slice(i, i + n));
    }
  }
  return out;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
