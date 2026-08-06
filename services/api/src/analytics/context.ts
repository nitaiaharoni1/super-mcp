import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiKeyRole } from "../auth.js";
import type { AnalyticsClientName } from "./metadata.js";

export type AnalyticsRequestContext = {
  apiKeyId: string;
  role: ApiKeyRole;
  /** Pseudonymous distinct id for keyless callers; unset for key holders. */
  analyticsId?: string;
  clientName?: AnalyticsClientName;
};

const storage = new AsyncLocalStorage<AnalyticsRequestContext>();

/** Bound per McpServer instance — survives transport async boundaries where ALS may not. */
const serverContexts = new WeakMap<object, AnalyticsRequestContext>();

export function bindAnalyticsContext(server: object, ctx: AnalyticsRequestContext): void {
  serverContexts.set(server, ctx);
}

export function runWithAnalyticsContext<T>(
  ctx: AnalyticsRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

/** Prefer server-bound context; fall back to AsyncLocalStorage. */
export function resolveAnalyticsContext(server?: object): AnalyticsRequestContext | undefined {
  if (server) {
    const bound = serverContexts.get(server);
    if (bound) return bound;
  }
  return storage.getStore();
}
