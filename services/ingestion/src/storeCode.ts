/** Normalize chain-local store codes so "1" and "001" map to the same key. */
export function normalizeStoreCode(code: string): string {
  const trimmed = code.replace(/\u0000/g, "").trim();
  if (!trimmed || trimmed === "unknown") return trimmed;
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10)).padStart(3, "0");
  }
  return trimmed;
}
