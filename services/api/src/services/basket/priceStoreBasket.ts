import { applyPromoToUnitPrice, resolvePurchaseQty } from "@super-mcp/shared";
import { listStores } from "../stores/index.js";
import { getActivePromotionsForListings, pickPromoForStore } from "../promotions/index.js";
import { buildProductLink } from "../productLinks/index.js";
import {
  fallbackCandidate,
  isLineSubstituted,
  substitutionReasonForLine,
} from "./substitutions.js";
import type {
  BasketCandidate,
  BasketLine,
  BasketMissingItem,
  BasketRecommendation,
  BasketStoreResult,
  ListingRow,
  ResolvedItem,
  StorePriceRow,
} from "./types.js";

function tryOrderForItem(item: ResolvedItem): BasketCandidate[] {
  if (!item.productId) return [];
  // Resolution has already established the one safe SKU. Pricing must not
  // substitute a merely plausible search candidate because a store lacks it.
  return [
    item.candidates.find((candidate) => candidate.productId === item.productId) ??
      fallbackCandidate(item),
  ];
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
    } | null = null;

    let sawListing = false;
    const primaryScore = tryOrder[0]?.score ?? 0;
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
        productName: candidate.name,
      });
      matched = { candidate, listing, priceRow, qty: purchase.qty };
      break;
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
    const promo = pickPromoForStore(promoMap.get(matched.listing.id), store.id, store.chainId);
    let lineTotal = Math.round(listPrice * matched.qty * 100) / 100;
    let promoApplied = false;
    let promoDescription: string | null = null;

    if (promo) {
      const applied = applyPromoToUnitPrice(listPrice, matched.qty, promo.mechanic);
      if (applied.applied && applied.effectiveTotal < listPrice * matched.qty) {
        lineTotal = Math.round(applied.effectiveTotal * 100) / 100;
        promoApplied = true;
        promoDescription = promo.description;
      }
    }

    const substituted = isLineSubstituted(item, matched.candidate.productId);
    lines.push({
      itemIndex: item.index,
      productId: matched.candidate.productId,
      name: matched.candidate.name || matched.listing.name,
      qty: matched.qty,
      listingId: matched.listing.id,
      itemCode: matched.listing.item_code,
      unitPrice: listPrice,
      lineTotal,
      promoApplied,
      promoDescription,
      substituted,
      substitutionReason: substitutionReasonForLine(item, substituted),
      originalProductId: substituted ? (item.primaryProductId ?? item.productId) : null,
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
    distanceKm: store.distanceKm,
    currency,
    total,
    itemsFound: lines.length,
    itemsRequested: resolvedItems.length,
    lines,
    missingItems,
  };
}

export function buildCheapestRecommendation(top: BasketStoreResult): BasketRecommendation {
  return {
    storeId: top.storeId,
    storeName: top.storeName,
    chainId: top.chainId,
    chainName: top.chainName,
    total: top.total,
    currency: top.currency,
    itemsFound: top.itemsFound,
    itemsRequested: top.itemsRequested,
    distanceKm: top.distanceKm,
    reason:
      top.missingItems.length === 0
        ? "Lowest total among nearby stores that carry the full basket (promos applied)."
        : `Lowest total among nearby stores; missing ${top.missingItems.length} of ${top.itemsRequested} items.`,
  };
}
