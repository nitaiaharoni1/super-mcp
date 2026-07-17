import { DEFAULT_EMBED_MODEL, DEFAULT_ONTOLOGY_VERSION } from "../types/semanticTypes.js";

/** Resolve active embedding model from env with shared default. */
export function resolveEmbedModel(explicit?: string | null): string {
  return explicit?.trim() || process.env.SUPER_MCP_EMBED_MODEL?.trim() || DEFAULT_EMBED_MODEL;
}

/** Resolve active ontology version id from env with shared default. */
export function resolveOntologyVersion(explicit?: string | null): string {
  return (
    explicit?.trim() ||
    process.env.SUPER_MCP_ONTOLOGY_VERSION?.trim() ||
    DEFAULT_ONTOLOGY_VERSION
  );
}

/** Alias used by API services. */
export const activeEmbedModel = resolveEmbedModel;
/** Alias used by API services. */
export const activeOntologyVersion = resolveOntologyVersion;

export function resolveEmbedBackend(explicit?: "hasher" | "transformers"): "hasher" | "transformers" {
  if (explicit) return explicit;
  const env = process.env.SUPER_MCP_EMBED_BACKEND?.trim().toLowerCase();
  if (env === "hasher") return "hasher";
  return "transformers";
}

/** SUPER_MCP_SEMANTIC_BASKET=0 → master kill switch for hybrid recall + intent gates. */
export function semanticBasketEnabled(): boolean {
  const v = process.env.SUPER_MCP_SEMANTIC_BASKET?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/** SUPER_MCP_SEMANTIC_SHADOW=1 → log lexical vs semantic disagreements without changing ranking. */
export function semanticBasketShadow(): boolean {
  const v = process.env.SUPER_MCP_SEMANTIC_SHADOW?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** Shadow V2 pipeline without changing responses. Requires basket on. */
export function semanticV2Shadow(): boolean {
  if (!semanticBasketEnabled()) return false;
  const v = process.env.SUPER_MCP_SEMANTIC_V2_SHADOW?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/**
 * Enable direct query-vector recall + RRF fusion.
 * Basket is the master switch; default on when basket is on; set V2_RECALL=0 to disable.
 */
export function semanticV2RecallEnabled(): boolean {
  if (!semanticBasketEnabled()) return false;
  const v = process.env.SUPER_MCP_SEMANTIC_V2_RECALL?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/**
 * Enable data-driven constraint policy.
 * Basket is the master switch; default on when basket is on; set V2_POLICY=0 to disable.
 */
export function semanticV2PolicyEnabled(): boolean {
  if (!semanticBasketEnabled()) return false;
  const v = process.env.SUPER_MCP_SEMANTIC_V2_POLICY?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}
