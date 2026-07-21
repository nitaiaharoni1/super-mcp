/** Shared PostHog event names — no SDK dependency. */

export const POSTHOG_PRODUCT = "super_mcp" as const;

export const AnalyticsEvent = {
  MarketingCtaClicked: "marketing_cta_clicked",
  AccessMailtoClicked: "access_mailto_clicked",
  McpUrlCopied: "mcp_url_copied",
  McpJsonCopied: "mcp_json_copied",
  AccessDetailsOpened: "access_details_opened",
  SelfHostDocsClicked: "self_host_docs_clicked",
  ApiOperation: "api_operation",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export type AnalyticsSurface = "web" | "mcp" | "rest";
export type AnalyticsEnvironment = "development" | "production";
