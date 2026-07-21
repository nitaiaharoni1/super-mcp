import { cn } from "@/lib/utils";

export function Price({
  value,
  currency = "₪",
  className,
}: {
  value: number;
  currency?: string;
  className?: string;
}) {
  const formatted = new Intl.NumberFormat("he-IL", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);

  return (
    <span
      className={cn(
        "font-[family-name:var(--font-geist-mono)] tabular-nums tracking-tight",
        className,
      )}
      dir="ltr"
    >
      {currency}
      {formatted}
    </span>
  );
}
