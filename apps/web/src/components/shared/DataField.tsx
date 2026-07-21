import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DataField({
  label,
  children,
  className,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-sm text-[var(--color-ink)]",
          mono && "font-[family-name:var(--font-geist-mono)] tabular-nums",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
