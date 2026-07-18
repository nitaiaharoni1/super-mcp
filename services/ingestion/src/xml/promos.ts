import { normalizePromoMechanic, type RawPromoRecord } from "@super-mcp/shared";
import {
  asArray,
  num,
  parseIlDate,
  PROMO_END_FALLBACK,
  PROMO_START_FALLBACK,
  text,
} from "./helpers.js";
import { feedParser } from "./parser.js";

/**
 * Collect promo ItemCodes from Cerberus (`PromotionItems > Item`) and
 * Shufersal/Carrefour (`Groups > Group > PromotionItems > PromotionItem`).
 */
export function collectPromoItemCodes(promo: Record<string, unknown>): string[] {
  const codes: string[] = [];

  const pushCode = (value: unknown): void => {
    for (const raw of asArray(value)) {
      const code = text(raw);
      // All-zero placeholders mean "basket / no SKU" — skip for promotion_item.
      if (!code || /^0+$/.test(code)) continue;
      codes.push(code);
    }
  };

  const visit = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if ("ItemCode" in o) pushCode(o.ItemCode);
    for (const key of [
      "PromotionItems",
      "PromotionItem",
      "Item",
      "Items",
      "Groups",
      "Group",
    ] as const) {
      if (key in o) visit(o[key]);
    }
  };

  pushCode(promo.ItemCode);
  visit(promo.PromotionItems);
  visit(promo.PromotionItem);
  visit(promo.Groups);
  return [...new Set(codes)];
}

function promoClubId(promo: Record<string, unknown>): string | null {
  const direct = text(promo.ClubId ?? promo.ClubID);
  if (direct) {
    // Shufersal: "0 - כלל הלקוחות"
    return direct.split(/\s[-–]/)[0]!.trim() || direct;
  }
  const clubs = promo.Clubs as Record<string, unknown> | Record<string, unknown>[] | undefined;
  for (const node of asArray(clubs)) {
    const id = text(node.ClubId ?? node.ClubID);
    if (id) return id.split(/\s[-–]/)[0]!.trim() || id;
  }
  return null;
}

/** First Group / PromotionItem fields for PublishPrice-style nested promos. */
function firstPromoNestedFields(promo: Record<string, unknown>): {
  minQty?: unknown;
  maxQty?: unknown;
  discountRate?: unknown;
  discountType?: unknown;
  minPurchaseAmount?: unknown;
  rewardType?: unknown;
  discountedPrice?: unknown;
} {
  const groups = asArray(
    (promo.Groups as Record<string, unknown> | undefined)?.Group ?? promo.Group,
  );
  const group = groups.find((g) => g && typeof g === "object") as
    | Record<string, unknown>
    | undefined;

  let item: Record<string, unknown> | undefined;
  const itemContainers = [
    ...asArray(group?.PromotionItems),
    ...asArray(promo.PromotionItems),
    ...asArray(promo.PromotionItem),
  ];
  for (const container of itemContainers) {
    if (!container || typeof container !== "object") continue;
    const c = container as Record<string, unknown>;
    const candidates = asArray(c.PromotionItem ?? c.Item ?? c);
    for (const cand of candidates) {
      if (cand && typeof cand === "object" && !Array.isArray(cand) && "ItemCode" in cand) {
        item = cand as Record<string, unknown>;
        break;
      }
    }
    if (item) break;
  }

  return {
    minQty: item?.MinQty,
    maxQty: item?.MaxQty,
    discountRate: item?.DiscountRate,
    discountType: group?.DiscountType,
    minPurchaseAmount: group?.MinPurchaseAmount,
    rewardType: item?.RewardType,
    discountedPrice: item?.DiscountedPrice,
  };
}

export function parsePromosXml(
  xml: string,
  chainId: string,
  storeId: string,
  fallbackTs?: Date,
): RawPromoRecord[] {
  const doc = feedParser.parse(xml);
  const root = (doc.Root ?? doc.Promotions ?? doc.Chain ?? doc) as Record<string, unknown>;
  const resolvedChain = text(root.ChainId ?? root.ChainID) || chainId;
  const resolvedStore = text(root.StoreId ?? root.StoreID) || storeId;
  const promosNode = root.Promotions as Record<string, unknown> | undefined;
  const promos = asArray(root.Promotion ?? promosNode?.Promotion);
  const out: RawPromoRecord[] = [];

  for (const promo of promos) {
    const p = promo as Record<string, unknown>;
    const promoId = text(p.PromotionId ?? p.PromotionID);
    if (!promoId) continue;
    const description = text(p.PromotionDescription ?? p.Description);
    const itemCodes = collectPromoItemCodes(p);
    const clubId = promoClubId(p);
    const nested = firstPromoNestedFields(p);

    const mechanic = normalizePromoMechanic({
      description,
      minQty: num(p.MinQty ?? nested.minQty),
      maxQty: num(p.MaxQty ?? nested.maxQty),
      discountRate: num(p.DiscountRate ?? nested.discountRate),
      discountType: text(p.DiscountType ?? nested.discountType) || undefined,
      minPurchaseAmount: num(
        p.MinPurchaseAmnt ?? p.MinPurchaseAmount ?? nested.minPurchaseAmount,
      ),
      rewardType: text(p.RewardType ?? nested.rewardType) || undefined,
      discountedPrice: num(
        p.DiscountedPrice ?? p.PromotionPrice ?? nested.discountedPrice,
      ),
      clubId,
      raw: p,
    });

    const startDate =
      text(p.PromotionStartDate) || text(p.PromotionStartDateTime) || "";
    const endDate = text(p.PromotionEndDate) || text(p.PromotionEndDateTime) || "";
    const startTs =
      parseIlDate(startDate, text(p.PromotionStartHour) || undefined) ??
      PROMO_START_FALLBACK;
    const endTs =
      parseIlDate(endDate, text(p.PromotionEndHour) || undefined) ?? PROMO_END_FALLBACK;

    out.push({
      kind: "promo",
      chainId: resolvedChain,
      storeId: resolvedStore,
      promoId,
      description: description || promoId,
      mechanic,
      itemCodes,
      startTs,
      endTs: endTs.getTime() < startTs.getTime() ? PROMO_END_FALLBACK : endTs,
      clubOnly: Boolean(clubId && clubId !== "0"),
      ts: fallbackTs ?? new Date(),
      raw: p,
    });
  }
  return out;
}
