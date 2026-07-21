import { Badge } from "@/components/ui/badge";

export function ToolChip({ name, label }: { name: string; label: string }) {
  return (
    <Badge className="gap-2 rounded-[var(--radius-lg)] px-3 py-2 text-sm font-normal">
      <span dir="ltr" className="font-mono text-[var(--color-olive)]">
        {name}
      </span>
      <span>{label}</span>
    </Badge>
  );
}
