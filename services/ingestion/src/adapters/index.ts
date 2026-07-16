import type { SourceAdapter } from "@super-mcp/shared";
import { createCerberusAdapter } from "./cerberus.js";
import { createShufersalAdapter } from "./shufersal.js";
import { createFixtureAdapter } from "./fixture.js";

export { createCerberusAdapter, createShufersalAdapter, createFixtureAdapter };

export function getAdapters(selection: string): SourceAdapter[] {
  switch (selection) {
    case "fixture":
      return [createFixtureAdapter()];
    case "il-cerberus":
      return [createCerberusAdapter()];
    case "il-shufersal":
      return [createShufersalAdapter()];
    case "all":
      return [createShufersalAdapter(), createCerberusAdapter()];
    default: {
      throw new Error(`Unknown source '${selection}'. Use fixture|il-cerberus|il-shufersal|all`);
    }
  }
}
