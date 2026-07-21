"use client";

import { AnalyticsEvent, type AnalyticsEventName } from "@super-mcp/shared/analytics";
import posthog from "posthog-js";

export { AnalyticsEvent };

export function capture(
  event: AnalyticsEventName | (string & {}),
  properties?: Record<string, unknown>,
): void {
  try {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()) return;
    if (typeof posthog.capture !== "function") return;
    posthog.capture(event, properties);
  } catch {
    // never break UI for analytics
  }
}
