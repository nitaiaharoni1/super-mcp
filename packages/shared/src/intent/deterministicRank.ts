import type {
  OntologySnapshot,
  QueryProfile,
  RetrievalEvidence,
  SemanticConstraint,
  SemanticGateResult,
  SemanticProfile,
} from "../types/semanticTypes.js";
import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import { gateAgainstConstraints } from "./semanticMatcher.js";
import { tokenizeNormalized } from "./tokenMatcher.js";

export interface DeterministicCandidate {
  id: string;
  name: string;
  profile: SemanticProfile;
  evidence: RetrievalEvidence;
  hasLocalPrice: boolean;
  hasPrice: boolean;
  packExcess: number;
  gate: SemanticGateResult;
}

export function constraintsFromQueryProfile(
  query: QueryProfile,
  ontology: OntologySnapshot,
): SemanticConstraint[] {
  return Object.entries(query.attributes).map(([attribute, value]) => {
    const def = ontology.attributes.find((a) => a.attribute === attribute);
    return {
      attribute,
      value,
      strength: def?.constraintStrength ?? "hard",
      source: "explicit" as const,
    };
  });
}

export function rankDeterministicCandidates(
  query: QueryProfile,
  candidates: Array<Omit<DeterministicCandidate, "gate"> & { gate?: SemanticGateResult }>,
  ontology: OntologySnapshot,
): DeterministicCandidate[] {
  const constraints = constraintsFromQueryProfile(query, ontology);

  const gated: DeterministicCandidate[] = candidates.map((candidate) => ({
    ...candidate,
    gate:
      candidate.gate ??
      gateAgainstConstraints(candidate.profile, constraints, ontology, {
        queryText: query.normalizedText,
      }),
  }));

  const allowed = gated.filter((c) => c.gate.allowed);

  return allowed.sort((a, b) => compareDeterministicCandidates(a, b, query, ontology));
}

function compareDeterministicCandidates(
  a: DeterministicCandidate,
  b: DeterministicCandidate,
  query: QueryProfile,
  ontology: OntologySnapshot,
): number {
  if (a.gate.tier !== b.gate.tier) return a.gate.tier - b.gate.tier;

  const exactNameCmp = boolDesc(a.evidence.exactName, b.evidence.exactName);
  if (exactNameCmp !== 0) return exactNameCmp;

  const exactPhraseCmp = boolDesc(a.evidence.exactPhrase, b.evidence.exactPhrase);
  if (exactPhraseCmp !== 0) return exactPhraseCmp;

  const agreementCmp = numDesc(
    attributeAgreementCount(query.attributes, a.profile),
    attributeAgreementCount(query.attributes, b.profile),
  );
  if (agreementCmp !== 0) return agreementCmp;

  const coverageCmp = numDesc(
    coreTokenCoverage(query.coreTerms, a.name, ontology.locale),
    coreTokenCoverage(query.coreTerms, b.name, ontology.locale),
  );
  if (coverageCmp !== 0) return coverageCmp;

  if (a.packExcess !== b.packExcess) return a.packExcess - b.packExcess;

  const lexicalCmp = numDesc(a.evidence.lexicalScore, b.evidence.lexicalScore);
  if (lexicalCmp !== 0) return lexicalCmp;

  const vectorCmp = numAsc(a.evidence.vectorDistance, b.evidence.vectorDistance);
  if (vectorCmp !== 0) return vectorCmp;

  const localCmp = boolDesc(a.hasLocalPrice, b.hasLocalPrice);
  if (localCmp !== 0) return localCmp;

  return a.name.length - b.name.length;
}

function attributeAgreementCount(
  queryAttributes: Record<string, string>,
  profile: SemanticProfile,
): number {
  let count = 0;
  for (const [attribute, value] of Object.entries(queryAttributes)) {
    if (profile.attributes[attribute] === value) count++;
  }
  return count;
}

function coreTokenCoverage(coreTerms: string[], name: string, locale: string): number {
  if (coreTerms.length === 0) return 0;
  const nameTokens = new Set(tokenizeNormalized(normalizeEmbedInput(name), locale));
  return coreTerms.filter((term) => nameTokens.has(term)).length;
}

function boolDesc(a: boolean, b: boolean): number {
  return Number(b) - Number(a);
}

function numDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = a ?? Number.NEGATIVE_INFINITY;
  const bv = b ?? Number.NEGATIVE_INFINITY;
  return bv - av;
}

function numAsc(a: number | null | undefined, b: number | null | undefined): number {
  const av = a ?? Number.POSITIVE_INFINITY;
  const bv = b ?? Number.POSITIVE_INFINITY;
  return av - bv;
}
