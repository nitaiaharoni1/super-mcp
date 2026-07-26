/** Strip NUL bytes Postgres rejects in text/varchar columns. */
export function scrubNullChars(value: string): string {
  return value.replace(/\u0000/g, "");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

/**
 * Undo one layer of entity escaping the feeds apply on top of their own XML.
 *
 * Chains double-escape, so the XML parser hands back a literal "&#x0D;" rather
 * than a carriage return. Rami Levy Ramat HaHayal filed its address as
 * "דבורה הנביאה 127&#x0D;", which no geocoder can resolve — so the branch fell
 * back to the Tel Aviv centroid and reported the distance to the middle of town,
 * while the Tiv Taam store on the SAME street (דבורה הנביאה 122) resolved fine.
 *
 * Only the entities that actually appear in the feeds are decoded, and control
 * characters are dropped rather than reinserted: the point is a clean, geocodable
 * string, not a faithful round-trip.
 */
export function decodeFeedEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) return match;
      // Control characters are noise in a name or an address; drop them.
      if (code < 0x20 || code === 0x7f) return " ";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Trim and drop empty strings after scrubbing NUL bytes and feed escaping. */
export function scrubOptionalText(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const cleaned = decodeFeedEntities(scrubNullChars(value)).replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned : undefined;
}

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
