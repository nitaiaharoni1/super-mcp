"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AnalyticsEvent, capture } from "@/lib/analytics";

const STATE_DURATION_MS = 1_800;

type CopyState = "idle" | "copied" | "failed";

export function CopyButton({
  value,
  label,
  copiedLabel = "הועתק",
  failedLabel = "ההעתקה נכשלה",
  analyticsEvent,
  analyticsProperties,
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  failedLabel?: string;
  analyticsEvent?: string;
  analyticsProperties?: Record<string, unknown>;
}) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") {
      return;
    }

    const timeout = window.setTimeout(() => setState("idle"), STATE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      if (analyticsEvent) capture(analyticsEvent, analyticsProperties);
    } catch {
      setState("failed");
      // A refused clipboard is a silent funnel exit: the reader has nothing to paste.
      if (analyticsEvent) {
        capture(AnalyticsEvent.McpCopyFailed, { ...analyticsProperties, source: analyticsEvent });
      }
    }
  }

  const text = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;

  return (
    <Button type="button" variant="secondary" onClick={handleCopy} aria-live="polite">
      {text}
    </Button>
  );
}
