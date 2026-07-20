import { riskTokens } from "./lineRisk.js";

/** Package form buckets for brand-family peer safety (jar ≠ sachet/multipack). */
export type PackageFormKind = "standard" | "sachet" | "multipack";

const SACHET_TOKENS = new Set(["מנות", "מנה", "שקית", "שקיות", "סאש", "סאשה", "סשה"]);

export function packageFormKind(
  name: string,
  pieceCount: number | null | undefined,
): PackageFormKind {
  if (pieceCount != null && pieceCount > 1) return "multipack";
  if (/\d+\s*[xX×*]/.test(name)) return "multipack";
  const tokens = riskTokens(name);
  if (tokens.some((t) => SACHET_TOKENS.has(t))) return "sachet";
  return "standard";
}

export function packageFormsCompatible(
  a: { name: string; pieceCount?: number | null },
  b: { name: string; pieceCount?: number | null },
): boolean {
  const ka = packageFormKind(a.name, a.pieceCount ?? null);
  const kb = packageFormKind(b.name, b.pieceCount ?? null);
  if (ka === kb) return true;
  // Sachets and labeled multipacks are the same form family; jars/tubs are not.
  if (
    (ka === "sachet" || ka === "multipack") &&
    (kb === "sachet" || kb === "multipack")
  ) {
    return true;
  }
  return false;
}
