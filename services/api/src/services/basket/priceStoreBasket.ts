import { resolvePurchaseQty } from "@super-mcp/shared";
import { listStores } from "../stores/index.js";
import { getActivePromotionsForListings, pickBestPromoForStore } from "../promotions/index.js";
import { buildProductLink } from "../productLinks/index.js";
import {
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
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "./types.js";

function tryOrderForItem(item: ResolvedItem): BasketCandidate[] {
  if (!item.productId) return [];
  const primary =
    item.candidates.find((c) => c.productId === item.productId) ?? fallbackCandidate(item);
  // Equivalents are the ONLY permitted fallback: same gated class/unit/pack.
  // Un-gated shortlist members must NEVER appear here (that was the old wrong-
  // substitution bug); resolution has already established the one safe SKU.
  return [primary, ...(item.equivalents ?? []).filter((c) => c.productId !== item.productId)];
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
      // Prefer the confirmed/resolved primary whenever this store stocks it —
      // do not swap Coke→Crystal just because Crystal is cheaper. Only when the
      // primary has no listing/price here do we pick the cheapest equivalent.
      const isPrimary = candidate.productId === primaryProductId;
      if (isPrimary) {
        matched = {
          candidate,
          listing,
          priceRow,
          qty: purchase.qty,
          qtyMode: purchase.mode,
        };
        break;
      }
      const candidateTotal = Number(priceRow.price) * purchase.qty;
      if (candidateTotal < matchedTotal) {
        matched = {
          candidate,
          listing,
          priceRow,
          qty: purchase.qty,
          qtyMode: purchase.mode,
        };
        matchedTotal = candidateTotal;
      }
    }

    if (!matched) {
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

    if (promo) {
      lineTotal = Math.round(promo.effectiveTotal * 100) / 100;
      promoApplied = true;
      promoDescription = promo.candidate.description;
    }

    const isChainEquivalent = isChainEquivalentSubstitution(item, matched.candidate.productId);
    const substituted = isChainEquivalent || isLineSubstituted(item, matched.candidate.productId);
    const primaryName =
      item.candidates.find((c) => c.productId === item.productId)?.name ?? item.name;
    const substitutionReason = isChainEquivalent
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
      promoApplied,
      promoDescription,
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
    // City-centroid points are not branch addresses — don't expose a fake km.
    distanceKm: isBranchDistanceReliable(store.geoSource) ? store.distanceKm : null,
    currency,
    total,
    itemsFound: lines.length,
    itemsRequested: resolvedItems.length,
    lines,
    missingItems,
  };
}

/** Address/feed coords are branch-level; city_centroid/null are not. */
export function isBranchDistanceReliable(geoSource: string | null | undefined): boolean {
  return geoSource === "address" || geoSource === "feed";
}
