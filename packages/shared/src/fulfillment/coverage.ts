/**
 * Does this service deliver to this address?
 *
 * The physical side answers "how far is it" with a distance and a penalty. Online
 * there is no such gradient: a storefront either serves your address or it does
 * not, and the shopper needs the reason when it does not. Retailers publish the
 * answer in three incompatible shapes, so all three are supported rather than
 * flattened into a radius that would be wrong for two of them.
 */
import { canonicalizeCity, normalizeCityKey } from "../utils/cities.js";
import { haversineKm } from "../utils/storeCoordinates.js";

export type CoverageScope = "national" | "city" | "radius" | "polygon";
export type CoverageConfidence = "verified" | "reported" | "estimated";

export interface CoverageRule {
  scope: CoverageScope;
  cityKey?: string | null;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusKm?: number | null;
  /** GeoJSON Polygon or MultiPolygon, as published (Wolt exposes ~45 vertices). */
  geojson?: unknown;
  confidence: CoverageConfidence;
}

export interface CoverageQuery {
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export type CoverageVerdict =
  /** A rule matched. */
  | { serves: true; matchedScope: CoverageScope; confidence: CoverageConfidence }
  /** Rules exist and none matched — a real "we do not deliver there". */
  | { serves: false; reason: "outside_service_area" }
  /** Rules exist but the address is too vague to test them. */
  | { serves: false; reason: "address_too_vague" }
  /** No rules recorded at all: we do not know, which is not the same as no. */
  | { serves: false; reason: "coverage_unknown" };

type Ring = Array<[number, number]>;

function ringsOf(geojson: unknown): Ring[] {
  if (typeof geojson !== "object" || geojson == null) return [];
  const g = geojson as { type?: unknown; coordinates?: unknown };
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    return g.coordinates.filter(Array.isArray) as Ring[];
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    const rings: Ring[] = [];
    for (const poly of g.coordinates) {
      if (Array.isArray(poly)) rings.push(...(poly.filter(Array.isArray) as Ring[]));
    }
    return rings;
  }
  return [];
}

/**
 * Ray casting. GeoJSON is [lng, lat] — the opposite order to every other
 * coordinate in this codebase, which is exactly the kind of thing that silently
 * puts Tel Aviv in the Mediterranean, so it is unpacked explicitly.
 *
 * Only the outer ring is tested. A grocery delivery polygon does not have holes,
 * and treating an inner ring as another outer one would wrongly extend coverage.
 */
function pointInRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [aLng, aLat] = a;
    const [bLng, bLat] = b;
    if (aLng == null || aLat == null || bLng == null || bLat == null) continue;
    const straddles = aLat > lat !== bLat > lat;
    if (!straddles) continue;
    const crossingLng = ((bLng - aLng) * (lat - aLat)) / (bLat - aLat) + aLng;
    if (lng < crossingLng) inside = !inside;
  }
  return inside;
}

function ruleMatches(rule: CoverageRule, query: CoverageQuery): boolean | "untestable" {
  switch (rule.scope) {
    case "national":
      return true;
    case "city": {
      if (!query.city) return "untestable";
      // canonicalizeCity, not normalizeCityKey: a retailer's settlement list says
      // "תל אביב-יפו" and the shopper types "תל אביב" or "Tel Aviv". Only the
      // alias table collapses those to one place; normalizeCityKey just tidies
      // punctuation and would report a genuine service area as unserved.
      const want = canonicalizeCity(rule.cityKey) ?? normalizeCityKey(rule.cityKey ?? "");
      const got = canonicalizeCity(query.city) ?? normalizeCityKey(query.city);
      if (!want || !got) return "untestable";
      return want === got;
    }
    case "radius": {
      if (query.lat == null || query.lng == null) return "untestable";
      if (rule.centerLat == null || rule.centerLng == null || rule.radiusKm == null) return false;
      return (
        haversineKm(query.lat, query.lng, rule.centerLat, rule.centerLng) <= rule.radiusKm
      );
    }
    case "polygon": {
      if (query.lat == null || query.lng == null) return "untestable";
      const rings = ringsOf(rule.geojson);
      if (rings.length === 0) return false;
      const outer = rings[0];
      return outer != null && pointInRing(query.lat, query.lng, outer);
    }
    default:
      return false;
  }
}

/**
 * Most-confident wins when several rules match.
 *
 * The reported confidence describes the strongest evidence that this address is
 * served, not the weakest rule in the row. A verified national statement and an
 * estimated radius both matching means we do know: downgrading to "estimated"
 * would understate real evidence and push callers to hedge an answer that needs
 * no hedging.
 */
const CONFIDENCE_ORDER: Record<CoverageConfidence, number> = {
  verified: 2,
  reported: 1,
  estimated: 0,
};

export function evaluateCoverage(
  rules: readonly CoverageRule[],
  query: CoverageQuery,
): CoverageVerdict {
  if (rules.length === 0) return { serves: false, reason: "coverage_unknown" };

  let best: { scope: CoverageScope; confidence: CoverageConfidence } | null = null;
  let sawUntestable = false;

  for (const rule of rules) {
    const result = ruleMatches(rule, query);
    if (result === "untestable") {
      sawUntestable = true;
      continue;
    }
    if (!result) continue;
    if (
      best == null ||
      CONFIDENCE_ORDER[rule.confidence] > CONFIDENCE_ORDER[best.confidence]
    ) {
      best = { scope: rule.scope, confidence: rule.confidence };
    }
  }

  if (best) return { serves: true, matchedScope: best.scope, confidence: best.confidence };
  // Nothing matched, but something could not be tested: the honest answer is
  // "tell me where you are", not "they do not deliver to you".
  if (sawUntestable) return { serves: false, reason: "address_too_vague" };
  return { serves: false, reason: "outside_service_area" };
}
