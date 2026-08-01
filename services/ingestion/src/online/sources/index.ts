import type { SourceAdapter } from "@super-mcp/shared";
import { createWoltAdapter, type WoltAdapterOptions } from "./wolt/adapter.js";
import { createStorAiAdapter, type StorAiAdapterOptions } from "./storai/adapter.js";

/**
 * Online sources, kept in their own registry so the physical ingest cannot
 * accidentally pull them in and vice versa.
 *
 * These are scrapes, not regulated feeds. That difference is not cosmetic:
 * feed prices are published under a legal obligation to be accurate and arrive
 * on a schedule, while these are best-effort reads of a website that can change
 * shape without notice. They therefore run on their own schedule, report their
 * own status, and stamp their stores with a distinct provenance so nothing
 * downstream can present a scraped price as a filed one.
 */
export type OnlineSourceId = "wolt" | "storai";

export interface OnlineSourceOptions {
  wolt?: WoltAdapterOptions;
  storai?: StorAiAdapterOptions;
}

export function getOnlineAdapters(
  sources: OnlineSourceId[],
  options: OnlineSourceOptions = {},
): SourceAdapter[] {
  const wanted = sources.length > 0 ? sources : (["wolt", "storai"] as OnlineSourceId[]);
  const adapters: SourceAdapter[] = [];
  for (const source of wanted) {
    switch (source) {
      case "wolt":
        adapters.push(createWoltAdapter(options.wolt));
        break;
      case "storai":
        adapters.push(createStorAiAdapter(options.storai));
        break;
      default: {
        const exhaustive: never = source;
        throw new Error(`Unknown online source: ${String(exhaustive)}`);
      }
    }
  }
  return adapters;
}

/** Every online source id, for validating CLI input against a typo. */
export const ONLINE_SOURCE_IDS: readonly OnlineSourceId[] = ["wolt", "storai"];

export { createWoltAdapter, createStorAiAdapter };
