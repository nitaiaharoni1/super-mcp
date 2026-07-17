import type { SourceAdapter } from "@super-mcp/shared";
import { createPublishPriceAdapter, PUBLISHPRICE_PORTALS } from "../publishprice/index.js";

export function createCarrefourAdapter(): SourceAdapter {
  return createPublishPriceAdapter(PUBLISHPRICE_PORTALS[0]!);
}
