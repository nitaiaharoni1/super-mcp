import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Container({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 md:px-6", className)}>{children}</div>;
}
