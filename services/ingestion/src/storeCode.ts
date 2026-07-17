import { scrubNullChars } from "@super-mcp/shared";

/** Normalize chain-local store codes so "1" and "001" map to the same key. */
export function normalizeStoreCode(code: string): string {
  const trimmed = scrubNullChars(code).trim();
  if (!trimmed || trimmed === "unknown") return trimmed;
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10)).padStart(3, "0");
  }
  return trimmed;
}
