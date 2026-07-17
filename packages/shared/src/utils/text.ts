/** Strip NUL bytes Postgres rejects in text/varchar columns. */
export function scrubNullChars(value: string): string {
  return value.replace(/\u0000/g, "");
}

/** Trim and drop empty strings after scrubbing NUL bytes. */
export function scrubOptionalText(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const cleaned = scrubNullChars(value).trim();
  return cleaned.length ? cleaned : undefined;
}

/** @deprecated Use scrubOptionalText — kept for ingest call sites. */
export const scrubString = scrubOptionalText;

/** Recursively strip NUL bytes from JSON-like promo params. */
export function scrubJson(value: unknown): unknown {
  if (typeof value === "string") return scrubNullChars(value);
  if (Array.isArray(value)) return value.map(scrubJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[scrubNullChars(k)] = scrubJson(v);
    }
    return out;
  }
  return value;
}

/** Escape `%`, `_`, and `\` for safe use in SQL ILIKE patterns. */
export function escapeIlike(raw: string): string {
  return raw.replace(/([\\%_])/g, "\\$1");
}
