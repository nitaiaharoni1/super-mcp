import type { BasketItemStatus, BasketLine, BasketResponseDetail } from "../basket/types.js";
import { toSummaryAssumptions, toSummaryItems } from "../basket/compactResult.js";
import type { DeliveryOptimizeCompleteResult, DeliveryPlan } from "./types.js";

/**
 * Upper bound on priced lines echoed back for one plan at summary detail.
 *
 * Mirrors the physical surface's SUMMARY_MAX_PLAN_LINES for the same reason: the
 * kept plan's `lines` array grows with basket size, and the schema allows 50
 * items. 25 is above any realistic weekly list, so in practice nothing is
 * truncated — it only stops a pathological request returning an unbounded array.
 * Truncation is never silent: `linesTruncated` is set and `pricedLines` keeps
 * the true count.
 */
export const DELIVERY_SUMMARY_MAX_PLAN_LINES = 25;

/**
 * Strip per-line fields that identify a row in our database rather than let a
 * shopper act on it.
 *
 * `listingId` is an internal id no caller can use, `itemCode` is the barcode the
 * `link` already encodes, and `originalProductId` is the UUID of the pre-
 * substitution product whose name is already on the matching `items[]` entry.
 * Measured across 12 storefronts they cost 5.0KB, 2.6KB and 5.7KB.
 *
 * `substitutionReason` deliberately SURVIVES here, where the physical surface's
 * `toSummaryLines` drops it. On the online surface it is the only field that
 * separates `chain_equivalent` (same product, this chain's brand) from
 * `class_fallback` (nothing matched the name, so this was picked on category
 * alone — "worth confirming"). That distinction is what lets an agent notice it
 * is about to quote carrot juice for coconut water, and it is not derivable
 * from `substituted: true`. It is affordable now only because summary keeps
 * lines for the recommended storefronts alone: 15.6KB across twelve plans, and
 * ~1.3KB across one.
 */
function toSummaryLines(lines: BasketLine[]): BasketLine[] {
  return lines.map((line) => ({
    ...line,
    listingId: "",
    itemCode: "",
    originalProductId: null,
  }));
}

/**
 * Keep the line breakdown for the storefronts the answer actually points at, and
 * strip it from the rest.
 *
 * `plans` was 84% of a 122,889-byte reply to a twelve-line basket, and the
 * `lines` arrays inside it were 66.5% on their own — for twelve storefronts when
 * the three recommendation fields between them named one. Four of those twelve
 * shipped a full breakdown for a basket they could not sell at all: Wolt venues
 * that priced two or three of twelve lines and sat under their minimum.
 *
 * What survives on a stripped plan is every scalar — totals, fees, terms,
 * coverage, `pricedLines` — so ranking, comparison and the "add ₪82 and this
 * becomes orderable" judgement are all still answerable from summary. Only the
 * per-item detail goes, and `pricedLines` against an empty `lines` array says so
 * without a flag. `standard` and `debug` return everything.
 */
function trimPlanLines(
  plans: DeliveryPlan[],
  keepSlugs: ReadonlySet<string>,
): DeliveryPlan[] {
  return plans.map((plan) => {
    // `missingItems` goes with the lines, and for the same reason. It names the
    // products a storefront could not fill, at full identity — productId, name,
    // reason, and a same-family alternative — which is worth its bytes for a
    // storefront the shopper might order from and not for one they will not.
    // 98% of it (7.3KB of 7.4KB across 45 entries) sat on stripped plans, and
    // `pricedLines` against `requestedLines` already states the count.
    if (!keepSlugs.has(plan.serviceSlug)) return { ...plan, lines: [], missingItems: [] };
    const kept = toSummaryLines(plan.lines.slice(0, DELIVERY_SUMMARY_MAX_PLAN_LINES));
    return plan.lines.length > kept.length
      ? { ...plan, lines: kept, linesTruncated: true }
      : { ...plan, lines: kept };
  });
}

/**
 * Drop the `detail` sentence where it only restates `reason` in prose.
 *
 * Every reason but one is given a CONSTANT string at the call site — an address
 * outside the delivery area always reads "this address is not in the published
 * delivery area" — so on a Tel Aviv basket the same 49 characters shipped 29
 * times to say what the `reason` enum said for free.
 *
 * `below_minimum_order` keeps its sentence: it is the only one built per
 * storefront, and it is the only place the storefront's actual minimum appears
 * as a figure. `UnavailableStorefront` carries `amountToMinimum` but not
 * `minimumOrder`, so dropping the text would lose it.
 */
function trimUnavailableDetail(
  stores: DeliveryOptimizeCompleteResult["unavailableStores"],
): DeliveryOptimizeCompleteResult["unavailableStores"] {
  return stores.map((store) =>
    store.reason === "below_minimum_order" ? store : { ...store, detail: null },
  );
}

/**
 * Project a complete delivery result down to the requested detail level.
 *
 * `optimize_delivery` had no such control while `optimize_basket` has had one
 * since it hit the same wall. The consequence was not a slow tool but an
 * unusable one: a client that cannot inline a 38k-token tool result spills it to
 * a file and greps it back apart one field at a time, which is several model
 * round-trips of latency before a single number reaches the shopper.
 */
export function projectDeliveryResult(
  result: DeliveryOptimizeCompleteResult,
  detail: BasketResponseDetail,
): DeliveryOptimizeCompleteResult {
  if (detail === "debug" || detail === "standard") return result;

  // The recommendation fields carry totals only and name storefronts by slug, so
  // these are the plans a caller has been told to look up. Usually one: on the
  // measured basket all three named the same storefront.
  const keepSlugs = new Set(
    [result.cheapestDelivered, result.bestVerifiedTerms, result.bestSingleOrder]
      .filter((plan): plan is NonNullable<typeof plan> => plan != null)
      .map((plan) => plan.serviceSlug),
  );
  // All three recommendations are null when nothing is orderable — every
  // storefront sat under its minimum. `plans` is not empty in that case, it is
  // the whole point of the answer ("add ₪82 and this becomes your cheapest
  // option"), and keying purely off the recommendations would strip the lines
  // from ALL of them and leave the shopper unable to see what they would get for
  // topping up. `rankPlansForResponse` puts orderable plans first and ranks the
  // rest, so plans[0] is the best one on offer either way.
  const firstPlan = result.plans[0];
  if (keepSlugs.size === 0 && firstPlan) keepSlugs.add(firstPlan.serviceSlug);

  // Narrowed the same way the physical surface narrows at its own projection
  // boundary: the declared type is the union because the RESULT can carry either
  // shape, but only a freshly built, unprojected result ever reaches here, and
  // that one always carries full statuses.
  const itemStatuses = result.items as BasketItemStatus[];

  return {
    ...result,
    plans: trimPlanLines(result.plans, keepSlugs),
    unavailableStores: trimUnavailableDetail(result.unavailableStores),
    items: toSummaryItems(itemStatuses),
    assumptions: toSummaryAssumptions(result.assumptions),
  };
}
