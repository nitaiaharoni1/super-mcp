import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A revealed block. Renders no client JavaScript at all: the motion lives in
 * `globals.css`, keyed off `data-reveal` (scroll-linked) or `data-enter`
 * (page load, above the fold). Content is visible with or without either.
 *
 * `beat` orders the two page-load entrances. It only applies to `on="load"`.
 */
export function Reveal({
  children,
  className,
  on = "scroll",
  beat = 1,
}: {
  children: ReactNode;
  className?: string;
  on?: "scroll" | "load";
  beat?: 1 | 2;
}) {
  const trigger = on === "load" ? { "data-enter": String(beat) } : { "data-reveal": "" };

  return (
    <div className={cn(className)} {...trigger}>
      {children}
    </div>
  );
}
