"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { capture } from "@/lib/analytics";

type TrackedAnchorProps = ComponentPropsWithoutRef<"a"> & {
  children: ReactNode;
  event: string;
  eventProperties?: Record<string, unknown>;
};

export function TrackedAnchor({
  children,
  event,
  eventProperties,
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
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
