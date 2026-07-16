import type { SourceAdapter } from "@super-mcp/shared";
import { createCerberusAdapter } from "./cerberus.js";
import { createShufersalAdapter } from "./shufersal.js";
import { createCarrefourAdapter, createPublishPriceAdapter, PUBLISHPRICE_PORTALS } from "./publishprice.js";
import { createFixtureAdapter } from "./fixture.js";

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
