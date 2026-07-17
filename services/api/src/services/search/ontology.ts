import { getPool, loadOntologySnapshot, query } from "@super-mcp/db";
import {
  resolveEmbedModel,
  resolveOntologyVersion,
  type OntologySnapshot,
  type SemanticProfile,
} from "@super-mcp/shared";

let cached: { version: string; snapshot: OntologySnapshot; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function activeEmbedModel(): string {
  return resolveEmbedModel();
}

export function activeOntologyVersion(): string {
  return resolveOntologyVersion();
}

/**
 * Load active ontology from DB with short TTL cache.
 * On failure returns null — callers disable semantic gating / use defaults.
 * No hand-maintained production fixture fallback.
 */
export async function getActiveOntology(): Promise<OntologySnapshot | null> {
  const version = activeOntologyVersion();
  if (cached && cached.version === version && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.snapshot;
  }
  try {
    const snapshot = await loadOntologySnapshot(getPool(), version);
    cached = { version: snapshot.version, snapshot, loadedAt: Date.now() };
    return snapshot;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        event: "ontology_load_failed",
        error: message,
        fallback: "lexical_only",
      }),
    );
    cached = null;
    return null;
  }
}

export function clearOntologyCache(): void {
  cached = null;
}

export type SemanticProfileRow = SemanticProfile;

/** Load complete semantic profiles for product ids at a given ontology version. */
export async function loadSemanticProfiles(
  productIds: string[],
  ontologyVersion: string,
): Promise<Map<string, SemanticProfile>> {
  const out = new Map<string, SemanticProfile>();
  if (productIds.length === 0) return out;
  try {
    const res = await query<{
      product_id: string;
      attributes: Record<string, string>;
      concepts: string[] | null;
      penalties: string[] | null;
      concept_terms: string[] | null;
    }>(
      `SELECT product_id, attributes, concepts, penalties, concept_terms
       FROM product_semantic_profile
       WHERE ontology_version = $1 AND product_id = ANY($2::uuid[])`,
      [ontologyVersion, productIds],
    );
    for (const row of res.rows) {
      out.set(row.product_id, {
        attributes: row.attributes ?? {},
        concepts: row.concepts ?? [],
        penalties: row.penalties ?? [],
        conceptTerms: row.concept_terms ?? [],
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/product_semantic_profile|does not exist|relation|concept_terms|penalties/i.test(message)) {
      throw err;
    }
    console.warn(
      JSON.stringify({
        event: "semantic_profiles_unavailable",
        error: message,
        fallback: "name_derived_profiles",
      }),
    );
  }
  return out;
}
