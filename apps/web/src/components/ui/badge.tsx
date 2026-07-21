import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-[var(--radius-lg)] bg-[var(--color-olive-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)]",
        className,
      )}
      {...props}
    />
  );
}
