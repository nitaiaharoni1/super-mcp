import { query } from "@super-mcp/db";
import { AppError, resolvePurchaseQty } from "@super-mcp/shared";
import { getActiveOntology, searchProductsScored } from "../search/index.js";
import { mapPool } from "@super-mcp/shared";
import { hitToCandidate } from "./candidates.js";
import { resolveQueryItem } from "./resolveQuery.js";
import type {
  BasketItemInput,
  ResolvedItem,
  ResolveLocationScope,
} from "./types.js";

async function resolveOneItem(
  index: number,
  item: BasketItemInput,
  location?: ResolveLocationScope,
): Promise<ResolvedItem> {
  const hasQty = item.qty != null && Number.isFinite(item.qty) && item.qty > 0;
  const hasAmount = item.amount != null && Number.isFinite(item.amount) && item.amount > 0;
  if (!hasQty && !hasAmount) {
    throw new AppError("bad_request", `items[${index}] requires qty or amount`, 400);
  }
  if (hasAmount && !(item.unit && item.unit.trim())) {
    throw new AppError(
      "bad_request",
      `items[${index}] amount requires unit (kg, g, L, ml, unit, יח, …)`,
      400,
    );
  }

  const base = {
    index,
    amount: hasAmount ? item.amount! : null,
    unit: hasAmount ? item.unit!.trim() : null,
    primaryProductId: null as string | null,
    primaryName: null as string | null,
    substitution: null,
  };

  if (item.productId) {
    const res = await query<{
      id: string;
      name: string;
      size_qty: number | null;
      size_unit: string | null;
    }>(`SELECT id, name, size_qty, size_unit FROM product WHERE id = $1`, [item.productId]);
    const row = res.rows[0];
    if (!row) {
      return {
        ...base,
        qty: item.qty ?? item.amount ?? 1,
        qtyMode: "legacy_packs",
        productId: null,
        name: null,
        resolvedBy: "unresolved",
        confidence: null,
        lowConfidence: true,
        candidates: [],
      };
    }
    const purchase = resolvePurchaseQty({
      packQty: item.qty,
      amount: item.amount,
      unit: item.unit,
      productSizeQty: row.size_qty,
      productSizeUnit: row.size_unit,
      productName: row.name,
    });
    return {
      ...base,
      qty: purchase.qty,
      qtyMode: purchase.mode,
      productId: row.id,
      name: row.name,
      resolvedBy: "product_id",
      confidence: 1,
      lowConfidence: false,
      candidates: [
        {
          productId: row.id,
          name: row.name,
          score: 1,
          matchedVia: "product",
          sizeQty: row.size_qty,
          sizeUnit: row.size_unit,
          hasPrice: true,
          hasLocalPrice: true,
        },
      ],
    };
  }

  if (item.gtin) {
    const hits = await searchProductsScored({
      q: "",
      gtin: item.gtin,
      limit: 1,
      city: location?.city,
      near: location?.near,
      radiusKm: location?.radiusKm,
      storeIds: location?.storeIds,
      semanticExpand: false,
    });
    const hit = hits[0];
    if (!hit) {
      return {
        ...base,
        qty: item.qty ?? item.amount ?? 1,
        qtyMode: "legacy_packs",
        productId: null,
        name: null,
        resolvedBy: "unresolved",
        confidence: null,
        lowConfidence: true,
        candidates: [],
      };
    }
    const purchase = resolvePurchaseQty({
      packQty: item.qty,
      amount: item.amount,
      unit: item.unit,
      productSizeQty: hit.sizeQty,
      productSizeUnit: hit.sizeUnit,
      productName: hit.name,
    });
    return {
      ...base,
      qty: purchase.qty,
      qtyMode: purchase.mode,
      productId: hit.id,
      name: hit.name,
      resolvedBy: "gtin",
      confidence: 1,
      lowConfidence: false,
      candidates: [hitToCandidate(hit)],
    };
  }

  if (item.query) {
    const queryResult = await resolveQueryItem(
      item,
      { index, amount: base.amount, unit: base.unit },
      location,
      hasAmount,
    );
    return {
      ...base,
      ...queryResult,
    };
  }

  throw new AppError("bad_request", `items[${index}] must include one of product_id, gtin, or query`, 400);
}

/** Resolve all basket lines concurrently (bounded — search is DB-heavy). */
export async function resolveItems(
  items: BasketItemInput[],
  location?: ResolveLocationScope,
): Promise<ResolvedItem[]> {
  await getActiveOntology();
  return mapPool(items, 6, (item, index) => resolveOneItem(index, item, location));
}
