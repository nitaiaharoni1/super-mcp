/**
 * SQL expression equivalent to packages/shared `normalizeGtin(codeExpr)`.
 * Gate on length *after* stripping leading zeros (not before).
 */
export function sqlNormalizeGtin(codeExpr: string): string {
  return `CASE
    WHEN length(regexp_replace(regexp_replace(${codeExpr}, '\\D', '', 'g'), '^0+', '')) >= 8
      THEN regexp_replace(regexp_replace(${codeExpr}, '\\D', '', 'g'), '^0+', '')
    ELSE regexp_replace(${codeExpr}, '\\D', '', 'g')
  END`;
}
