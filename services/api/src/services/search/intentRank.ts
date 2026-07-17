import {
  expandQueryAliases,
  extractConstraints,
  extractProductIntent,
  gateAgainstConstraints,
  profileFromText,
  type OntologySnapshot,
  type ProductIntent,
  type SemanticProfile,
} from "@super-mcp/shared";
import type { SearchProductHit } from "./types.js";

export interface RankedIntentHit extends SearchProductHit {
  intentTier: 1 | 2 | 3 | 0;
  intentConflicts: string[];
  intentRelaxed: string[];
  penaltyScore: number;
}

export interface RankHitsOptions {
  preferLocal?: boolean;
  ontology: OntologySnapshot;
  /** Optional precomputed profiles keyed by product id. */
  profiles?: Map<string, SemanticProfile | Partial<SemanticProfile>>;
}

function compareRankedHits(
  a: RankedIntentHit,
  b: RankedIntentHit,
  preferLocal: boolean,
  locale: string,
): number {
  if (preferLocal && a.hasLocalPrice !== b.hasLocalPrice) {
    return a.hasLocalPrice ? -1 : 1;
  }
  if (a.intentTier !== b.intentTier) return a.intentTier - b.intentTier;
  if (a.penaltyScore !== b.penaltyScore) return a.penaltyScore - b.penaltyScore;
  if (a.hasPrice !== b.hasPrice) return a.hasPrice ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  return a.name.localeCompare(b.name, locale);
}

/** Prefer complete stored profiles; fill only missing fields from the product name. */
function toCompleteProfile(
  stored: SemanticProfile | Partial<SemanticProfile>,
  hitName: string,
  ontology: OntologySnapshot,
): SemanticProfile {
  const hasConceptTerms = Array.isArray(stored.conceptTerms);
  const hasPenalties = Array.isArray(stored.penalties);
  const nameProfile =
    hasConceptTerms && hasPenalties ? null : profileFromText(hitName, ontology);

  return {
    attributes: stored.attributes ?? {},
    concepts: stored.concepts ?? [],
    penalties: hasPenalties ? (stored.penalties as string[]) : (nameProfile?.penalties ?? []),
    conceptTerms: hasConceptTerms
      ? (stored.conceptTerms as string[])
      : (nameProfile?.conceptTerms ?? []),
  };
}

/**
 * Re-rank search hits for a free-text shopping query:
 * local stock → intent tier → penalty → lexical/vector score.
 */
export function rankHitsForIntent(
  hits: SearchProductHit[],
  query: string,
  opts: RankHitsOptions,
): { intent: ProductIntent; ranked: RankedIntentHit[] } {
  if (!opts?.ontology) {
    throw new Error("rankHitsForIntent requires opts.ontology");
  }
  const ontology = opts.ontology;
  const intent = extractProductIntent(query, ontology);
  const constraints = extractConstraints(query, ontology);
  const preferLocal = opts.preferLocal !== false;
  const ranked: RankedIntentHit[] = [];

  for (const hit of hits) {
    const stored = opts.profiles?.get(hit.id);
    const fromName = gateAgainstConstraints(hit.name, constraints, ontology, {
      queryText: query,
    });

    let gate = fromName;
    if (stored) {
      const profile = toCompleteProfile(stored, hit.name, ontology);
      const fromProfile = gateAgainstConstraints(profile, constraints, ontology, {
        queryText: query,
      });
      // Value mismatches on the product name always win (stale/partial profiles).
      // Missing attrs on a sparse name do not override a complete stored profile.
      const nameValueConflicts = fromName.conflicts.filter(
        (c) => c.includes("_got_") && !c.endsWith("_got_missing"),
      );
      if (nameValueConflicts.length > 0) {
        gate = { ...fromName, allowed: false, conflicts: nameValueConflicts, tier: 0 };
      } else if (!fromProfile.allowed) {
        gate = fromProfile;
      } else {
        gate = {
          ...fromProfile,
          penaltyScore: Array.isArray(stored.penalties)
            ? fromProfile.penaltyScore
            : fromName.penaltyScore,
          relaxed: [
            ...new Set([
              ...fromProfile.relaxed,
              ...fromName.relaxed.filter((r) => r.startsWith("penalty:")),
            ]),
          ],
        };
      }
    }

    if (!gate.allowed) continue;
    ranked.push({
      ...hit,
      intentTier: gate.tier,
      intentConflicts: gate.conflicts,
      intentRelaxed: gate.relaxed,
      penaltyScore: gate.penaltyScore,
    });
  }

  ranked.sort((a, b) => compareRankedHits(a, b, preferLocal, ontology.locale || "he"));

  if (preferLocal) {
    const localExact = ranked.filter((h) => h.hasLocalPrice && h.intentTier <= 2);
    if (localExact.length > 0) return { intent, ranked: localExact };
    const anyLocal = ranked.filter((h) => h.hasLocalPrice);
    if (anyLocal.length > 0) return { intent, ranked: anyLocal };
  }

  return { intent, ranked };
}

/** Expand query with ontology aliases then dedupe search terms. */
export function searchQueriesForIntent(query: string, ontology: OntologySnapshot): string[] {
  if (!ontology) {
    throw new Error("searchQueriesForIntent requires ontology");
  }
  return expandQueryAliases(query, ontology, 4);
}

/** Merge search batches by product id — best score wins; local price breaks ties. */
export function mergeSearchHits(batches: SearchProductHit[][]): SearchProductHit[] {
  const merged = new Map<string, SearchProductHit>();
  for (const batch of batches) {
    for (const hit of batch) {
      const prev = merged.get(hit.id);
      if (!prev || hit.score > prev.score || (hit.hasLocalPrice && !prev.hasLocalPrice)) {
        merged.set(hit.id, hit);
      }
    }
  }
  return [...merged.values()];
}
