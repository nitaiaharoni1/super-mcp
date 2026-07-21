import type {
  OntologySnapshot,
  OntologyTerm,
  SemanticAttributeDefinition,
  SemanticConstraint,
  SemanticGateResult,
  SemanticProfile,
  SemanticSearchConfig,
} from "../types/semanticTypes.js";
import { DEFAULT_SEMANTIC_SEARCH_CONFIG } from "../types/semanticSearch.js";
import { normalizeEmbedInput } from "../embeddings/localEmbed.js";
import { matchOntologyTerms, tokenizeNormalized } from "./tokenMatcher.js";

/**
 * Surface cues that mean preserved / prepared / flour — never interchangeable
 * with a fresh weighted produce staple even when they share a produce token.
 */
const NON_FRESH_FORM_CUES: ReadonlyArray<{ form: string; tokens: readonly string[] }> = [
  { form: "pickled", tokens: ["כבוש", "כבושה", "כבושי", "כבושים", "חמוץ", "חמוצה", "חמוצים"] },
  {
    form: "canned",
    tokens: ["מרוסק", "מרוסקת", "מרוסקות", "מרוסקים", "משומר", "משומרת", "משומרים", "שימורים"],
  },
  { form: "flour", tokens: ["קמח"] },
  {
    form: "prepared",
    tokens: ["ניוקי", "רביולי", "טורטליני", "קצוץ", "קצוצה", "פרוס", "פרוסה", "פרוסות", "מיובש", "מיובשים"],
  },
  { form: "frozen", tokens: ["קפוא", "קפואה", "מוקפא", "מוקפאת"] },
];

/** Personal-care / bath tokens that poison food oil / staple queries. */
const PERSONAL_CARE_TOKENS: ReadonlySet<string> = new Set([
  "אמבט",
  "אמבטיה",
  "רחצה",
  "שמפו",
  "סבון",
  "קוסמטי",
  "קוסמטיקה",
]);

/** Common fresh-produce stems / phrases for quantity-derived form=fresh. */
const PRODUCE_QUERY_PHRASES: readonly string[] = [
  "תפוחי אדמה",
  "תפוח אדמה",
  'תפו"א',
  "עגבניות",
  "עגבניה",
  "מלפפונים",
  "מלפפון",
  "בצל",
  "לימון",
  "לימונים",
  "גזר",
  "בננה",
  "בננות",
  "חסה",
  "פלפל",
  "שום",
  "חציל",
  "קישוא",
  "אבוקדו",
  "בטטה",
];

/** Detect a non-fresh form cue in free text (query or product name). */
export function detectNonFreshForm(text: string): string | null {
  const tokens = new Set(tokenizeNormalized(normalizeEmbedInput(text)));
  for (const cue of NON_FRESH_FORM_CUES) {
    if (cue.tokens.some((t) => tokens.has(normalizeEmbedInput(t)) || tokens.has(t))) {
      return cue.form;
    }
  }
  return null;
}

/** True when the query explicitly asks for a preserved/prepared/flour form. */
export function queryBlocksFreshProduce(text: string): boolean {
  return detectNonFreshForm(text) != null;
}

export function queryLooksLikeProduce(text: string): boolean {
  const normalized = normalizeEmbedInput(text);
  if (!normalized) return false;
  if (PRODUCE_QUERY_PHRASES.some((p) => normalized.includes(normalizeEmbedInput(p)))) {
    return true;
  }
  const tokens = tokenizeNormalized(normalized);
  return tokens.some((t) =>
    PRODUCE_QUERY_PHRASES.some((p) => {
      const pt = tokenizeNormalized(normalizeEmbedInput(p));
      return pt.length === 1 && pt[0] === t;
    }),
  );
}

export function queryHasPersonalCareCue(text: string): boolean {
  const tokens = tokenizeNormalized(normalizeEmbedInput(text));
  return tokens.some((t) => PERSONAL_CARE_TOKENS.has(t));
}

/**
 * Explicit pack / volume tokens embedded in the query (not amount+unit opts).
 * piece_count is a hard attribute string; volume becomes requestedAmount with
 * display unit "L" for liters.
 */
export function parseExplicitPackConstraints(query: string): {
  pieceCount: string | null;
  requestedAmount: { quantity: number; unit: string } | null;
} {
  const raw = query.replace(/\s+/g, " ").trim();
  if (!raw) return { pieceCount: null, requestedAmount: null };

  let pieceCount: string | null = null;
  const tray =
    raw.match(/תבנית\s*(\d+(?:\.\d+)?)/i) ||
    raw.match(/(\d+(?:\.\d+)?)\s*(?:יחידות|יח['׳]?)(?=$|[\s,.\-_/])/i) ||
    raw.match(/(?:^|[\s])(\d+(?:\.\d+)?)\s*ביצ/);
  if (tray?.[1]) {
    const n = Number(tray[1]);
    if (Number.isFinite(n) && n > 0) pieceCount = String(Math.round(n));
  }

  let requestedAmount: { quantity: number; unit: string } | null = null;
  const liter = raw.match(/(\d+(?:\.\d+)?)\s*(?:ליטר|ליטרים|ל\.?|l|L)(?=$|[\s,.\-_/])/i);
  const ml = raw.match(/(\d+(?:\.\d+)?)\s*(?:מ["״]?ל|ml|מיליליטר)(?=$|[\s,.\-_/])/i);
  if (liter?.[1] && !ml) {
    const n = Number(liter[1]);
    if (Number.isFinite(n) && n > 0) requestedAmount = { quantity: n, unit: "L" };
  } else if (ml?.[1]) {
    const n = Number(ml[1]);
    if (Number.isFinite(n) && n > 0) requestedAmount = { quantity: n, unit: "ml" };
  }

  return { pieceCount, requestedAmount };
}

/**
 * Non-fresh surface forms override a produce-concept form=fresh implication so
 * crushed/flour/prepared names hard-conflict with a fresh produce query.
 */
export function applyNonFreshSurfaceForms(
  text: string,
  attributes: Record<string, string>,
): void {
  const form = detectNonFreshForm(text);
  if (!form) return;
  if (attributes.form == null || attributes.form === "fresh") {
    attributes.form = form;
  }
}

/**
 * Build a semantic profile from free text using a loaded ontology snapshot.
 * Longest/highest-priority term match wins per attribute; implications apply
 * only when the implied attribute is still unset.
 */
export function profileFromText(text: string, ontology: OntologySnapshot): SemanticProfile {
  const normalized = normalizeEmbedInput(text);
  const attributes: Record<string, string> = {};
  const concepts = new Set<string>();
  const penalties = new Set<string>();
  const matchedTerms: OntologyTerm[] = [];
  const claimed = new Set<string>();

  const matches = matchOntologyTerms(text, ontology);
  for (const match of matches) {
    const term = match.term;
    matchedTerms.push(term);

    if (term.kind === "concept" && term.value) {
      concepts.add(term.value);
      continue;
    }
    if (term.kind === "penalty" && term.attribute && term.value) {
      penalties.add(`${term.attribute}:${term.value}`);
      continue;
    }
    if (term.kind === "attribute" && term.attribute && term.value) {
      if (!claimed.has(term.attribute)) {
        attributes[term.attribute] = term.value;
        claimed.add(term.attribute);
      }
    }
  }

  // Apply implications only when the target attribute is unset.
  for (const term of matchedTerms) {
    if (term.impliesAttribute && term.impliesValue && attributes[term.impliesAttribute] == null) {
      attributes[term.impliesAttribute] = term.impliesValue;
    }
  }

  // Crushed/flour/prepared cues beat produce-concept form=fresh.
  applyNonFreshSurfaceForms(text, attributes);

  const stopwords = new Set(
    ontology.terms
      .filter((t) => t.kind === "stopword")
      .map((t) => normalizeEmbedInput(t.term))
      .filter(Boolean),
  );

  const conceptTerms = tokenizeNormalized(normalized, ontology.locale).filter(
    (t) => t.length >= 2 && !stopwords.has(t),
  );

  return {
    attributes,
    concepts: [...concepts],
    penalties: [...penalties],
    conceptTerms,
  };
}

function attributeDefinitionMap(
  ontology: OntologySnapshot,
): Map<string, SemanticAttributeDefinition> {
  return new Map((ontology.attributes ?? []).map((a) => [a.attribute, a]));
}

/** Extract query constraints (hard attributes + soft concept markers). */
export function extractConstraints(query: string, ontology: OntologySnapshot): SemanticConstraint[] {
  const profile = profileFromText(query, ontology);
  const defs = attributeDefinitionMap(ontology);
  const out: SemanticConstraint[] = [];

  for (const [attribute, value] of Object.entries(profile.attributes)) {
    const def = defs.get(attribute);
    out.push({
      attribute,
      value,
      strength: def?.constraintStrength ?? "ranking",
      source: "explicit",
    });
  }

  // Mark attributes that arrived only via implication (not an explicit surface for that value).
  const matches = matchOntologyTerms(query, ontology);
  for (const m of matches) {
    const term = m.term;
    if (term.kind !== "attribute" || !term.impliesAttribute || !term.impliesValue) continue;
    if (profile.attributes[term.impliesAttribute] !== term.impliesValue) continue;
    const existing = out.find(
      (c) => c.attribute === term.impliesAttribute && c.value === term.impliesValue,
    );
    if (!existing) continue;
    const hasExplicitSurface = matches.some((other) => {
      const t = other.term;
      return (
        t.kind === "attribute" &&
        t.attribute === term.impliesAttribute &&
        t.value === term.impliesValue &&
        !t.impliesAttribute
      );
    });
    if (!hasExplicitSurface) {
      existing.source = "implied";
    }
  }

  return out;
}

export function expandQueryAliases(query: string, ontology: OntologySnapshot, limit = 4): string[] {
  const q = query.trim();
  if (!q) return [];
  const out = new Set<string>([q]);
  const aliases = ontology.terms.filter((t) => t.kind === "alias" && t.value);
  const matches = matchOntologyTerms(query, ontology).filter((m) => m.term.kind === "alias");

  for (const match of matches) {
    const alias = match.term;
    if (!alias.value) continue;
    out.add(alias.value);
    for (const sibling of aliases) {
      if (sibling.value === alias.value) out.add(sibling.term);
    }
  }

  return [...out].filter(Boolean).slice(0, limit);
}

/**
 * Gate a candidate profile (or raw name) against query constraints.
 * Same-attribute different values are hard conflicts unless a relaxation exists.
 */
export function gateAgainstConstraints(
  candidate: SemanticProfile | string,
  queryConstraints: SemanticConstraint[],
  ontology: OntologySnapshot,
  opts?: { queryText?: string },
): SemanticGateResult {
  const profile =
    typeof candidate === "string" ? profileFromText(candidate, ontology) : candidate;
  const conflicts: string[] = [];
  const relaxed: string[] = [];
  let penaltyScore = 0;
  const defs = attributeDefinitionMap(ontology);

  const queryAttrs = new Map<string, SemanticConstraint>();
  for (const c of queryConstraints) {
    // Prefer explicit over implied when both exist.
    const prev = queryAttrs.get(c.attribute);
    if (!prev || (prev.source === "implied" && c.source === "explicit")) {
      queryAttrs.set(c.attribute, c);
    }
  }

  for (const [attribute, constraint] of queryAttrs) {
    const got = profile.attributes[attribute];
    const def = defs.get(attribute);
    const strength = constraint.strength;
    const conflictPolicy = def?.conflictPolicy ?? "different_value";
    const missingBehavior = def?.missingValueBehavior ?? "allow";

    if (!got) {
      // Implied constraints never hard-reject on missing values.
      if (constraint.source === "implied" || missingBehavior === "allow") continue;
      if (missingBehavior === "relax") {
        const relax = ontology.relaxations.find(
          (r) => r.attribute === attribute && r.fromValue === constraint.value,
        );
        relaxed.push(relax?.label ?? `${attribute}:missing_relaxed`);
        continue;
      }
      // reject
      if (strength === "hard") {
        conflicts.push(`${attribute}:requested_${constraint.value}_got_missing`);
      } else {
        relaxed.push(`${attribute}:missing`);
      }
      continue;
    }

    if (got === constraint.value) continue;

    if (isRelaxation(ontology, attribute, constraint.value, got)) {
      const label =
        ontology.relaxations.find(
          (r) =>
            r.attribute === attribute &&
            r.fromValue === constraint.value &&
            r.toValue === got,
        )?.label ?? `${attribute}:${constraint.value}_${got}`;
      relaxed.push(label);
      continue;
    }

    // explicit_pairs: mismatches without a relaxation are soft until conflict pairs exist.
    if (conflictPolicy === "explicit_pairs") {
      relaxed.push(`${attribute}:soft_mismatch`);
      continue;
    }

    // Implied constraints never hard-reject — ranking/soft only (spec).
    if (constraint.source === "implied") {
      relaxed.push(`${attribute}:implied_mismatch`);
      continue;
    }

    if (strength === "hard") {
      conflicts.push(`${attribute}:requested_${constraint.value}_got_${got}`);
    } else {
      relaxed.push(`${attribute}:soft_mismatch`);
    }
  }

  // Unrequested penalties on the candidate.
  const queryMatches = opts?.queryText ? matchOntologyTerms(opts.queryText, ontology) : [];
  const queryPenaltySurfaces = new Set(
    queryMatches
      .filter((m) => m.term.kind === "penalty")
      .map((m) => m.surface),
  );

  for (const pen of profile.penalties) {
    const [attr, val] = pen.split(":");
    const penaltyTerms = ontology.terms.filter(
      (t) => t.kind === "penalty" && t.attribute === attr && t.value === val,
    );
    if (penaltyTerms.length === 0) continue;
    const queryWaives = penaltyTerms.some((t) => {
      const surface = normalizeEmbedInput(t.term);
      return surface && queryPenaltySurfaces.has(surface);
    });
    if (queryWaives) continue;
    penaltyScore += penaltyTerms[0]!.weight;
    relaxed.push(`penalty:${pen}`);
  }

  if (conflicts.length > 0) {
    return { allowed: false, tier: 0, conflicts, relaxed, penaltyScore };
  }

  const queryProfile = opts?.queryText
    ? profileFromText(opts.queryText, ontology)
    : { attributes: {}, concepts: [] as string[], penalties: [] as string[], conceptTerms: [] as string[] };

  const sharedConcept =
    queryProfile.concepts.some((c) => profile.concepts.includes(c)) ||
    queryProfile.conceptTerms.some(
      (t) =>
        profile.conceptTerms.includes(t) ||
        tokenizeNormalized(
          normalizeEmbedInput(Object.values(profile.attributes).join(" ")),
          ontology.locale,
        ).includes(t),
    ) ||
    [...queryAttrs.keys()].some((a) => {
      const qv = queryAttrs.get(a)?.value;
      return qv != null && profile.attributes[a] === qv;
    });

  const queryEnablesNearby = [...queryAttrs.keys()].some(
    (a) => defs.get(a)?.enablesNearbyAlternative === true,
  );
  const nearbyEnabled = (ontology.searchConfig ?? DEFAULT_SEMANTIC_SEARCH_CONFIG)
    .nearbyAlternativesEnabled;

  // Attribute/policy relaxations beat nearby demotion (e.g. breast↔schnitzel).
  // Penalties alone do not count — they only affect penaltyScore / later tier-2.
  const hasAttrRelaxation = relaxed.some(
    (r) => !r.startsWith("penalty:") && !r.startsWith("concept:"),
  );
  if (hasAttrRelaxation) {
    return { allowed: true, tier: 2, conflicts, relaxed, penaltyScore };
  }

  if (!sharedConcept && queryEnablesNearby) {
    if (nearbyEnabled) {
      return {
        allowed: true,
        tier: 3,
        conflicts,
        relaxed: [...relaxed, "concept:nearby_alternative"],
        penaltyScore,
      };
    }
    // Nearby disabled: do not promote unmatched candidates to tier 1.
    return {
      allowed: false,
      tier: 0,
      conflicts: [...conflicts, "concept:no_shared"],
      relaxed,
      penaltyScore,
    };
  }

  if (relaxed.length > 0) {
    return { allowed: true, tier: 2, conflicts, relaxed, penaltyScore };
  }
  return { allowed: true, tier: 1, conflicts, relaxed, penaltyScore };
}

function isRelaxation(
  ontology: OntologySnapshot,
  attribute: string,
  fromValue: string,
  toValue: string,
): boolean {
  return ontology.relaxations.some(
    (r) => r.attribute === attribute && r.fromValue === fromValue && r.toValue === toValue,
  );
}

/** Tiny in-memory ontology for unit tests (no DB). */
export function buildOntologySnapshot(partial: {
  version?: string;
  locale?: string;
  terms: Array<
    Omit<OntologyTerm, "matchMode" | "priority" | "impliesAttribute" | "impliesValue" | "weight"> &
      Partial<Pick<OntologyTerm, "matchMode" | "priority" | "impliesAttribute" | "impliesValue" | "weight">>
  >;
  relaxations?: OntologySnapshot["relaxations"];
  attributes?: OntologySnapshot["attributes"];
  searchConfig?: Partial<SemanticSearchConfig>;
}): OntologySnapshot {
  return {
    version: partial.version ?? "test",
    locale: partial.locale ?? "und",
    terms: partial.terms.map((t) => {
      const surface = normalizeEmbedInput(t.term);
      const matchMode = t.matchMode ?? (surface.includes(" ") ? "phrase" : "token");
      return {
        kind: t.kind,
        attribute: t.attribute,
        value: t.value,
        term: t.term,
        impliesAttribute: t.impliesAttribute ?? null,
        impliesValue: t.impliesValue ?? null,
        weight: t.weight ?? 1,
        matchMode,
        priority: t.priority ?? 0,
      };
    }),
    relaxations: partial.relaxations ?? [],
    attributes: partial.attributes ?? [],
    searchConfig: {
      ...DEFAULT_SEMANTIC_SEARCH_CONFIG,
      ...partial.searchConfig,
    },
  };
}
