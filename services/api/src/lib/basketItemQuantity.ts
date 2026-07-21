import { isCountUnit } from "@super-mcp/shared";

/** Drop redundant count units that agents often attach to pack_qty (unit / יח / pcs). */
export function stripRedundantPackCountUnit<
  T extends { pack_qty?: number; amount?: number; unit?: string },
>(item: T): T {
  if (
    item.pack_qty != null &&
    item.amount == null &&
    item.unit != null &&
    isCountUnit(item.unit)
  ) {
    const { unit: _ignored, ...rest } = item;
    return rest as T;
  }
  return item;
}
