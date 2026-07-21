import { POSTHOG_PRODUCT } from "@super-mcp/shared/analytics";
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com";

if (key) {
  posthog.init(key, {
    api_host: host,
    defaults: "2026-05-30",
    disable_session_recording: true,
    persistence: "localStorage+cookie",
    // Marketing site: pageviews + our explicit CTAs; keep autocapture for click breadcrumbs.
    capture_pageview: true,
    autocapture: true,
  });
  posthog.register({
    product: POSTHOG_PRODUCT,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    surface: "web",
  });
}
