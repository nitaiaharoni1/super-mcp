import { PostHog } from "posthog-node";
import { POSTHOG_PRODUCT, type AnalyticsEnvironment } from "@super-mcp/shared";

const DEFAULT_HOST = "https://eu.i.posthog.com";

let client: PostHog | null | undefined;

function resolveEnvironment(): AnalyticsEnvironment {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** Lazy singleton. Returns null when POSTHOG_KEY is unset (local/tests). */
export function getPostHogClient(): PostHog | null {
  if (client !== undefined) return client;

  const key = process.env.POSTHOG_KEY?.trim();
  if (!key) {
    client = null;
    return client;
  }

  client = new PostHog(key, {
    host: process.env.POSTHOG_HOST?.trim() || DEFAULT_HOST,
    flushAt: 20,
    flushInterval: 10_000,
  });
  return client;
}

export function posthogDistinctId(apiKeyId: string): string {
  return `api_key:${apiKeyId}`;
}

export function captureSafe(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>,
): void {
  try {
    const ph = getPostHogClient();
    if (!ph) return;
    ph.capture({
      distinctId,
      event,
      properties: {
        product: POSTHOG_PRODUCT,
        environment: resolveEnvironment(),
        ...properties,
      },
    });
  } catch {
    // Analytics must never affect request handling.
  }
}

export async function shutdownPostHog(): Promise<void> {
  if (!client) {
    client = undefined;
    return;
  }
  try {
    await client.shutdown();
  } catch {
    // ignore
  } finally {
    client = undefined;
  }
}

/** Test-only: reset singleton between cases. */
export function _resetPostHogClientForTests(): void {
  client = undefined;
}
