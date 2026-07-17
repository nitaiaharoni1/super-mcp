import type { SourceAdapter } from "@super-mcp/shared";
import { createCerberusAdapter } from "./cerberus/adapter.js";
import { createCarrefourAdapter } from "./carrefour/adapter.js";
import { createPublishPriceAdapter, PUBLISHPRICE_PORTALS } from "./publishprice/index.js";
import { createFixtureAdapter } from "./fixture/adapter.js";
import { createShufersalAdapter } from "./shufersal/adapter.js";

export {
  createCerberusAdapter,
  createShufersalAdapter,
  createCarrefourAdapter,
  createPublishPriceAdapter,
  createFixtureAdapter,
  PUBLISHPRICE_PORTALS,
};

export function getAdapters(selection: string): SourceAdapter[] {
  switch (selection) {
    case "fixture":
      return [createFixtureAdapter()];
    case "il-cerberus":
      return [createCerberusAdapter()];
    case "il-shufersal":
      return [createShufersalAdapter()];
    case "il-carrefour":
      return [createCarrefourAdapter()];
    case "all":
      return [
        createShufersalAdapter(),
        createCerberusAdapter(),
        ...PUBLISHPRICE_PORTALS.map((p) => createPublishPriceAdapter(p)),
      ];
    default: {
      throw new Error(
        `Unknown source '${selection}'. Use fixture|il-cerberus|il-shufersal|il-carrefour|all`,
      );
    }
  }
}
