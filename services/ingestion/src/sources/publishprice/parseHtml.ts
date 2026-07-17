import { classifyFeedFile, parseFeedFileMeta } from "../common/feedMeta.js";
import type { DayFileEntry, ParsedPublishPricePage } from "./types.js";

/** Parse the inline JS file list from a PublishPrice HTML page. */
export function parsePublishPriceHtml(html: string): ParsedPublishPricePage {
  const pathMatch = html.match(/const\s+path\s*=\s*['"]([^'"]+)['"]/);
  if (!pathMatch) {
    throw new Error("PublishPrice HTML: missing const path");
  }
  const filesMatch = html.match(/const\s+files\s*=\s*(\[[\s\S]*?\]);/);
  if (!filesMatch) {
    throw new Error("PublishPrice HTML: missing const files");
  }
  let files: Array<{ name: string; size?: number }>;
  try {
    files = JSON.parse(filesMatch[1]!) as Array<{ name: string; size?: number }>;
  } catch {
    throw new Error("PublishPrice HTML: const files is not valid JSON");
  }

  let branches: Record<string, string> | undefined;
  const branchesMatch = html.match(/const\s+branches\s*=\s*(\{[\s\S]*?\});/);
  if (branchesMatch) {
    try {
      branches = JSON.parse(branchesMatch[1]!) as Record<string, string>;
    } catch {
      branches = undefined;
    }
  }

  return { path: pathMatch[1]!, files, branches };
}

export function fileUrl(baseUrl: string, dayPath: string, fileName: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const segments = dayPath.split("/").map(encodeURIComponent).join("/");
  return `${base}/${segments}/${encodeURIComponent(fileName)}`;
}

/** YYYYMMDD keys for Asia/Jerusalem calendar days, newest first (today … lookback-1). */
export function jerusalemDateKeys(
  lookbackDays: number,
  now: Date = new Date(),
): string[] {
  const days = Math.max(1, Math.min(14, Math.floor(lookbackDays)));
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  let y = Number(parts.find((p) => p.type === "year")?.value);
  let m = Number(parts.find((p) => p.type === "month")?.value);
  let day = Number(parts.find((p) => p.type === "day")?.value);
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    keys.push(
      `${String(y).padStart(4, "0")}${String(m).padStart(2, "0")}${String(day).padStart(2, "0")}`,
    );
    const prev = new Date(Date.UTC(y, m - 1, day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    day = prev.getUTCDate();
  }
  return keys;
}

/**
 * Merge multi-day portal listings. Prefer the newest dayPath, then the
 * lexicographically latest file name (includes HHMMSS) for the same slot.
 */
export function mergePublishPriceDayFiles(days: DayFileEntry[]): DayFileEntry[] {
  const best = new Map<string, DayFileEntry>();
  for (const entry of days) {
    const kind = classifyFeedFile(entry.name);
    if (kind === "other") continue;
    let slot: string;
    if (kind === "stores") {
      slot = "stores";
    } else if (kind === "pricesfull" || kind === "promosfull") {
      const meta = parseFeedFileMeta(entry.name);
      slot = `${kind}:${meta.storeId ?? entry.name}`;
    } else {
      continue;
    }
    const prev = best.get(slot);
    if (!prev) {
      best.set(slot, entry);
      continue;
    }
    if (entry.dayPath > prev.dayPath) {
      best.set(slot, entry);
      continue;
    }
    if (entry.dayPath === prev.dayPath && entry.name > prev.name) {
      best.set(slot, entry);
    }
  }
  return [...best.values()].sort((a, b) => (b.name > a.name ? 1 : -1));
}
