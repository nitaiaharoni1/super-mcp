"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const COPIED_STATE_DURATION_MS = 1_500;

export function CopyButton({
  value,
  label,
  copiedLabel = "הועתק",
}: {
  value: string;
  label: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), COPIED_STATE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard denied or unavailable — keep default label
    }
  }

  return (
    <Button type="button" variant="secondary" onClick={handleCopy}>
      {copied ? copiedLabel : label}
    </Button>
  );
}
