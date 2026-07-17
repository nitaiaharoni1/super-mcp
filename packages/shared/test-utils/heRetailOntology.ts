/**
 * In-memory mirror of migration seed for **unit tests only**.
 * Production loads ontology from Postgres; `getActiveOntology()` returns null on failure
 * (lexical-only fallback) — never this fixture.
 */
import type { OntologySnapshot, OntologyTerm } from "../src/types/semanticTypes.js";
import { DEFAULT_ONTOLOGY_VERSION } from "../src/types/semanticTypes.js";
import { DEFAULT_SEMANTIC_SEARCH_CONFIG } from "../src/types/semanticSearch.js";

function term(
  partial: Omit<OntologyTerm, "matchMode" | "priority" | "impliesAttribute" | "impliesValue" | "weight"> &
    Partial<Pick<OntologyTerm, "matchMode" | "priority" | "impliesAttribute" | "impliesValue" | "weight">>,
): OntologyTerm {
  return {
    impliesAttribute: null,
    impliesValue: null,
    weight: 1,
    matchMode: "token",
    priority: 0,
    ...partial,
  };
}

function attr(
  attribute: string,
  value: string,
  surface: string,
  implies?: { attribute: string; value: string },
  matchMode: OntologyTerm["matchMode"] = "token",
) {
  return term({
    kind: "attribute",
    attribute,
    value,
    term: surface,
    impliesAttribute: implies?.attribute ?? null,
    impliesValue: implies?.value ?? null,
    matchMode: surface.includes(" ") ? "phrase" : matchMode,
    priority: surface.includes(" ") ? 5 : 0,
  });
}

function alias(value: string, surface: string) {
  return term({
    kind: "alias",
    attribute: "query",
    value,
    term: surface,
    matchMode: "alias",
  });
}

function concept(
  value: string,
  surface: string,
  implies?: { attribute: string; value: string },
) {
  return term({
    kind: "concept",
    attribute: "shopping",
    value,
    term: surface,
    impliesAttribute: implies?.attribute ?? null,
    impliesValue: implies?.value ?? null,
  });
}

function penalty(attribute: string, value: string, surface: string, weight = 1) {
  return term({ kind: "penalty", attribute, value, term: surface, weight });
}

function stop(surface: string) {
  return term({ kind: "stopword", attribute: "token", value: "ignore", term: surface });
}

export function heRetailOntologyFixture(): OntologySnapshot {
  return {
    version: DEFAULT_ONTOLOGY_VERSION,
    locale: "he",
    terms: [
      attr("freshness", "fresh", "טרי"),
      attr("freshness", "fresh", "טריה"),
      attr("freshness", "fresh", "fresh"),
      attr("freshness", "frozen", "קפוא"),
      attr("freshness", "frozen", "קפואה"),
      attr("freshness", "frozen", "frozen"),
      attr("species", "chicken", "עוף"),
      attr("species", "chicken", "עופות"),
      attr("species", "chicken", "chicken"),
      attr("species", "turkey", "הודו"),
      attr("species", "turkey", "turkey"),
      attr("species", "beef", "בקר"),
      attr("species", "beef", "beef"),
      attr("cut", "thighs", "פרגיות", { attribute: "species", value: "chicken" }),
      attr("cut", "thighs", "פרגית", { attribute: "species", value: "chicken" }),
      attr("cut", "thighs", "ירכיים"),
      attr("cut", "breast", "חזה"),
      attr("cut", "schnitzel", "שניצל", { attribute: "species", value: "chicken" }),
      attr("cut", "wings", "כנפיים"),
      attr("cut", "ground", "טחון"),
      attr("form", "pickled", "במלח"),
      attr("form", "pickled", "כבוש"),
      attr("form", "pickled", "כבושים"),
      attr("form", "pickled", "חמוץ"),
      attr("form", "frozen", "קפוא"),
      attr("form", "frozen", "מוקפא"),
      attr("form", "prepared", "נקניק"),
      attr("form", "prepared", "נקניקיות"),
      attr("form", "prepared", "פסטרמה"),
      attr("form", "dessert", "קרחון"),
      attr("form", "dessert", "גלידה"),
      attr("product_class", "produce", "מלפפון"),
      attr("product_class", "produce", "מלפפונים"),
      attr("product_class", "produce", "עגבניה"),
      attr("product_class", "produce", "עגבניות"),
      attr("product_class", "produce", "בצל"),
      attr("product_class", "produce", "לימון"),
      attr("product_class", "produce", "לימונים"),
      attr("product_class", "produce", "חסה"),
      attr("product_class", "beverage", "ליקר"),
      attr("product_class", "beverage", "יין"),
      attr("kosher", "true", "כשר"),
      attr("brand", "תנובה", "תנובה"),
      attr("brand", "עוף טוב", "עוף טוב", undefined, "phrase"),
      penalty("variant", "spicy", "חריף"),
      penalty("variant", "spicy", "פיקנטי"),
      penalty("pack", "multipack", "שישייה"),
      penalty("pack", "multipack", "מארז", 0.5),
      penalty("form", "pickled", "במלח"),
      penalty("form", "pickled", "כבוש"),
      penalty("form", "prepared", "נקניק"),
      penalty("form", "dessert", "קרחון"),
      penalty("product_class", "beverage", "ליקר"),
      alias("פרגיות", "פרגיות"),
      alias("פרגיות", "פרגית"),
      alias("פרגיות", "ירכיים עוף"),
      alias("טחון", "טחון"),
      alias("טחון", "בשר טחון"),
      alias("פיתה", "פיתה"),
      alias("פיתה", "פיתות"),
      alias("בצל", "בצל"),
      alias("בצל", "בצלים"),
      alias("מלפפון", "מלפפון"),
      alias("מלפפון", "מלפפונים"),
      alias("לימון", "לימון"),
      alias("לימון", "לימונים"),
      alias("עגבניה", "עגבניה"),
      alias("עגבניה", "עגבניות"),
      alias("פלפל", "פלפל"),
      alias("פלפל", "פלפלים"),
      alias("קבב", "קבב"),
      alias("קבב", "קבבים"),
      concept("thighs", "פרגיות"),
      concept("thighs", "פרגית"),
      concept("breast", "חזה"),
      concept("ground", "טחון"),
      concept("produce", "מלפפון", { attribute: "form", value: "fresh" }),
      concept("produce", "מלפפונים", { attribute: "form", value: "fresh" }),
      concept("produce", "עגבניה", { attribute: "form", value: "fresh" }),
      concept("produce", "עגבניות", { attribute: "form", value: "fresh" }),
      concept("produce", "בצל", { attribute: "form", value: "fresh" }),
      concept("produce", "לימון", { attribute: "form", value: "fresh" }),
      concept("produce", "לימונים", { attribute: "form", value: "fresh" }),
      concept("produce", "חסה", { attribute: "form", value: "fresh" }),
      concept("produce", "בננה"),
      stop("טרי"),
      stop("קפוא"),
      stop("ארוז"),
      stop("לקג"),
      stop("קג"),
      stop("kg"),
      stop("g"),
    ],
    relaxations: [
      { attribute: "cut", fromValue: "breast", toValue: "schnitzel", label: "cut:breast_schnitzel" },
      { attribute: "cut", fromValue: "schnitzel", toValue: "breast", label: "cut:breast_schnitzel" },
      { attribute: "kosher", fromValue: "true", toValue: "unmarked", label: "kosher:unmarked" },
    ],
    attributes: [
      {
        attribute: "freshness",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "species",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: true,
        conflictPolicy: "different_value",
      },
      {
        attribute: "cut",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: true,
        conflictPolicy: "different_value",
      },
      {
        attribute: "brand",
        constraintStrength: "hard",
        missingValueBehavior: "reject",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "kosher",
        constraintStrength: "soft",
        missingValueBehavior: "relax",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "variant",
        constraintStrength: "ranking",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "pack",
        constraintStrength: "ranking",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "form",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
      {
        attribute: "product_class",
        constraintStrength: "hard",
        missingValueBehavior: "allow",
        enablesNearbyAlternative: false,
        conflictPolicy: "different_value",
      },
    ],
    searchConfig: { ...DEFAULT_SEMANTIC_SEARCH_CONFIG },
  };
}
