import { cn } from "@/lib/utils";

function formatStamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function FreshnessStamp({
  sourceTs,
  ingestedAt,
  className,
}: {
  sourceTs: string;
  ingestedAt: string;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-1 font-[family-name:var(--font-geist-mono)] text-[11px] leading-relaxed text-[var(--color-ink-muted)]",
        className,
      )}
    >
      <div className="flex flex-wrap gap-x-2">
        <dt className="opacity-70">source_ts</dt>
        <dd dir="ltr">{formatStamp(sourceTs)}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="opacity-70">ingested_at</dt>
        <dd dir="ltr">{formatStamp(ingestedAt)}</dd>
      </div>
    </dl>
  );
}
