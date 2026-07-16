import type { FeedFile } from "@super-mcp/shared";
import { dateFromIlWallClock } from "../ilDate.js";

/** Classify Israeli transparency feed filenames into adapter kinds. */
export function classifyFeedFile(name: string): FeedFile["kind"] {
  const n = name.toLowerCase();
  if (n.includes("pricefull")) return "pricesfull";
  if (n.includes("promofull")) return "promosfull";
  if (n.startsWith("promo") || n.includes("promo")) return "promos";
  if (n.startsWith("price") || n.includes("price")) return "prices";
  if (n.includes("store")) return "stores";
  return "other";
}

/**
 * Extract store id + publish time from common Israeli feed filename shapes.
 *
 * - `PriceFull{chain}-{store}-{YYYYMMDDHHMI}.xml.gz` (Cerberus / Shufersal style)
 * - `PriceFull{chain}-{sub}-{store}-{YYYYMMDD}-{HHMMSS}.gz` (Carrefour / PublishPrice style)
 */
export function parseFeedFileMeta(
  fileName: string,
): { storeId?: string; publishedAt?: Date } {
  const base = fileName.replace(/\.(xml|gz)+$/i, "");
  const parts = base.split("-");

  // New: ...-{sub}-{store}-{YYYYMMDD}-{HHMMSS}
  if (parts.length >= 5) {
    const storeRaw = parts[parts.length - 3]!;
    const day = parts[parts.length - 2]!;
    const time = parts[parts.length - 1]!;
    if (/^\d+$/.test(storeRaw) && /^\d{8}$/.test(day)) {
      const hh = Number(time.slice(0, 2) || "00");
      const mm = Number(time.slice(2, 4) || "00");
      const ss = Number(time.slice(4, 6) || "00");
      return {
        storeId: String(parseInt(storeRaw, 10)).padStart(3, "0"),
        publishedAt: dateFromIlWallClock(
          Number(day.slice(0, 4)),
          Number(day.slice(4, 6)),
          Number(day.slice(6, 8)),
          hh,
          mm,
          ss,
        ),
      };
    }
  }

  // Classic: ...{chain13}-{store}-{YYYYMMDDHHMI...}
  const m = fileName.match(/(\d{13})-(\d+)-(\d{10,14})/i);
  if (!m) return {};
  const ts = m[3]!;
  const y = Number(ts.slice(0, 4));
  const mo = Number(ts.slice(4, 6));
  const d = Number(ts.slice(6, 8));
  const hh = Number(ts.slice(8, 10) || "00");
  const mm = Number(ts.slice(10, 12) || "00");
  const storeRaw = m[2]!;
  return {
    storeId: /^\d+$/.test(storeRaw)
      ? String(parseInt(storeRaw, 10)).padStart(3, "0")
      : storeRaw,
    publishedAt: dateFromIlWallClock(y, mo, d, hh, mm),
  };
}
