import { scrubNullChars } from "@super-mcp/shared";
import { dateFromIlWallClock } from "../ilDate.js";

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function text(value: unknown): string {
  if (value == null) return "";
  let s: string;
  if (typeof value === "object" && value !== null && "#text" in value) {
    s = String((value as { "#text": unknown })["#text"] ?? "");
  } else {
    s = String(value);
  }
  // Postgres rejects NUL (0x00) in text/varchar.
  return scrubNullChars(s).trim();
}

export function num(value: unknown): number | undefined {
  let s = text(value).replace(/\s/g, "");
  if (!s) return undefined;
  // Feeds are inconsistent: ',' may be a decimal separator (IL/EU "32,08") or a
  // thousands separator ("1,234.50"). Only a lone comma is treated as decimal;
  // a comma alongside a dot, or multiple commas, is a thousands grouping.
  const commas = (s.match(/,/g) ?? []).length;
  if (commas > 1 || (commas === 1 && s.includes("."))) {
    s = s.replace(/,/g, "");
  } else if (commas === 1) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse an Israel-local feed timestamp. Returns null when the string is empty
 * or unparseable — callers must supply domain-specific fallbacks (never treat
 * "missing end date" as "expires at ingest time").
 */
export function parseIlDate(dateStr: string, hourStr?: string): Date | null {
  const d = dateStr.trim();
  if (!d) return null;

  // YYYY-MM-DD or YYYY/MM/DD or DD/MM/YYYY, optionally followed by a time.
  let ymd: [number, number, number] | null = null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(d)) {
    const [yyyy, mm, dd] = d.slice(0, 10).replace(/\//g, "-").split("-");
    ymd = [Number(yyyy), Number(mm), Number(dd)];
  } else if (/^\d{2}\/\d{2}\/\d{4}/.test(d)) {
    const [dd, mm, yyyy] = d.slice(0, 10).split("/");
    ymd = [Number(yyyy), Number(mm), Number(dd)];
  }

  if (ymd) {
    const embedded = d.match(/(?:^|[ T])(\d{2}):(\d{2})(?::(\d{2}))?/);
    const hSrc =
      hourStr?.trim() ||
      (embedded ? `${embedded[1]}:${embedded[2]}:${embedded[3] ?? "00"}` : "00:00:00");
    const hms =
      hSrc.length === 5 ? hSrc + ":00" : hSrc.length === 2 ? hSrc + ":00:00" : hSrc;
    const [hh, min, sec] = hms.split(":");
    const parsed = dateFromIlWallClock(
      ymd[0],
      ymd[1],
      ymd[2],
      Number(hh) || 0,
      Number(min) || 0,
      Number(sec) || 0,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Open-ended promo window when the feed omits start and/or end. */
export const PROMO_START_FALLBACK = dateFromIlWallClock(2000, 1, 1, 0, 0, 0);
export const PROMO_END_FALLBACK = dateFromIlWallClock(2099, 12, 31, 23, 59, 59);
