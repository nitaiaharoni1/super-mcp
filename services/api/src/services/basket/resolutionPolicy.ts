import {
  buildQueryProfile,
  normalizeEmbedInput,
  parseExplicitPackConstraints,
  queryTokensSatisfied,
  resolvePurchaseQty,
  tokenizeNormalized,
  type OntologySnapshot,
  type QueryProfile,
} from "@super-mcp/shared";
import { rejectUnsafeChickenName } from "./chickenSafety.js";
import { preferDirectForm } from "./derivedForm.js";
import {
  buildCommodityEquivalents,
  dominantClassAmong,
  queryHeadAnchored,
  restrictToDominantClassL2,
} from "./equivalence.js";
import { rejectUnsafePlainMilkName } from "./milkSafety.js";
import { rejectUnsafePlainYogurtName } from "./yogurtSafety.js";
import { assertPurchaseQtyPreservesRequest } from "./purchaseQtyGuard.js";
import { filterSafeCandidates, rankSafeCandidatesForFast } from "./rankQueryCandidates.js";
import { isEligibleForFastBestEffortCandidate } from "./resolutionDecision.js";
import { isVectorOnly } from "./vectorOnly.js";
import type {
  BasketAssumption,
  BasketCandidate,
  BasketItemInput,
  CandidateAvailability,
  ResolvedItem,
} from "./types.js";

export type FastResolutionOutcome =
  | {
      kind: "selected";
      item: ResolvedItem;
      assumption: BasketAssumption | null;
    }
  | {
      kind: "omitted";
      item: ResolvedItem;
      assumption: BasketAssumption;
    };

export interface FastResolutionPolicyResult {
  items: ResolvedItem[];
  assumptions: BasketAssumption[];
}

function isSafelyPricable(item: ResolvedItem): boolean {
  return item.resolutionStatus === "resolved" || (item.productId != null && !item.lowConfidence);
}

/**
 * Same profile builder the resolve/rank path uses (`buildQueryProfile` + ontology
 * extractConstraints) so brand/variant/dietary/organic/fat hard attrs feed
 * `filterSafeCandidates`. Lexical-only fallback when ontology is unavailable.
 */
function buildProfileForFast(
  item: BasketItemInput,
  ontology: OntologySnapshot | null,
): QueryProfile {
  const query = item.query?.trim() ?? "";
  if (ontology && query) {
    return buildQueryProfile(query, ontology, {
      amount: item.amount ?? null,
      unit: item.unit ?? null,
    });
  }

  const parsed = parseExplicitPackConstraints(query);
  const attributes: Record<string, string> = {};
  if (parsed.pieceCount) attributes.piece_count = parsed.pieceCount;
  const requestedAmount =
    item.amount != null && item.unit?.trim()
      ? { quantity: item.amount, unit: item.unit.trim() }
      : parsed.requestedAmount;

  return {
    normalizedText: normalizeEmbedInput(query),
    coreTerms: tokenizeNormalized(normalizeEmbedInput(query)),
    category: null,
    attributes,
    requestedAmount,
  };
}

function hasLocalAvailability(
  candidate: BasketCandidate,
  availability: Map<string, CandidateAvailability>,
): boolean {
  if (candidate.hasLocalPrice) return true;
  return (availability.get(candidate.productId)?.pricedStoreCount ?? 0) > 0;
}

function candidateLooksVectorOnly(candidate: BasketCandidate): boolean {
  return isVectorOnly({
    matchedVia: candidate.matchedVia,
    lexicalScore: candidate.matchedVia === "vector" ? 0 : candidate.score,
  });
}

function shareCompatibleClass(candidates: BasketCandidate[]): boolean {
  const l1 = [
    ...new Set(candidates.map((c) => c.classL1).filter((x): x is string => x != null && x !== "")),
  ];
  if (l1.length > 1) return false;
  if (l1.length === 1) return true;
  const flat = [
    ...new Set(
      candidates.map((c) => c.productClass).filter((x): x is string => x != null && x !== ""),
    ),
  ];
  return flat.length <= 1;
}

/**
 * Narrow a candidate pool to one kind of thing.
 *
 * Two levels, because L1 is too coarse to be safe on its own: beef and a vegan
 * patty are both `meat_fish`, so an L1-only test left "בשר טחון" free to resolve
 * onto "בשר טחון ביונד מיט". That is not hypothetical — it priced ₪159.60 of
 * Beyond Meat against ₪44.90 beef on the same shelf, and it reached the shopper
 * through THREE different call sites that each trusted this function or plain
 * rank order to keep the pool honest. L2 narrowing runs even when L1 already
 * agrees, which is the whole point.
 *
 * The class is now the pool's MAJORITY, matching what this function has always
 * been called. It used to be whichever candidate happened to be classified
 * first, which is rank order, which is the exact-name arm of the search score.
 * So one mislabelled or plainly wrong top hit dictated the class and everything
 * else was discarded: "שמן" led with `שמן אלוורה 200 מל דר פישר` (aloe vera skin
 * oil), that made cosmetics the class, and all seventeen cooking oils were
 * filtered out. The pool came out of here holding ONE candidate, so the
 * availability upgrade downstream had nothing to move to and the basket bought
 * tanning oil. `שמן גזר לשיזוף` reached the benchmark the same way.
 *
 * Sharing `dominantClassAmong` with the L2 pass also brings the two rules into
 * line: a bare plurality is not enough, and an unclassified candidate is never
 * the odd one out.
 */
function restrictToDominantClass(candidates: BasketCandidate[]): BasketCandidate[] {
  if (candidates.length === 0) return candidates;
  if (shareCompatibleClass(candidates)) return restrictToDominantClassL2(candidates);

  // Majority when the labels agree on one; otherwise the top-ranked candidate's
  // class, which is what this did before.
  //
  // The fallback is load-bearing and was missed the first time. Returning the
  // pool un-narrowed on a split looks harmless here, but the caller's very next
  // line is `if (!shareCompatibleClass(pool)) return omitOutcome(...)`, and that
  // branch had been unreachable precisely because this function always narrowed.
  // So a split pool stopped being a worse guess and started being a DROPPED
  // LINE, which is a bigger regression than the one the majority rule fixed.
  const seedL1 = candidates.find((c) => c.classL1)?.classL1 ?? null;
  const dominantL1 = dominantClassAmong(candidates, (c) => c.classL1) ?? seedL1;
  if (dominantL1) {
    const same = candidates.filter((c) => !c.classL1 || c.classL1 === dominantL1);
    // Never shrink below the two-peer commodity signal on a class guess alone,
    // the same floor the L2 pass keeps.
    return restrictToDominantClassL2(same.length >= 2 ? same : candidates);
  }

  const seedClass = candidates.find((c) => c.productClass)?.productClass ?? null;
  const dominantClass =
    dominantClassAmong(candidates, (c) => c.productClass) ?? seedClass;
  if (dominantClass) {
    const same = candidates.filter(
      (c) => !c.productClass || c.productClass === dominantClass,
    );
    return restrictToDominantClassL2(same.length >= 2 ? same : candidates);
  }

  return restrictToDominantClassL2(candidates);
}

function assumptionReasonFor(query: string): BasketAssumption["reason"] {
  const tokens = tokenizeNormalized(normalizeEmbedInput(query));
  if (
    (tokens.length === 1 && tokens[0] === "חלב") ||
    query.includes("תבנית") ||
    (tokens.includes("שמן") && !tokens.includes("אמבט")) ||
    tokens.includes("עוף")
  ) {
    return "generic_variant_default";
  }
  return "commodity_best_effort";
}

function assumptionMessage(query: string, selectedName: string): string {
  return `Assumed "${selectedName}" for "${query}".`;
}

function omitOutcome(
  item: ResolvedItem,
  input: BasketItemInput,
  message?: string,
): FastResolutionOutcome {
  const query = input.query?.trim() ?? null;
  const assumption: BasketAssumption = {
    itemIndex: item.index,
    query,
    selectedProductId: null,
    selectedName: null,
    reason: "unsafe_line_omitted",
    message:
      message ??
      `No safe locally priced match for "${query ?? item.name ?? `item ${item.index + 1}`}"; omitted from basket.`,
  };
  return {
    kind: "omitted",
    item: {
      ...item,
      productId: null,
      name: query ?? item.name,
      resolvedBy: "unresolved",
      resolutionStatus: "unresolved",
      lowConfidence: true,
      confidence: null,
    },
    assumption,
  };
}

/**
 * Pack tolerance for regrouping after an availability upgrade.
 *
 * Looser than the basket's own DEFAULT_PACK_TOLERANCE (0.15) because this is a
 * REGROUPING around a peer that has already passed every identity gate, not a
 * decision about what the line is. 0.5 is `packSizesCompatible`'s own default.
 *
 * Chosen by measurement, not derived: at 0.15 the benchmark ran 83.0%/97.0%, at
 * 0.5 it runs 84.0%/96.0%, and only the looser value keeps resolutionAccuracy at
 * its baseline. Both fix the beef line; the tight value cost two lines
 * (חומוס, אבקת כביסה) that resolve to the right product but fall under their
 * availability floor once the regrouped set shrinks.
 */
const REBUILD_PACK_TOLERANCE = 0.5;
const REBUILD_MAX_EQUIVALENTS = 5;

function selectOutcome(
  item: ResolvedItem,
  input: BasketItemInput,
  chosen: BasketCandidate,
  reasonOverride?: BasketAssumption["reason"],
  equivalentsOverride?: BasketCandidate[],
): FastResolutionOutcome {
  const purchase = resolvePurchaseQty({
    packQty: input.packQty,
    amount: input.amount,
    unit: input.unit,
    productSizeQty: chosen.sizeQty,
    productSizeUnit: chosen.sizeUnit,
    productName: chosen.name,
    pieceCount: chosen.pieceCount,
  });

  // Preserve requested physical amount: amount+unit stays on the line metadata.
  const amount = input.amount ?? item.amount;
  const unit = input.unit ?? item.unit;
  const query = input.query?.trim() ?? "";

  assertPurchaseQtyPreservesRequest(input, purchase);

  const assumption: BasketAssumption = {
    itemIndex: item.index,
    query: query || null,
    selectedProductId: chosen.productId,
    selectedName: chosen.name,
    reason: reasonOverride ?? assumptionReasonFor(query),
    message: assumptionMessage(query || chosen.name, chosen.name),
  };

  return {
    kind: "selected",
    item: {
      ...item,
      productId: chosen.productId,
      name: chosen.name,
      qty: purchase.qty,
      qtyMode: purchase.mode,
      amount,
      unit,
      resolvedBy: "query",
      resolutionStatus: "resolved",
      lowConfidence: false,
      confidence: chosen.score,
      // Swapping the primary invalidates an equivalence set that was built around
      // the OLD one. `...item` above would carry it over: a "בשר טחון" line
      // upgraded onto a beef primary kept peers grouped around a different SKU,
      // and pricing then picked ₪159.60 of Beyond Meat from the stale list while
      // ₪44.90 beef sat on the same shelf. Rebuilt by the caller when it swaps.
      ...(equivalentsOverride ? { equivalents: equivalentsOverride } : {}),
    },
    assumption,
  };
}

function filterPool(
  item: ResolvedItem,
  query: string,
  profile: QueryProfile,
): BasketCandidate[] {
  const base = filterSafeCandidates({
    query,
    profile,
    candidates: item.candidates,
  }).filter((c) => !candidateLooksVectorOnly(c));

  // Belt-and-suspenders: same staple rejectors used on commodity/equivalence paths.
  // Use rejectUnsafe* (not raw token checks) so explicit asks like "שניצל עוף"
  // and "חלב מרוכז" still keep their specialty forms.
  const withoutUnsafeStaples = base.filter(
    (c) =>
      !rejectUnsafeChickenName(query, c.name) &&
      !rejectUnsafePlainMilkName(query, c.name) &&
      !rejectUnsafePlainYogurtName(query, c.name, c.preparation),
  );

  const anchored = withoutUnsafeStaples.filter(
    (c) => !query || queryHeadAnchored(query, c.name),
  );
  const headAnchored = anchored.length > 0 ? anchored : withoutUnsafeStaples;

  // Derived products (rice paper for rice, bread crumbs for bread) are already
  // hard-rejected by isStapleIncompatible. This is the graceful layer for the
  // reverse case: if a query's ONLY matches are derived forms, rank them last
  // rather than dropping the line entirely.
  return preferDirectForm(query, headAnchored);
}

/**
 * How much better-carried a peer must be before it displaces the name-score
 * winner on a basket line.
 *
 * Resolution ranks on name-match score, and score is a float that essentially
 * never ties, so the store-coverage tiebreaker in `rankSafeCandidatesForFast`
 * could never fire. On the live catalog that produced answers nobody would pick:
 * `חלב 3%` resolved to a milk in 1 of 159 nearby stores while an equally valid
 * one sat in 73; `לחם אחיד` took a 7-store SKU over a 41-store SKU with the SAME
 * NAME (the catalog holds 7,373 duplicate-name product rows, fragmenting
 * availability); `ביצים L` landed on a SKU carried by ZERO nearby stores while
 * `ביצים L רגילות 12 יח` sits in 102.
 *
 * A 3x ratio is the "not marginal" line: it separates those cases from ordinary
 * jitter between two widely-stocked SKUs (700 vs 780 stores), where the better
 * name match should still win. The absolute floor stops a 2-store SKU from
 * displacing a 1-store SKU on a technicality when nothing is really available.
 */
const AVAILABILITY_UPGRADE_MIN_RATIO = 3;
const AVAILABILITY_UPGRADE_MIN_STORES = 3;

/**
 * Chain breadth was tried here as a second way to qualify a peer, and measured
 * WORSE: 89% to 82% resolution accuracy on the benchmark.
 *
 * The reasoning was sound — a chain's private label lives in one chain by
 * definition, so its store count can never be 3x a national brand's, and several
 * remaining failures were private labels. The implementation is what broke: any
 * peer spanning two more chains qualified on being carried by a single store
 * more, which swapped good lines onto thin multi-chain SKUs (`טונה בודד סאן
 * רויאל`, 2 of 149 branches). A breadth rule needs its own floor, not the
 * primary's count plus one. Left as a note rather than a knob, since a knob at
 * the wrong setting is how this cost seven points.
 */
function nearbyCoverage(
  candidate: BasketCandidate,
  availability: Map<string, CandidateAvailability>,
): number {
  return availability.get(candidate.productId)?.pricedStoreCount ?? 0;
}


/**
 * A peer carried by materially more nearby stores than the resolved primary.
 *
 * Specificity is enforced with `queryTokensSatisfied` rather than the ontology's
 * `brand` attribute, because the ontology does not know most catalog brands —
 * `חמאה לה גאל` extracts NO attributes at all, so an attribute-based test would
 * happily swap Le Gall for whichever butter is most widely stocked. Requiring
 * every query token to appear in the peer's name pins the shopper's own words:
 * a bare `חמאה` line may move to any butter, `חמאה לה גאל` only ever to another
 * Le Gall, and `קוקה קולה 1.5 ליטר` only to another 1.5L Coke.
 *
 * The pool is already safety-filtered (class, pack, percentage, derived-form,
 * staple traps) by `filterPool`, so anything reaching here is a legitimate
 * answer to the line — the choice among them is purely which one shoppers can
 * actually buy nearby.
 */
function betterCoveredPeer(
  primary: BasketCandidate | null,
  pool: BasketCandidate[],
  availability: Map<string, CandidateAvailability>,
  queryText: string,
): BasketCandidate | null {
  const queryTokens = tokenizeNormalized(normalizeEmbedInput(queryText));
  if (queryTokens.length === 0) return null;

  const specific = pool.filter((c) => queryTokensSatisfied(queryTokens, c.name));
  if (specific.length === 0) return null;

  const primaryCoverage = primary ? nearbyCoverage(primary, availability) : 0;
  const threshold = Math.max(
    AVAILABILITY_UPGRADE_MIN_STORES,
    primaryCoverage * AVAILABILITY_UPGRADE_MIN_RATIO,
  );

  let best: { candidate: BasketCandidate; coverage: number } | null = null;
  for (const candidate of specific) {
    if (primary && candidate.productId === primary.productId) continue;
    const coverage = nearbyCoverage(candidate, availability);
    if (coverage < threshold) continue;
    // Among qualifying peers take the widest coverage, then the better name
    // score, so the swap is deterministic.
    if (
      !best ||
      coverage > best.coverage ||
      (coverage === best.coverage && candidate.score > best.candidate.score)
    ) {
      best = { candidate, coverage };
    }
  }
  return best?.candidate ?? null;
}

/** True when an already-resolved primary fails hard staple/safety filters. */
function lockedPrimaryIsUnsafe(
  item: ResolvedItem,
  query: string,
  profile: QueryProfile,
): boolean {
  if (!item.productId || !item.name) return false;
  const locked =
    item.candidates.find((c) => c.productId === item.productId) ??
    ({
      productId: item.productId,
      name: item.name,
      score: item.confidence ?? 0,
      matchedVia: "product" as const,
      sizeQty: null,
      sizeUnit: null,
      pieceCount: null,
      hasPrice: true,
      hasLocalPrice: true,
      productClass: null,
      classL1: null,
      classL2: null,
      classL3: null,
      variant: "regular",
      brandExtracted: null,
      intentTier: 1,
    } satisfies BasketCandidate);
  return (
    filterSafeCandidates({ query, profile, candidates: [locked] }).length === 0 ||
    rejectUnsafeChickenName(query, item.name) ||
    rejectUnsafePlainMilkName(query, item.name) ||
    rejectUnsafePlainYogurtName(query, item.name)
  );
}

/**
 * Move an already-resolved line onto a materially better-stocked peer, or return
 * null to leave it alone.
 *
 * Never fires for a line the shopper pinned by `product_id` / `gtin`: those carry
 * `resolvedBy` of "product_id"/"gtin" and are an exact instruction, not a guess.
 */
function upgradeResolvedLine(
  item: ResolvedItem,
  input: BasketItemInput,
  query: string,
  profile: QueryProfile,
  availability: Map<string, CandidateAvailability>,
): FastResolutionOutcome | null {
  if (item.resolvedBy !== "query") return null;
  if (!query) return null;

  const pool = restrictToDominantClass(filterPool(item, query, profile));
  if (pool.length === 0) return null;

  const primary = item.candidates.find((c) => c.productId === item.productId) ?? null;
  const peer = betterCoveredPeer(primary, pool, availability, query);
  if (!peer) return null;

  // Route through selectOutcome so purchase qty is recomputed against the new
  // pack size and the swap is reported as an assumption rather than silently.
  // Rebuild the equivalence set around the peer we just moved to, so per-chain
  // pricing groups against the SKU this line now names.
  const requestedAmount =
    input.amount != null && input.unit ? { quantity: input.amount, unit: input.unit } : null;
  const rebuilt = buildCommodityEquivalents(
    peer,
    pool,
    query,
    REBUILD_MAX_EQUIVALENTS,
    REBUILD_PACK_TOLERANCE,
    requestedAmount,
  );
  return selectOutcome(
    item,
    input,
    peer,
    "availability_upgrade",
    rebuilt.length >= 2 ? rebuilt : [peer],
  );
}

function resolveFastOutcome(
  item: ResolvedItem,
  input: BasketItemInput,
  availability: Map<string, CandidateAvailability>,
  ontology: OntologySnapshot | null,
): FastResolutionOutcome {
  const query = input.query?.trim() ?? "";
  const profile = buildProfileForFast(input, ontology);

  // Even a "resolved" primary can be an organ/specialty/personal-care trap that
  // slipped through commodity auto-resolve. Re-run the safe pool instead.
  if (isSafelyPricable(item) && !lockedPrimaryIsUnsafe(item, query, profile)) {
    // A line resolved on name score alone can still be a SKU almost nobody
    // nearby stocks. Availability used to be consulted ONLY for lines arriving
    // unresolved, so these were never checked — the largest single source of
    // "cheapest store" answers built on products the shopper cannot buy.
    const upgraded = upgradeResolvedLine(item, input, query, profile, availability);
    if (upgraded) return upgraded;
    return { kind: "selected", item, assumption: null };
  }

  const pool = restrictToDominantClass(filterPool(item, query, profile));

  if (pool.length === 0) {
    return omitOutcome(item, input);
  }

  if (!shareCompatibleClass(pool)) {
    return omitOutcome(
      item,
      input,
      `Ambiguous classes for "${query || item.name}"; omitted rather than guessing.`,
    );
  }

  const tokens = tokenizeNormalized(normalizeEmbedInput(query));
  const ranked = rankSafeCandidatesForFast(pool, availability, profile, {
    preferCanola: tokens.includes("שמן"),
    preferPlainMilk: tokens.length === 1 && tokens[0] === "חלב",
    preferFreshChicken: tokens.includes("עוף"),
  });
  // Same availability upgrade the resolved path gets: `rankSafeCandidatesForFast`
  // treats local stock as a boolean (≥1 store) and only reaches its coverage
  // tiebreaker after `score`, which never ties, so a 1-store SKU still wins there.
  const topRanked = ranked[0]!;
  const chosen = betterCoveredPeer(topRanked, ranked, availability, query) ?? topRanked;

  if (!isEligibleForFastBestEffortCandidate(chosen, availability)) {
    return omitOutcome(item, input);
  }

  if (!hasLocalAvailability(chosen, availability)) {
    return omitOutcome(
      item,
      input,
      `No local price for a safe match of "${query || item.name}"; omitted from basket.`,
    );
  }

  return selectOutcome(item, input, chosen);
}

/**
 * Convert unresolved / needs_confirmation lines into selected-or-omitted outcomes.
 * Fast mode never asks; strict confirmation branching happens in optimize.ts.
 */
export function applyFastResolutionPolicy(
  items: BasketItemInput[],
  resolvedItems: ResolvedItem[],
  availability: Map<string, CandidateAvailability>,
  ontology: OntologySnapshot | null = null,
): FastResolutionPolicyResult {
  const assumptions: BasketAssumption[] = [];
  const out: ResolvedItem[] = [];

  for (const item of resolvedItems) {
    const input = items[item.index] ?? {};
    const outcome = resolveFastOutcome(item, input, availability, ontology);
    switch (outcome.kind) {
      case "selected": {
        out.push(outcome.item);
        if (outcome.assumption) assumptions.push(outcome.assumption);
        break;
      }
      case "omitted": {
        out.push(outcome.item);
        assumptions.push(outcome.assumption);
        break;
      }
      default: {
        const exhaustive: never = outcome;
        throw new Error(`unhandled fast resolution outcome: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return { items: out, assumptions };
}
