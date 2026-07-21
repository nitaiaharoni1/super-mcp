"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { capture } from "@/lib/analytics";

const STATE_DURATION_MS = 1_800;

type CopyState = "idle" | "copied" | "failed";

export function CopyButton({
  value,
  label,
  copiedLabel = "הועתק",
  failedLabel = "ההעתקה נכשלה",
  analyticsEvent,
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  failedLabel?: string;
  analyticsEvent?: string;
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
      if (analyticsEvent) capture(analyticsEvent);
    } catch {
      setState("failed");
    }
  }

  const text = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;

  return (
    <Button type="button" variant="secondary" onClick={handleCopy} aria-live="polite">
      {text}
    </Button>
  );
}
