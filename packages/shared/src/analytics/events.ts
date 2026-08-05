/** Shared PostHog event names — no SDK dependency. */

export const POSTHOG_PRODUCT = "super_mcp" as const;

export const AnalyticsEvent = {
  MarketingCtaClicked: "marketing_cta_clicked",
  AccessRequestSubmitted: "access_request_submitted",
  AccessRequestFailed: "access_request_failed",
  McpUrlCopied: "mcp_url_copied",
  McpJsonCopied: "mcp_json_copied",
  /**
   * Top of the install funnel: the card grid scrolled into view. Distinguishes "nobody
   * scrolls this far" from "they saw the cards and did not click".
   */
  McpInstallViewed: "mcp_install_viewed",
  /** One event for every install card; the assistant rides in `target`. */
  McpInstallClicked: "mcp_install_clicked",
  /** Clipboard write rejected. Silent otherwise, and it drops the reader out of the funnel. */
  McpCopyFailed: "mcp_copy_failed",
  SelfHostDocsClicked: "self_host_docs_clicked",
  ApiOperation: "api_operation",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

export type AnalyticsSurface = "web" | "mcp" | "rest";
export type AnalyticsEnvironment = "development" | "production";
