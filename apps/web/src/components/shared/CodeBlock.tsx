import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  return (
    <pre
      dir="ltr"
      className={cn(
        "overflow-x-auto rounded-[var(--radius-lg)] bg-[var(--color-olive-soft)] p-4 font-mono text-sm text-[var(--color-ink)]",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}
