import { computeUnitPrice, isShoppableStoreKind, resolvePurchaseQty } from "@super-mcp/shared";
import { listStores } from "../stores/index.js";
import { getActivePromotionsForListings, pickBestPromoForStore } from "../promotions/index.js";
import { buildProductLink } from "../productLinks/index.js";
import {
  brandFamilyEquivalentReason,
  chainEquivalentReason,
  fallbackCandidate,
  isChainEquivalentSubstitution,
  isLineSubstituted,
  substitutionReasonForLine,
} from "./substitutions.js";
import type {
  BasketCandidate,
  BasketLine,
  BasketMissingItem,
  BasketStoreResult,
  DistanceAccuracy,
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "./types.js";

/**
 * ₪ per 100 g / 100 ml / piece for one pack of the priced SKU.
 *
 * Line totals alone cannot be compared across stores once equivalents are in
 * play: a 100g butter at ₪11.90 beats a 125g at ₪12.10 on pack price while being
 * 23% more expensive per gram. Exposing the normalized figure lets callers (and
 * the substitution audit) see which is genuinely cheaper.
 */
function normalizedUnitPriceFor(
  packPrice: number,
  sizeQty: number | null,
  sizeUnit: string | null,
  isWeighted: boolean | null | undefined,
): Pick<BasketLine, "normalizedUnitPrice" | "normalizedUnitBasis"> {
  if (sizeQty == null || !sizeUnit) {
    return { normalizedUnitPrice: null, normalizedUnitBasis: null };
  }
  const { measure, pricePerCanonical } = computeUnitPrice(
    packPrice,
    sizeQty,
    sizeUnit,
    isWeighted ?? undefined,
  );
  if (pricePerCanonical == null || measure.unparseable) {
    return { normalizedUnitPrice: null, normalizedUnitBasis: null };
  }
  const basis: BasketLine["normalizedUnitBasis"] =
    measure.unit === "g" ? "per_100g" : measure.unit === "ml" ? "per_100ml" : "per_piece";
  return {
    normalizedUnitPrice: Math.round(pricePerCanonical * 10000) / 10000,
    normalizedUnitBasis: basis,
  };
}

function tryOrderForItem(item: ResolvedItem): BasketCandidate[] {
  if (!item.productId) return [];
  const primary =
    item.candidates.find((c) => c.productId === item.productId) ?? fallbackCandidate(item);
  // Equivalents are the ONLY permitted fallback: same gated class/unit/pack.
  // Un-gated shortlist members must NEVER appear here (that was the old wrong-
  // substitution bug); resolution has already established the one safe SKU.
  return [primary, ...(item.equivalents ?? []).filter((c) => c.productId !== item.productId)];
}

/** First locally priced alternative (larger pack etc.) when no auto peer matches. */
function findPricedAlternative(
  item: ResolvedItem,
  byProduct: Map<string, ListingRow[]> | undefined,
  priceByListingAndStore: Map<string, StorePriceRow>,
  storeId: string,
): { candidate: BasketCandidate; listing: ListingRow; priceRow: StorePriceRow } | null {
  for (const candidate of item.alternatives ?? []) {
    const listings = byProduct?.get(candidate.productId) ?? [];
    for (const listing of listings) {
      const priceRow = priceByListingAndStore.get(`${listing.id}:${storeId}`);
      if (priceRow) return { candidate, listing, priceRow };
    }
  }
  return null;
}

export function priceStoreBasket(
  store: Awaited<ReturnType<typeof listStores>>[number],
  resolvedItems: ResolvedItem[],
  listingByChainAndProduct: Map<string, Map<string, ListingRow[]>>,
  priceByListingAndStore: Map<string, StorePriceRow>,
  promoMap: Awaited<ReturnType<typeof getActivePromotionsForListings>>,
): BasketStoreResult | null {
  const lines: BasketLine[] = [];
  const missingItems: BasketMissingItem[] = [];
  const byProduct = listingByChainAndProduct.get(store.chainId);
  let storeCurrency: string | null = null;

  for (const item of resolvedItems) {
    if (!item.productId) {
      missingItems.push({
        itemIndex: item.index,
        productId: null,
        name: item.name,
        reason: "product_not_found",
      });
      continue;
    }

    const tryOrder = tryOrderForItem(item);

    let matched: {
      candidate: BasketCandidate;
      listing: ListingRow;
      priceRow: StorePriceRow;
      qty: number;
      qtyMode: string;
    } | null = null;

    let sawListing = false;
    let matchedTotal = Infinity;
    let matchedValue: number | null = null;
    const primaryScore = tryOrder[0]?.score ?? 0;
    const primaryProductId = item.productId;

    for (const candidate of tryOrder) {
      // Don't silently swap to a much worse match (e.g. 6-pack mini pita for "פיתות 10").
      if (candidate.score + 0.2 < primaryScore) continue;
      const listings = byProduct?.get(candidate.productId) ?? [];
      if (listings.length === 0) continue;
      sawListing = true;
      let picked: { listing: ListingRow; priceRow: StorePriceRow } | null = null;
      for (const l of listings) {
        const pr = priceByListingAndStore.get(`${l.id}:${store.id}`);
        if (pr) {
          picked = { listing: l, priceRow: pr };
          break;
        }
      }
      if (!picked) continue;
      const listing = picked.listing;
      const priceRow = picked.priceRow;
      const purchase = resolvePurchaseQty({
        packQty: item.amount == null ? item.qty : undefined,
        amount: item.amount ?? undefined,
        unit: item.unit ?? undefined,
        productSizeQty: candidate.sizeQty,
        productSizeUnit: candidate.sizeUnit,
        productName: candidate.name || listing.name,
        pieceCount: listing.piece_count ?? candidate.pieceCount,
        isWeighted: listing.is_weighted ?? undefined,
        saleBasis: listing.sale_basis ?? undefined,
      });
      const candidateTotal = Number(priceRow.price) * purchase.qty;
      // Compare commodity peers on VALUE, not shelf price. Equivalence allows a
      // small size spread, and line totals are pack prices, so "cheapest" would
      // otherwise mean "smallest": a 100g butter at ₪11.90 beats a 125g at ₪12.10
      // while costing 23% more per gram. Falls back to the pack total whenever
      // either side has no usable size, so behaviour is unchanged for those.
      const candidateValue = normalizedUnitPriceFor(
        Number(priceRow.price),
        candidate.sizeQty,
        candidate.sizeUnit,
        listing.is_weighted,
      ).normalizedUnitPrice;
      const isPrimary = candidate.productId === primaryProductId;
      // Exact / brand_family: prefer the pinned primary whenever stocked.
      // Commodity intent: minimize line total among approved peers (bare יין).
      if (item.intentMode !== "commodity" && isPrimary) {
        matched = {
          candidate,
          listing,
          priceRow,
          qty: purchase.qty,
          qtyMode: purchase.mode,
        };
        break;
      }
      // Prefer the better unit price when both sides expose a comparable size;
      // otherwise fall back to the pack total.
      const beatsBest =
        candidateValue != null && matchedValue != null
          ? candidateValue < matchedValue
          : candidateTotal < matchedTotal;
      if (beatsBest) {
        matched = {
          candidate,
          listing,
          priceRow,
          qty: purchase.qty,
          qtyMode: purchase.mode,
        };
        matchedTotal = candidateTotal;
        matchedValue = candidateValue;
      }
    }

    if (!matched) {
      const alt = findPricedAlternative(item, byProduct, priceByListingAndStore, store.id);
      if (alt) {
        missingItems.push({
          itemIndex: item.index,
          productId: item.productId,
          name: item.name,
          reason: "alternative_available",
          alternative: {
            productId: alt.candidate.productId,
            name: alt.candidate.name || alt.listing.name,
            sizeQty: alt.candidate.sizeQty,
            sizeUnit: alt.candidate.sizeUnit,
            pieceCount: alt.candidate.pieceCount,
          },
        });
        continue;
      }
      missingItems.push({
        itemIndex: item.index,
        productId: item.productId,
        name: item.name,
        reason: sawListing ? "no_price_data" : "not_carried_by_chain",
      });
      continue;
    }

    const listPrice = Number(matched.priceRow.price);
    if (storeCurrency === null) storeCurrency = matched.priceRow.currency;
    const promo = pickBestPromoForStore(
      promoMap.get(matched.listing.id),
      store.id,
      store.chainId,
      listPrice,
      matched.qty,
    );
    let lineTotal = Math.round(listPrice * matched.qty * 100) / 100;
    let promoApplied = false;
    let promoDescription: string | null = null;
    let clubOnly = false;

    if (promo) {
      lineTotal = Math.round(promo.effectiveTotal * 100) / 100;
      promoApplied = true;
      promoDescription = promo.candidate.description;
      clubOnly = promo.candidate.clubOnly;
    }

    // Line arithmetic invariant: never emit non-positive qty/total.
    if (!(matched.qty > 0) || !(lineTotal > 0)) {
      missingItems.push({
        itemIndex: item.index,
        productId: item.productId,
        name: item.name,
        reason: "no_price_data",
      });
      continue;
    }

    // When a promo changes the shelf arithmetic, metadata must be present.
    const shelfTotal = Math.round(listPrice * matched.qty * 100) / 100;
    if (lineTotal !== shelfTotal && !promoApplied) {
      missingItems.push({
        itemIndex: item.index,
        productId: item.productId,
        name: item.name,
        reason: "no_price_data",
      });
      continue;
    }

    const isChainEquivalent = isChainEquivalentSubstitution(item, matched.candidate.productId);
    const isBrandFamily =
      item.intentMode === "brand_family" &&
      isChainEquivalent &&
      matched.candidate.productId !== item.productId;
    const substituted = isChainEquivalent || isLineSubstituted(item, matched.candidate.productId);
    const primaryCand = item.candidates.find((c) => c.productId === item.productId);
    const primaryName = primaryCand?.name ?? item.name;
    const substitutionReason = isBrandFamily
      ? brandFamilyEquivalentReason(
          primaryName,
          matched.candidate.name || matched.listing.name,
          primaryCand?.sizeQty,
          matched.candidate.sizeQty,
        )
      : isChainEquivalent
        ? chainEquivalentReason(primaryName, matched.candidate.name || matched.listing.name)
        : substitutionReasonForLine(item, substituted);
    const originalProductId = isChainEquivalent
      ? item.productId
      : substituted
        ? (item.primaryProductId ?? item.productId)
        : null;
    lines.push({
      itemIndex: item.index,
      productId: matched.candidate.productId,
      name: matched.candidate.name || matched.listing.name,
      qty: matched.qty,
      qtyMode: matched.qtyMode,
      listingId: matched.listing.id,
      itemCode: matched.listing.item_code,
      unitPrice: listPrice,
      lineTotal,
      sizeQty: matched.candidate.sizeQty,
      sizeUnit: matched.candidate.sizeUnit,
      ...normalizedUnitPriceFor(
        listPrice,
        matched.candidate.sizeQty,
        matched.candidate.sizeUnit,
        matched.listing.is_weighted,
      ),
      promoApplied,
      promoDescription,
      clubOnly,
      substituted,
      substitutionReason,
      originalProductId,
      link: buildProductLink({
        chainId: store.chainId,
        gtin: matched.listing.gtin,
        // Chain's own listing name — best match for that chain's on-site search fallback.
        name: matched.listing.name,
      }).url,
      freshness: {
        sourceTs: matched.priceRow.source_ts,
        ingestedAt: matched.priceRow.ingested_at,
      },
    });
  }

  if (lines.length === 0) return null;

  const total = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
  const currency = storeCurrency ?? "ILS";

  return {
    storeId: store.id,
    storeName: store.name,
    chainId: store.chainId,
    chainName: store.chainName,
    city: store.city,
    address: store.address,
    // Keep the centroid-derived distance but label it, rather than nulling it.
    // Dropping it used to make whole chains unrankable (every Sharon Rami Levy
    // branch), which cost the shopper far more than a few km of imprecision.
    distanceKm: store.distanceKm,
    distanceAccuracy: distanceAccuracyForGeoSource(store.geoSource, store.distanceKm),
    storeKind: store.storeKind ?? null,
    currency,
    total,
    itemsFound: lines.length,
    itemsRequested: resolvedItems.length,
    lines,
    missingItems,
  };
}

/** Feed/address/overpass coords are branch-level; city_centroid/null are not. */
export function isBranchDistanceReliable(geoSource: string | null | undefined): boolean {
  return geoSource === "address" || geoSource === "feed" || geoSource === "overpass";
}

/** How much a store's distance can be trusted, given its coordinate provenance. */
export function distanceAccuracyForGeoSource(
  geoSource: string | null | undefined,
  distanceKm: number | null,
): DistanceAccuracy {
  if (distanceKm == null) return "unknown";
  if (isBranchDistanceReliable(geoSource)) return "branch";
  if (geoSource === "city_centroid") return "city";
  return "unknown";
}

/** True when this store is somewhere a shopper can actually go and buy. */
export function isShoppableStore(store: { storeKind?: string | null }): boolean {
  return isShoppableStoreKind((store.storeKind ?? null) as never);
}
