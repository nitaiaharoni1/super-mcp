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
        "overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-paper-sunk)] p-4 font-mono text-[0.8125rem] leading-6 text-[var(--color-ink)]",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}
