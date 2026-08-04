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
        "overflow-x-auto rounded-[var(--radius-card)] bg-ink p-4 font-mono text-[0.8125rem] leading-6 text-lime-soft shadow-sticker-sm",
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}
