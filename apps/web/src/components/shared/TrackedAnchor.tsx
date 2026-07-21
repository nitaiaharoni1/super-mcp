"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { capture } from "@/lib/analytics";

type TrackedAnchorProps = ComponentPropsWithoutRef<"a"> & {
  children: ReactNode;
  event: string;
  eventProperties?: Record<string, unknown>;
  /** Fired in addition when href is mailto: */
  mailtoEvent?: string;
};

export function TrackedAnchor({
  children,
  event,
  eventProperties,
  mailtoEvent,
  href,
  onClick,
  ...rest
}: TrackedAnchorProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        capture(event, eventProperties);
        if (mailtoEvent && typeof href === "string" && href.startsWith("mailto:")) {
          capture(mailtoEvent, eventProperties);
        }
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
